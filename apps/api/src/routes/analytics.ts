import { and, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import {
  FINDING_TYPE_LABELS,
  WINDOW_DAYS,
  type AgentSummary,
  type AnalyticsWindow,
  type CallMetricTrendPoint,
  type CriterionBreakdown,
  type FailureMode,
  type FindingType,
  type Kpis,
  type TrendPoint,
} from '@copilot/shared'
import { db } from '../db/client.js'
import {
  agents,
  calls,
  criterionResults,
  evaluations,
  findings,
  callActions,
} from '../db/schema.js'

/**
 * Aggregations behind the dashboard. All SQL-side: the demo dataset is small
 * but the shape must hold at real call volume, so nothing loads all rows into
 * JS to count them.
 */

export function windowStart(window: AnalyticsWindow, now = new Date()): Date {
  return new Date(now.getTime() - WINDOW_DAYS[window] * 24 * 60 * 60 * 1000)
}

interface Scope {
  locationId: string
  agentId?: string
}

function callScope(scope: Scope, since: Date, until?: Date) {
  const conditions = [eq(calls.locationId, scope.locationId), gte(calls.startedAt, since)]
  if (until) conditions.push(lt(calls.startedAt, until))
  if (scope.agentId) conditions.push(eq(calls.agentId, scope.agentId))
  return and(...conditions)
}

async function passFailCounts(scope: Scope, since: Date, until?: Date) {
  const rows = await db
    .select({
      verdict: evaluations.verdict,
      n: count(),
    })
    .from(evaluations)
    .innerJoin(calls, eq(evaluations.callId, calls.id))
    .where(callScope(scope, since, until))
    .groupBy(evaluations.verdict)

  const by = { pass: 0, partial: 0, fail: 0 }
  for (const row of rows) by[row.verdict] = row.n
  const total = by.pass + by.partial + by.fail
  return { ...by, total }
}

export async function computeKpis(scope: Scope, window: AnalyticsWindow): Promise<Kpis> {
  const since = windowStart(window)
  const prevSince = windowStart(window, since)

  const [current, previous, callAgg, actionAgg] = await Promise.all([
    passFailCounts(scope, since),
    passFailCounts(scope, prevSince, since),
    db
      .select({ n: count(), avgDuration: sql<number>`coalesce(avg(${calls.durationSec}), 0)` })
      .from(calls)
      .where(callScope(scope, since)),
    db
      .select({ n: count() })
      .from(callActions)
      .innerJoin(calls, eq(callActions.callId, calls.id))
      .where(and(callScope(scope, since), eq(callActions.status, 'open'))),
  ])

  const passRate = current.total ? current.pass / current.total : 0
  const prevPassRate = previous.total ? previous.pass / previous.total : 0

  return {
    calls: callAgg[0]?.n ?? 0,
    evaluatedCalls: current.total,
    passRate,
    failRate: current.total ? current.fail / current.total : 0,
    openActions: actionAgg[0]?.n ?? 0,
    avgDurationSec: Math.round(Number(callAgg[0]?.avgDuration ?? 0)),
    passRateDelta: previous.total ? passRate - prevPassRate : 0,
  }
}

/**
 * Build cumulative daily trends directly from per-call scalar signals.
 *
 * The database reduces calls to one row per day; the small daily result (at
 * most 90 rows) is accumulated in memory. This keeps the query cheap today
 * and leaves a clean boundary for replacing it with rollup tables later.
 */
export async function computeMetricTrend(
  scope: Scope,
  window: AnalyticsWindow,
): Promise<CallMetricTrendPoint[]> {
  const since = windowStart(window)
  const day = sql<string>`to_char(date_trunc('day', ${calls.startedAt}), 'YYYY-MM-DD')`
  const rows = await db
    .select({
      date: day,
      calls: count(),
      durationSum: sql<number>`coalesce(sum(${calls.durationSec}), 0)`,
      turnsSum: sql<number>`coalesce(sum((${calls.metrics} #>> '{turns,total}')::integer), 0)`,
      turnsN: sql<number>`count(${calls.metrics} #>> '{turns,total}')`,
      talkSum: sql<number>`coalesce(sum(${calls.agentTalkRatio}), 0)`,
      talkN: sql<number>`count(${calls.agentTalkRatio})`,
      interruptionSum: sql<number>`coalesce(sum(${calls.interruptionRate}), 0)`,
      interruptionN: sql<number>`count(${calls.interruptionRate})`,
      repeatSum: sql<number>`coalesce(sum(${calls.callerRepeatRate}), 0)`,
      repeatN: sql<number>`count(${calls.callerRepeatRate})`,
      assessed: sql<number>`count(${calls.callCompleted})`,
      completed: sql<number>`count(*) filter (where ${calls.callCompleted})`,
      resolved: sql<number>`count(*) filter (where ${calls.taskOutcome} = 'resolved')`,
      hangups: sql<number>`count(*) filter (where ${calls.prematureHangup})`,
      scriptSum: sql<number>`coalesce(sum(${calls.scriptAdherenceScore}), 0)`,
      scriptN: sql<number>`count(${calls.scriptAdherenceScore})`,
      comprehensionSum: sql<number>`coalesce(sum(${calls.comprehensionScore}), 0)`,
      comprehensionN: sql<number>`count(${calls.comprehensionScore})`,
      toneSum: sql<number>`coalesce(sum(${calls.toneScore}), 0)`,
      toneN: sql<number>`count(${calls.toneScore})`,
      names: sql<number>`count(*) filter (where ${calls.capturedName})`,
      emails: sql<number>`count(*) filter (where ${calls.capturedEmail})`,
      phones: sql<number>`count(*) filter (where ${calls.capturedPhone})`,
      positive: sql<number>`count(*) filter (where ${calls.callerSentiment} = 'positive')`,
      neutral: sql<number>`count(*) filter (where ${calls.callerSentiment} = 'neutral')`,
      negative: sql<number>`count(*) filter (where ${calls.callerSentiment} = 'negative')`,
    })
    .from(calls)
    .where(callScope(scope, since))
    .groupBy(day)
    .orderBy(day)

  const totals: Record<string, number> = {}
  const add = (key: string, value: unknown) => {
    totals[key] = (totals[key] ?? 0) + Number(value ?? 0)
  }
  const ratio = (sumKey: string, countKey: string) =>
    totals[countKey] ? totals[sumKey]! / totals[countKey]! : null
  const rounded = (value: number | null, precision = 3) =>
    value == null ? null : Math.round(value * 10 ** precision) / 10 ** precision

  return rows.map((row) => {
    for (const [key, value] of Object.entries(row)) {
      if (key !== 'date') add(key, value)
    }
    return {
      date: row.date,
      calls: Number(row.calls),
      cumulativeCalls: totals.calls ?? 0,
      avgTurns: rounded(ratio('turnsSum', 'turnsN'), 1),
      avgDurationSec: rounded(ratio('durationSum', 'calls'), 0),
      agentTalkShare: rounded(ratio('talkSum', 'talkN')),
      interruptionRate: rounded(ratio('interruptionSum', 'interruptionN')),
      callerRepeatRate: rounded(ratio('repeatSum', 'repeatN')),
      completionRate: rounded(ratio('completed', 'assessed')),
      resolvedRate: rounded(ratio('resolved', 'assessed')),
      prematureHangupRate: rounded(ratio('hangups', 'assessed')),
      scriptAdherence: rounded(ratio('scriptSum', 'scriptN'), 1),
      comprehension: rounded(ratio('comprehensionSum', 'comprehensionN'), 1),
      tone: rounded(ratio('toneSum', 'toneN'), 1),
      nameCaptureRate: rounded(ratio('names', 'assessed')),
      emailCaptureRate: rounded(ratio('emails', 'assessed')),
      phoneCaptureRate: rounded(ratio('phones', 'assessed')),
      positiveSentimentRate: rounded(ratio('positive', 'assessed')),
      neutralSentimentRate: rounded(ratio('neutral', 'assessed')),
      negativeSentimentRate: rounded(ratio('negative', 'assessed')),
    }
  })
}

export async function computeTrend(scope: Scope, window: AnalyticsWindow): Promise<TrendPoint[]> {
  const since = windowStart(window)
  const day = sql<string>`to_char(date_trunc('day', ${calls.startedAt}), 'YYYY-MM-DD')`
  const rows = await db
    .select({
      date: day,
      calls: count(),
      passed: sql<number>`count(*) filter (where ${evaluations.verdict} = 'pass')`,
      evaluated: sql<number>`count(${evaluations.id})`,
    })
    .from(calls)
    .leftJoin(evaluations, eq(evaluations.callId, calls.id))
    .where(callScope(scope, since))
    .groupBy(day)
    .orderBy(day)

  return rows.map((row) => ({
    date: row.date,
    calls: row.calls,
    passRate: Number(row.evaluated) ? Number(row.passed) / Number(row.evaluated) : 0,
  }))
}

export async function computeFailureModes(scope: Scope, window: AnalyticsWindow): Promise<FailureMode[]> {
  const since = windowStart(window)
  const conditions = [eq(findings.locationId, scope.locationId), gte(findings.createdAt, since)]
  if (scope.agentId) conditions.push(eq(findings.agentId, scope.agentId))

  const rows = await db
    .select({ type: findings.type, n: count() })
    .from(findings)
    .where(and(...conditions))
    .groupBy(findings.type)
    .orderBy(desc(count()))

  return rows.map((row) => ({
    type: row.type as FindingType,
    label: FINDING_TYPE_LABELS[row.type as FindingType] ?? row.type,
    count: row.n,
  }))
}

export async function computeCriterionBreakdown(
  agentId: string,
  window: AnalyticsWindow,
): Promise<Array<Omit<CriterionBreakdown, 'label' | 'weight'>>> {
  const since = windowStart(window)
  const prevSince = windowStart(window, since)

  const rateRows = (from: Date, to?: Date) =>
    db
      .select({
        key: criterionResults.criterionKey,
        evaluated: count(),
        met: sql<number>`count(*) filter (where ${criterionResults.met})`,
      })
      .from(criterionResults)
      .where(
        and(
          eq(criterionResults.agentId, agentId),
          gte(criterionResults.createdAt, from),
          ...(to ? [lt(criterionResults.createdAt, to)] : []),
        ),
      )
      .groupBy(criterionResults.criterionKey)

  const [current, previous] = await Promise.all([rateRows(since), rateRows(prevSince, since)])
  const prevByKey = new Map(previous.map((r) => [r.key, Number(r.met) / Math.max(1, r.evaluated)]))

  return current.map((row) => {
    const rate = Number(row.met) / Math.max(1, row.evaluated)
    const prev = prevByKey.get(row.key)
    return {
      key: row.key,
      passRate: rate,
      delta: prev === undefined ? 0 : rate - prev,
      evaluated: row.evaluated,
    }
  })
}

export async function computeAgentSummaries(
  locationId: string,
  window: AnalyticsWindow,
): Promise<AgentSummary[]> {
  const agentRows = await db.query.agents.findMany({
    where: eq(agents.locationId, locationId),
    orderBy: (a, { asc }) => [asc(a.name)],
  })
  if (agentRows.length === 0) return []

  const summaries = await Promise.all(
    agentRows.map(async (agent) => {
      const scope = { locationId, agentId: agent.id }
      const [kpis, trend, breakdown] = await Promise.all([
        computeKpis(scope, window),
        computeTrend(scope, window),
        computeCriterionBreakdown(agent.id, window),
      ])

      const scorecard = await db.query.scorecards.findFirst({
        where: (sc, { and: andOp, eq: eqOp }) => andOp(eqOp(sc.agentId, agent.id), eqOp(sc.isActive, true)),
        orderBy: (sc, { desc: descOp }) => [descOp(sc.version)],
      })
      const labelByKey = new Map(scorecard?.criteria.map((c) => [c.key, c.label]) ?? [])

      const worst = breakdown
        .filter((b) => b.evaluated >= 2)
        .sort((a, b) => a.passRate - b.passRate)[0]

      return {
        id: agent.id,
        name: agent.name,
        calls: kpis.calls,
        passRate: kpis.passRate,
        passRateDelta: kpis.passRateDelta,
        worstCriterion: worst
          ? { key: worst.key, label: labelByKey.get(worst.key) ?? worst.key, passRate: worst.passRate }
          : null,
        openActions: kpis.openActions,
        sparkline: trend.map((p) => p.passRate),
      }
    }),
  )
  return summaries
}

/** Ids of failed/partial calls in the window — evidence pool for recommendations. */
export async function failedCallIds(agentId: string, window: AnalyticsWindow, limit = 50): Promise<string[]> {
  const since = windowStart(window)
  const rows = await db
    .select({ callId: evaluations.callId })
    .from(evaluations)
    .where(
      and(
        eq(evaluations.agentId, agentId),
        gte(evaluations.createdAt, since),
        inArray(evaluations.verdict, ['fail', 'partial']),
      ),
    )
    .orderBy(desc(evaluations.createdAt))
    .limit(limit)
  return rows.map((r) => r.callId)
}
