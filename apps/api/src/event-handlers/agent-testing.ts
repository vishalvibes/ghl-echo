import { and, eq } from 'drizzle-orm'
import { NonRetriableError } from 'inngest'
import type { TestCaseTranscriptResult } from '@copilot/shared'
import { db } from '../db/client.js'
import { testCases } from '../db/schema.js'
import {
  EVENT_TEST_CASES_CONFIRM,
  EVENT_TEST_CASES_RUN,
  EVENT_TEST_CASES_SUGGEST,
  inngestClient,
} from '../clients/inngest.js'
import { LlmDisabledError } from '../lib/llm.js'
import {
  collectFailedCriteria,
  expandEdgeCase,
  judgeTestTranscript,
  loadAgentForTesting,
  patchTestingJob,
  persistTestCaseResults,
  replaceTestCases,
  suggestRevisedPrompt,
} from '../services/agent-testing.js'

type ConfirmEvent = {
  agentId: string
  locationId: string
  jobId: string
  edgeCases: string[]
}

type RunEvent = {
  agentId: string
  locationId: string
  jobId: string
}

type SuggestEvent = {
  agentId: string
  locationId: string
  jobId: string
}

async function assertCurrentJob(agentId: string, locationId: string, jobId: string) {
  const agent = await loadAgentForTesting(agentId, locationId)
  if (!agent) throw new NonRetriableError(`Unknown agent ${agentId}`)
  if (!agent.testingJob || agent.testingJob.id !== jobId) {
    throw new NonRetriableError(`Stale testing job ${jobId}`)
  }
  return agent
}

async function failJob(
  agentId: string,
  locationId: string,
  jobId: string,
  error: unknown,
): Promise<never> {
  const message =
    error instanceof LlmDisabledError
      ? 'LLM disabled'
      : error instanceof Error
        ? error.message.slice(0, 500)
        : 'Testing job failed'
  await patchTestingJob(agentId, locationId, jobId, {
    status: 'failed',
    error: message,
  })
  if (error instanceof LlmDisabledError) {
    throw new NonRetriableError('LLM disabled - enable OPENAI_ENABLED to process testing jobs')
  }
  throw error
}

export const handleTestCasesConfirm = inngestClient.createFunction(
  {
    id: 'test-cases-confirm',
    retries: 2,
    concurrency: { limit: 2, key: 'event.data.agentId' },
    triggers: [{ event: EVENT_TEST_CASES_CONFIRM }],
  },
  async ({ event, step }) => {
    const data = event.data as ConfirmEvent
    const { agentId, locationId, jobId, edgeCases } = data

    await step.run('mark-running', async () => {
      await assertCurrentJob(agentId, locationId, jobId)
      await patchTestingJob(agentId, locationId, jobId, {
        status: 'running',
        progress: {
          done: 0,
          total: edgeCases.length,
          label: `Expanding edge 0/${edgeCases.length}`,
        },
      })
    })

    const packs: Array<{
      edgeCase: string
      scenario: string[]
      criteria: Awaited<ReturnType<typeof expandEdgeCase>>['criteria']
      transcripts: Awaited<ReturnType<typeof expandEdgeCase>>['transcripts']
    }> = []

    for (let i = 0; i < edgeCases.length; i += 1) {
      const edgeCase = edgeCases[i]!
      const pack = await step.run(`expand-${i}`, async () => {
        try {
          const agent = await assertCurrentJob(agentId, locationId, jobId)
          if (!agent.prompt?.trim()) throw new NonRetriableError('agent has no prompt')
          return await expandEdgeCase({
            agentName: agent.name,
            agentPrompt: agent.prompt,
            goals: agent.goals ?? [],
            edgeCase,
          })
        } catch (error) {
          return await failJob(agentId, locationId, jobId, error)
        }
      })
      packs.push(pack)
      await step.run(`progress-expand-${i}`, async () => {
        await patchTestingJob(agentId, locationId, jobId, {
          status: 'running',
          progress: {
            done: i + 1,
            total: edgeCases.length,
            label: `Expanding edge ${i + 1}/${edgeCases.length}`,
          },
        })
      })
    }

    await step.run('replace-packs', async () => {
      try {
        await assertCurrentJob(agentId, locationId, jobId)
        await replaceTestCases({ agentId, locationId, packs })
        await patchTestingJob(agentId, locationId, jobId, {
          status: 'done',
          progress: {
            done: edgeCases.length,
            total: edgeCases.length,
            label: `Created ${edgeCases.length} test cases`,
          },
          error: null,
        })
      } catch (error) {
        return await failJob(agentId, locationId, jobId, error)
      }
    })

    return { agentId, count: packs.length }
  },
)

export const handleTestCasesRun = inngestClient.createFunction(
  {
    id: 'test-cases-run',
    retries: 2,
    concurrency: { limit: 2, key: 'event.data.agentId' },
    triggers: [{ event: EVENT_TEST_CASES_RUN }],
  },
  async ({ event, step }) => {
    const data = event.data as RunEvent
    const { agentId, locationId, jobId } = data

    const plan = await step.run('plan-run', async () => {
      await assertCurrentJob(agentId, locationId, jobId)
      const rows = await db.query.testCases.findMany({
        where: and(eq(testCases.agentId, agentId), eq(testCases.locationId, locationId)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      })
      if (rows.length === 0) throw new NonRetriableError('no test cases to run')

      const units: Array<{ testCaseId: string; transcriptIndex: number }> = []
      for (const row of rows) {
        for (let t = 0; t < row.transcripts.length; t += 1) {
          units.push({ testCaseId: row.id, transcriptIndex: t })
        }
      }
      await patchTestingJob(agentId, locationId, jobId, {
        status: 'running',
        progress: {
          done: 0,
          total: units.length,
          label: `Judging mock 0/${units.length}`,
        },
      })
      return { units, caseIds: rows.map((r) => r.id) }
    })

    const resultsByCase = new Map<string, TestCaseTranscriptResult[]>()

    for (let i = 0; i < plan.units.length; i += 1) {
      const unit = plan.units[i]!
      const scored = await step.run(`judge-${unit.testCaseId}-${unit.transcriptIndex}`, async () => {
        try {
          const agent = await assertCurrentJob(agentId, locationId, jobId)
          const row = await db.query.testCases.findFirst({
            where: and(eq(testCases.id, unit.testCaseId), eq(testCases.locationId, locationId)),
          })
          if (!row) throw new NonRetriableError(`Missing test case ${unit.testCaseId}`)
          const transcript = row.transcripts[unit.transcriptIndex]
          if (!transcript) throw new NonRetriableError(`Missing transcript ${unit.transcriptIndex}`)
          return await judgeTestTranscript({
            agentName: agent.name,
            agentPrompt: agent.prompt,
            promptSnapshot: agent.promptSnapshot,
            criteria: row.criteria,
            transcript,
            transcriptIndex: unit.transcriptIndex,
          })
        } catch (error) {
          return await failJob(agentId, locationId, jobId, error)
        }
      })

      const bucket = resultsByCase.get(unit.testCaseId) ?? []
      bucket.push(scored)
      resultsByCase.set(unit.testCaseId, bucket)

      const caseUnits = plan.units.filter((u) => u.testCaseId === unit.testCaseId)
      const doneForCase = caseUnits.every((u) =>
        (resultsByCase.get(u.testCaseId) ?? []).some((r) => r.transcriptIndex === u.transcriptIndex),
      )
      if (doneForCase) {
        await step.run(`persist-${unit.testCaseId}`, async () => {
          const results = (resultsByCase.get(unit.testCaseId) ?? []).sort(
            (a, b) => a.transcriptIndex - b.transcriptIndex,
          )
          await persistTestCaseResults(unit.testCaseId, results)
        })
      }

      await step.run(`progress-run-${i}`, async () => {
        await patchTestingJob(agentId, locationId, jobId, {
          status: 'running',
          progress: {
            done: i + 1,
            total: plan.units.length,
            label: `Judging mock ${i + 1}/${plan.units.length}`,
          },
        })
      })
    }

    await step.run('mark-done', async () => {
      await patchTestingJob(agentId, locationId, jobId, {
        status: 'done',
        progress: {
          done: plan.units.length,
          total: plan.units.length,
          label: `Scored ${plan.units.length} mock calls`,
        },
        error: null,
      })
    })

    return { agentId, judged: plan.units.length }
  },
)

export const handleTestCasesSuggest = inngestClient.createFunction(
  {
    id: 'test-cases-suggest',
    retries: 2,
    concurrency: { limit: 2, key: 'event.data.agentId' },
    triggers: [{ event: EVENT_TEST_CASES_SUGGEST }],
  },
  async ({ event, step }) => {
    const data = event.data as SuggestEvent
    const { agentId, locationId, jobId } = data

    await step.run('mark-running', async () => {
      await assertCurrentJob(agentId, locationId, jobId)
      await patchTestingJob(agentId, locationId, jobId, {
        status: 'running',
        progress: { done: 0, total: 1, label: 'Revising prompt…' },
      })
    })

    const suggestion = await step.run('suggest-prompt', async () => {
      try {
        const agent = await assertCurrentJob(agentId, locationId, jobId)
        if (!agent.prompt?.trim()) throw new NonRetriableError('agent has no prompt')
        const rows = await db.query.testCases.findMany({
          where: and(eq(testCases.agentId, agentId), eq(testCases.locationId, locationId)),
          orderBy: (t, { asc }) => [asc(t.createdAt)],
        })
        const failures = collectFailedCriteria(rows)
        if (failures.length === 0) throw new NonRetriableError('no failed criteria to improve')
        return await suggestRevisedPrompt({
          agentName: agent.name,
          currentPrompt: agent.prompt,
          failures,
        })
      } catch (error) {
        return await failJob(agentId, locationId, jobId, error)
      }
    })

    await step.run('mark-done', async () => {
      await patchTestingJob(agentId, locationId, jobId, {
        status: 'done',
        progress: { done: 1, total: 1, label: 'Prompt revision ready' },
        suggestion,
        error: null,
      })
    })

    return { agentId }
  },
)
