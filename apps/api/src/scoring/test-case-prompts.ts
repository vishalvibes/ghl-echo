/**
 * Prompts for the agent testing loop: propose short edge cases from goals,
 * then expand each into scenario + criteria table + mock past-call transcripts.
 */

export const PROPOSE_EDGE_CASES_SYSTEM_PROMPT = `You design failure scenarios for testing a Voice AI phone agent.

Given the agent's prompt and the user's testing goals, propose short, concrete
edge cases — one-line descriptions of failure conditions worth probing.

Rules:
- Each edge case is a single sentence (max ~120 chars) naming the failure mode.
- Cover the stated goals; prefer distinct failure modes over near-duplicates.
- Stay grounded in what a transcript can show (no CRM-only or audio-only failures).
- Propose 4-8 edge cases unless fewer goals make that excessive.

Return JSON only:
{
  "edgeCases": [
    "Caller refuses SMS consent and agent keeps pushing the link.",
    "New lead never states a business type and agent books anyway."
  ]
}`

export function buildProposeEdgeCasesUserPrompt(args: {
  agentName: string
  agentPrompt: string
  goals: string[]
}): string {
  return `AGENT NAME: ${args.agentName}

TESTING GOALS:
${args.goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')}

AGENT PROMPT:
"""
${args.agentPrompt.slice(0, 8000)}
"""`
}

export const EXPAND_TEST_CASE_SYSTEM_PROMPT = `You expand one Voice AI agent edge case into a prompt-evaluation pack.

Return THREE separate artifacts — do not blend them:

1. scenario — step-by-step outline of how this situation unfolds (what the caller
   does / what the agent faces). Short steps only. Not criteria. Not a transcript.

2. criteria — objective checklist for a table. Each item: key (lower_snake_case),
   label (short), description (one clear pass condition). Judgable from a transcript.

3. transcripts — 2-4 COMPLETE mock past calls. Each is a realistic phone conversation
   with BOTH caller and agent turns. These stand in for calls a user might have had;
   they are used only to score the current agent prompt. Write natural spoken dialogue,
   not narration or criteria text. Vary the mocks (different phrasings / paths) while
   still exercising this edge case.

Transcript turn shape:
{ "id": <0-based int>, "role": "agent"|"caller"|"system", "text": "...", "startMs": null }
- ids contiguous from 0 within each transcript
- 8-30 turns per mock; include both agent and caller

Return JSON only:
{
  "scenario": [
    "Caller is a new lead asking about missed-call follow-ups.",
    "Caller declines to name their business type when asked.",
    "Agent should explain why and seek a minimal alternative before booking."
  ],
  "criteria": [
    {
      "key": "clarifies_business_type",
      "label": "Clarifies missing business type",
      "description": "After the caller declines, the agent briefly explains relevance and asks for a minimal category before routing or booking."
    }
  ],
  "transcripts": [
    [
      { "id": 0, "role": "agent", "text": "Hi, thanks for calling — how can I help?", "startMs": null },
      { "id": 1, "role": "caller", "text": "I need help with missed-call follow-ups.", "startMs": null }
    ]
  ]
}`

export function buildExpandTestCaseUserPrompt(args: {
  agentName: string
  agentPrompt: string
  goals: string[]
  edgeCase: string
}): string {
  return `AGENT NAME: ${args.agentName}

TESTING GOALS:
${args.goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')}

EDGE CASE TO EXPAND:
${args.edgeCase}

AGENT PROMPT:
"""
${args.agentPrompt.slice(0, 8000)}
"""`
}

export const SUGGEST_TEST_PROMPT_SYSTEM = `You revise a Voice AI agent's system prompt so it better passes failed
synthetic test criteria.

You receive the current prompt and a list of failed criteria (with rationales
from mock call judgements). Produce a FULL revised prompt that:

- Keeps the same structure, role, and overall style as the current prompt.
- Makes only minimal, targeted edits that address the failed criteria.
- Does not invent unrelated product features or remove working instructions.
- Is paste-ready as the complete agent prompt (not a patch snippet).

Also write a short summary (2-4 sentences) of what you changed and why.

Return JSON only:
{
  "summary": "...",
  "revisedPrompt": "full prompt text..."
}`

export function buildSuggestTestPromptUser(args: {
  agentName: string
  currentPrompt: string
  failures: Array<{
    edgeCase: string
    criterionLabel: string
    criterionDescription: string
    rationale: string
    feedback: string | null
  }>
}): string {
  const failureBlock = args.failures
    .map(
      (f, i) =>
        `${i + 1}. Edge: ${f.edgeCase}
   Criterion: ${f.criterionLabel}
   Expect: ${f.criterionDescription}
   Judge: ${f.rationale}${f.feedback ? `\n   Tip: ${f.feedback}` : ''}`,
    )
    .join('\n\n')

  return `AGENT NAME: ${args.agentName}

FAILED CRITERIA FROM MOCK CALLS:
${failureBlock}

CURRENT PROMPT:
"""
${args.currentPrompt.slice(0, 50_000)}
"""`
}
