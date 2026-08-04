import type { Criterion, Scorecard, Transcript } from '@copilot/shared'
import { FINDING_TYPE_LABELS, SEGMENT_ACTION_LABELS } from '@copilot/shared'

/**
 * Prompt construction for the judge.
 *
 * Two rules shape all of this:
 *  1. The judge never computes the overall score. It reports per-criterion
 *     judgements; the weighted number is arithmetic we own.
 *  2. Every judgement must cite turn ids. An uncited failure cannot be shown
 *     in the transcript, and an insight the user cannot verify is noise.
 */

const FINDING_TYPES = Object.entries(FINDING_TYPE_LABELS)
  .map(([key, label]) => `  - ${key}: ${label}`)
  .join('\n')

const SEGMENT_ACTIONS = Object.entries(SEGMENT_ACTION_LABELS)
  .map(([key, label]) => `  - ${key}: ${label}`)
  .join('\n')

export const JUDGE_SYSTEM_PROMPT = `You audit Voice AI phone calls for a sales and support team.

You are given a call transcript and a scorecard of success criteria. For each
criterion you decide whether the agent met it, cite the turns that prove your
decision, and explain the decision in one sentence.

Rules:
- Judge only what is in the transcript. Never assume something happened off-call.
- Every criterion in the scorecard must appear exactly once in your output.
- evidenceTurnIds must contain real turn ids from the transcript. If no turn
  supports the judgement, return an empty array and lower your confidence.
- confidence is your own certainty from 0 to 1. Use values below 0.6 freely when
  the transcript is ambiguous, truncated, or the caller hung up early.
- For criteria of type "scale", set value to an integer 1-5 and set met to true
  only when value >= 4.
- For criteria of type "extraction", set value to the extracted string (or null)
  and met to whether the extraction succeeded.
- For criteria of type "boolean", set value to null.
- Do NOT output an overall score. It is computed from criterion weights.

Findings are concrete problems worth a human's attention. Only report a finding
when a configured criterion was not met, and cite at least one of that failed
criterion's evidence turn ids. An all-good call has an empty findings array.
Allowed types:
${FINDING_TYPES}

Segments ("use actions") are turn ranges a human should act on because a
configured criterion was not met. Every segment must overlap the evidence for
an unmet criterion. Do not create training examples or other actions for a
passing criterion. Allowed action types:
${SEGMENT_ACTIONS}

Return a single JSON object, no prose, matching exactly:
{
  "summary": "two sentences on what happened",
  "callerSentiment": "positive" | "neutral" | "negative",
  "criteria": [
    {
      "key": "<criterion key>",
      "met": true,
      "value": null,
      "confidence": 0.0,
      "evidenceTurnIds": [0],
      "rationale": "one sentence"
    }
  ],
  "findings": [
    {
      "type": "<finding type>",
      "severity": "low" | "medium" | "high",
      "title": "short title",
      "detail": "what went wrong and why it matters",
      "quote": "verbatim excerpt or null",
      "turnIds": [0]
    }
  ],
  "segments": [
    {
      "turnStart": 0,
      "turnEnd": 2,
      "actionType": "<action type>",
      "reason": "why a human should look here"
    }
  ]
}`

function renderCriterion(criterion: Criterion, index: number): string {
  const lines = [
    `${index + 1}. key: ${criterion.key}`,
    `   label: ${criterion.label}`,
    `   type: ${criterion.type}`,
    `   weight: ${criterion.weight}`,
    `   definition: ${criterion.definition}`,
  ]
  if (criterion.failWhen) lines.push(`   fails when: ${criterion.failWhen}`)
  return lines.join('\n')
}

export function renderTranscript(transcript: Transcript): string {
  return transcript
    .map((turn) => {
      const stamp = turn.startMs === null ? '' : ` @${Math.round(turn.startMs / 1000)}s`
      const speaker = turn.role === 'agent' ? 'AGENT' : turn.role === 'caller' ? 'CALLER' : 'SYSTEM'
      return `[${turn.id}]${stamp} ${speaker}: ${turn.text}`
    })
    .join('\n')
}

export interface JudgeContext {
  agentName: string
  agentPrompt: string | null
  direction: string
  durationSec: number
  outcome: string
}

export function buildJudgeUserPrompt(
  scorecard: Pick<Scorecard, 'criteria'>,
  transcript: Transcript,
  context: JudgeContext,
): string {
  const active = scorecard.criteria.filter((c) => c.enabled)
  const agentGoal = context.agentPrompt
    ? `\nAGENT'S OWN INSTRUCTIONS (for context on intended behaviour):\n"""\n${context.agentPrompt.slice(0, 4000)}\n"""\n`
    : ''

  return `CALL METADATA
agent: ${context.agentName}
direction: ${context.direction}
duration: ${context.durationSec}s
telephony outcome: ${context.outcome}
${agentGoal}
SCORECARD — judge every one of these ${active.length} criteria:
${active.map(renderCriterion).join('\n')}

TRANSCRIPT — turn ids are in square brackets:
${renderTranscript(transcript)}`
}

export const SUGGEST_CRITERIA_SYSTEM_PROMPT = `You turn a Voice AI agent's instructions into a measurable scorecard.

Read the agent's prompt and propose 4-7 success criteria that an auditor could
judge from a call transcript alone. Good criteria are observable, binary where
possible, and tied to the outcome the business actually wants.

Rules:
- key must be lower_snake_case, stable, and describe the outcome (booked_appointment,
  not question_3).
- type is "boolean" for did-it-happen, "scale" for 1-5 quality judgements, and
  "extraction" for pulling a value out of the call.
- weight 1-5 reflects business importance. Reserve 4-5 for the call's primary goal.
- definition is the sentence the auditor will be judged against. Be specific.
- failWhen is optional but sharpens borderline cases.
- Do not propose criteria that require information outside the transcript
  (CRM state, later outcomes, recording audio quality).

Return JSON only:
{
  "criteria": [
    {
      "key": "booked_appointment",
      "label": "Booked appointment",
      "type": "boolean",
      "weight": 5,
      "definition": "The agent secured a specific date and time and the caller confirmed it.",
      "failWhen": "The call ended without a confirmed slot.",
      "enabled": true
    }
  ],
  "reasoning": "one paragraph on why these criteria cover the agent's goal"
}`

export const RECOMMEND_SYSTEM_PROMPT = `You are a conversation-design consultant reviewing a Voice AI agent's failures.

You are given the agent's current prompt and clusters of failures observed
across real calls, with counts and verbatim quotes. Produce ranked, concrete
recommendations for changing the agent's prompt or script.

Rules:
- Rank by expected impact: how many calls the fix touches multiplied by how
  badly those calls failed.
- Ground every recommendation in the clusters you were given. Never invent a
  failure mode that is not in the data.
- Recommend a script change only for a concrete issue evidenced by those
  clusters. Do not add optional improvements, generic best practices, or
  positive-call suggestions just to populate the response. Return an empty
  items array when nothing needs changing.
- promptPatch must be text the user can paste into their agent prompt. Write the
  actual replacement wording, not a description of it. Use null only when the
  fix genuinely is not a prompt change (for example, a routing or staffing fix).
- diagnosis explains the mechanism: what the agent currently does, why callers
  react the way they do, and what changes.
- Return at most 4 recommendations. Fewer, sharper ones beat a long list.

Return JSON only:
{
  "items": [
    {
      "rank": 1,
      "title": "short imperative title",
      "diagnosis": "what is happening and why",
      "promptPatch": "text to paste, or null",
      "affectedCalls": 22,
      "evidenceCallIds": ["<uuid>"],
      "expectedImpact": "low" | "medium" | "high"
    }
  ]
}`
