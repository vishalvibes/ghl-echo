import { createHash } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  FINDING_TYPE_LABELS,
  recommendationItemSchema,
  type AnalyticsWindow,
  type FindingType,
  type RecommendationItem,
  type Recommendations,
} from '@copilot/shared'
import { db } from '../db/client.js'
import { agents, findings, recommendations } from '../db/schema.js'
import { completeStructured } from '../lib/llm.js'
import { RECOMMEND_SYSTEM_PROMPT } from '../scoring/prompts.js'
import { failedCallIds } from '../routes/analytics.js'

/**
 * The Analyze half of the loop: cluster stored findings, hand the clusters
 * plus the agent's current prompt to the model, get back ranked prompt
 * patches.
 *
 * Clustering happens in SQL by finding type — cheap, deterministic, and the
 * taxonomy exists precisely so aggregation never needs an embedding step.
 * The model's only job is turning clusters into fixes.
 *
 * Output is cached by a hash of the evidence call ids: same failures, same
 * advice, zero tokens. New failing calls change the hash and invalidate.
 */

const modelOutputSchema = z.object({
  items: z.array(recommendationItemSchema.omit({ evidenceCallIds: true }).extend({
    // The model returns cluster indexes; we map them back to real call ids
    // ourselves so it can never fabricate an evidence link.
    evidenceClusterIndexes: z.array(z.number().int().nonnegative()).default([]),
  })).max(4),
})

interface Cluster {
  type: FindingType
  label: string
  count: number
  callIds: string[]
  sampleQuotes: string[]
  sampleDetails: string[]
}

async function clusterFindings(agentId: string, callIds: string[]): Promise<Cluster[]> {
  if (callIds.length === 0) return []
  const rows = await db
    .select({
      type: findings.type,
      callId: findings.callId,
      quote: findings.quote,
      detail: findings.detail,
    })
    .from(findings)
    .where(and(eq(findings.agentId, agentId), inArray(findings.callId, callIds)))
    .orderBy(desc(findings.createdAt))

  const byType = new Map<string, Cluster>()
  for (const row of rows) {
    const type = row.type as FindingType
    let cluster = byType.get(type)
    if (!cluster) {
      cluster = {
        type,
        label: FINDING_TYPE_LABELS[type] ?? type,
        count: 0,
        callIds: [],
        sampleQuotes: [],
        sampleDetails: [],
      }
      byType.set(type, cluster)
    }
    cluster.count++
    if (!cluster.callIds.includes(row.callId)) cluster.callIds.push(row.callId)
    if (row.quote && cluster.sampleQuotes.length < 5) cluster.sampleQuotes.push(row.quote)
    if (cluster.sampleDetails.length < 5) cluster.sampleDetails.push(row.detail)
  }
  return [...byType.values()].sort((a, b) => b.count - a.count)
}

function renderClusters(clusters: Cluster[]): string {
  return clusters
    .map(
      (cluster, index) => `CLUSTER ${index} — ${cluster.label} (${cluster.count} findings across ${cluster.callIds.length} calls)
  sample details:
${cluster.sampleDetails.map((d) => `    - ${d}`).join('\n')}
  verbatim caller/agent quotes:
${cluster.sampleQuotes.map((q) => `    - "${q}"`).join('\n') || '    (none captured)'}`,
    )
    .join('\n\n')
}

function evidenceHash(callIds: string[]): string {
  return createHash('sha256').update([...callIds].sort().join(',')).digest('hex').slice(0, 64)
}

export async function getRecommendations(
  locationId: string,
  agentId: string,
  window: AnalyticsWindow,
  opts: { force?: boolean } = {},
): Promise<Recommendations> {
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.locationId, locationId)),
  })
  if (!agent) throw new Error('Agent not found')

  const callIds = await failedCallIds(agentId, window)
  const hash = evidenceHash(callIds)

  if (!opts.force) {
    const cached = await db.query.recommendations.findFirst({
      where: and(
        eq(recommendations.agentId, agentId),
        eq(recommendations.window, window),
        eq(recommendations.evidenceHash, hash),
      ),
    })
    if (cached) {
      return {
        agentId,
        window,
        basedOnCalls: cached.basedOnCalls,
        generatedAt: cached.createdAt.toISOString(),
        cached: true,
        items: cached.items as RecommendationItem[],
      }
    }
  }

  const clusters = await clusterFindings(agentId, callIds)
  if (clusters.length === 0) {
    return {
      agentId,
      window,
      basedOnCalls: 0,
      generatedAt: new Date().toISOString(),
      cached: false,
      items: [],
    }
  }

  const result = await completeStructured({
    system: RECOMMEND_SYSTEM_PROMPT.replace(
      '"evidenceCallIds": ["<uuid>"]',
      '"evidenceClusterIndexes": [0]',
    ),
    user: `AGENT PROMPT (current):
"""
${agent.promptSnapshot ?? '(no prompt on file)'}
"""

FAILURE CLUSTERS from ${callIds.length} failed or partial calls:

${renderClusters(clusters)}`,
    schema: modelOutputSchema,
    temperature: 0.3,
    maxOutputTokens: 3000,
  })

  const items: RecommendationItem[] = result.data.items
    .map((item, index) => {
      const evidence = [
        ...new Set(item.evidenceClusterIndexes.flatMap((i) => clusters[i]?.callIds ?? [])),
      ].slice(0, 5)
      const { evidenceClusterIndexes: _dropped, ...rest } = item
      return { ...rest, rank: index + 1, evidenceCallIds: evidence }
    })
    // A recommendation we cannot link to real calls is exactly the ungrounded
    // advice this product exists to eliminate — drop it.
    .filter((item) => item.evidenceCallIds.length > 0)

  await db
    .insert(recommendations)
    .values({
      locationId,
      agentId,
      window,
      evidenceHash: hash,
      basedOnCalls: callIds.length,
      items,
      model: result.model,
    })
    .onConflictDoUpdate({
      target: [recommendations.agentId, recommendations.window, recommendations.evidenceHash],
      set: { items, basedOnCalls: callIds.length, model: result.model, createdAt: new Date() },
    })

  return {
    agentId,
    window,
    basedOnCalls: callIds.length,
    generatedAt: new Date().toISOString(),
    cached: false,
    items,
  }
}
