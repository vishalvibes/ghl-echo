import type { FindingType, SegmentAction, Verdict } from './evaluation.js'

/**
 * Display strings for the fixed taxonomies. Kept next to the schemas so the
 * API (aggregations) and the dashboard (chips, legends) never drift apart.
 */

export const FINDING_TYPE_LABELS: Record<FindingType, string> = {
  missed_goal: 'Missed goal',
  objection_unhandled: 'Objection unhandled',
  incorrect_information: 'Incorrect information',
  compliance_risk: 'Compliance risk',
  poor_listening: 'Poor listening',
  abrupt_ending: 'Abrupt ending',
  missed_upsell: 'Missed upsell',
  escalation_needed: 'Escalation needed',
}

export const SEGMENT_ACTION_LABELS: Record<SegmentAction, string> = {
  human_followup: 'Human follow-up',
  script_gap: 'Script gap',
  objection_lost: 'Objection lost',
  compliance_review: 'Compliance review',
  training_example: 'Training example',
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  pass: 'Pass',
  partial: 'Partial',
  fail: 'Fail',
}
