import { callQualitySchema, type CallQuality, type Transcript } from '@copilot/shared'
import { completeStructured, type StructuredResult } from '../lib/llm.js'
import {
  buildQualityUserPrompt,
  QUALITY_SYSTEM_PROMPT,
  type QualityPromptInput,
} from './quality-prompt.js'

/**
 * The single quality pass: one prompt, one schema, one JSON object.
 *
 * Kept separate from the scorecard judge on purpose. The judge needs an active
 * scorecard and answers "did this agent meet *your* criteria"; this answers
 * "how did this call actually go" for any call, including the many that have
 * no scorecard yet. Folding it into the judge would make the baseline
 * unavailable exactly when the dashboard has least else to show.
 */

export type QualityResult = StructuredResult<CallQuality>

/** Run the quality pass. Throws `LlmDisabledError` when the LLM is off. */
export async function assessCallQuality(input: QualityPromptInput): Promise<QualityResult> {
  return completeStructured({
    system: QUALITY_SYSTEM_PROMPT,
    user: buildQualityUserPrompt(input),
    schema: callQualitySchema,
  })
}

/**
 * Drop citations pointing at turns that do not exist, mirroring the judge's
 * treatment of its own output. A highlight aimed at turn 47 of a 12-turn call
 * makes the whole dashboard look broken.
 */
export function sanitizeQuality(quality: CallQuality, transcript: Transcript): CallQuality {
  const valid = new Set(transcript.map((t) => t.id))
  const keep = (ids: number[]) => ids.filter((id) => valid.has(id))

  return {
    ...quality,
    outcome: { ...quality.outcome, evidenceTurnIds: keep(quality.outcome.evidenceTurnIds) },
    scriptAdherence: { ...quality.scriptAdherence, evidenceTurnIds: keep(quality.scriptAdherence.evidenceTurnIds) },
    comprehension: { ...quality.comprehension, misunderstoodTurnIds: keep(quality.comprehension.misunderstoodTurnIds) },
    missedOpportunities: quality.missedOpportunities.map((m) => ({ ...m, evidenceTurnIds: keep(m.evidenceTurnIds) })),
  }
}
