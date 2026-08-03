import type { Criterion } from '@copilot/shared'

/**
 * Three reference agents used to seed a demo location.
 *
 * They exist because a HighLevel sandbox has no call history: the product has
 * to be demonstrable before the marketplace app is approved. Everything seeded
 * from here is flagged `isMock` in the database and labelled in the UI.
 */

export interface FixtureAgent {
  key: string
  ghlAgentId: string
  name: string
  prompt: string
  passThreshold: number
  partialThreshold: number
  criteria: Criterion[]
}

function criterion(c: Omit<Criterion, 'failWhen' | 'enabled'> & Partial<Criterion>): Criterion {
  return { failWhen: null, enabled: true, ...c }
}

export const FIXTURE_AGENTS: FixtureAgent[] = [
  {
    key: 'inbound_reception',
    ghlAgentId: 'mock-agent-inbound-reception',
    name: 'Inbound Receptionist',
    prompt: `You are Ava, the receptionist for Northside Dental.

Answer inbound calls. Identify yourself and the practice. Find out what the
caller needs. If they want an appointment, offer the next two available slots
and confirm one. Always capture a callback number. If the caller is in pain,
treat it as urgent and offer the earliest same-day slot. Do not give clinical
advice. Close by confirming what happens next.`,
    passThreshold: 70,
    partialThreshold: 40,
    criteria: [
      criterion({
        key: 'identified_practice',
        label: 'Identified self and practice',
        type: 'boolean',
        weight: 1,
        definition: 'The agent gave its name and named Northside Dental in the opening turns.',
      }),
      criterion({
        key: 'booked_appointment',
        label: 'Booked appointment',
        type: 'boolean',
        weight: 5,
        definition: 'The agent secured a specific day and time and the caller confirmed it.',
        failWhen: 'The call ended without a confirmed slot when the caller wanted one.',
      }),
      criterion({
        key: 'captured_callback',
        label: 'Captured callback number',
        type: 'boolean',
        weight: 3,
        definition: 'The agent obtained or confirmed a phone number to reach the caller on.',
      }),
      criterion({
        key: 'handled_urgency',
        label: 'Handled urgency correctly',
        type: 'boolean',
        weight: 4,
        definition:
          'If the caller reported pain or an emergency, the agent offered a same-day slot or escalated. If there was no urgency, this criterion is met by default.',
      }),
      criterion({
        key: 'confirmed_next_step',
        label: 'Confirmed next step',
        type: 'boolean',
        weight: 2,
        definition: 'The agent stated explicitly what happens next before ending the call.',
      }),
    ],
  },
  {
    key: 'outbound_qualifier',
    ghlAgentId: 'mock-agent-outbound-qualifier',
    name: 'Outbound Qualifier',
    prompt: `You are Max, calling homeowners who requested a solar quote.

Confirm you are speaking to the person who filled in the form. Qualify them on
three things: roof ownership, average monthly electricity bill, and timeline.
Only offer a consultation slot once all three are answered. If they raise
price, explain the financing options before returning to booking. Capture an
email address for the quote.`,
    passThreshold: 70,
    partialThreshold: 40,
    criteria: [
      criterion({
        key: 'confirmed_identity',
        label: 'Confirmed right person',
        type: 'boolean',
        weight: 2,
        definition: 'The agent verified it was speaking to the person who submitted the enquiry.',
      }),
      criterion({
        key: 'qualified_bill',
        label: 'Captured monthly bill',
        type: 'extraction',
        weight: 3,
        definition: 'The agent obtained the household average monthly electricity bill.',
      }),
      criterion({
        key: 'handled_price_objection',
        label: 'Handled price objection',
        type: 'boolean',
        weight: 4,
        definition:
          'If the caller raised cost or price, the agent explained financing options before moving on. If cost was never raised, this criterion is met by default.',
        failWhen: 'The agent deflected the price question or offered to have someone else explain.',
      }),
      criterion({
        key: 'booked_consultation',
        label: 'Booked consultation',
        type: 'boolean',
        weight: 5,
        definition: 'The agent secured a confirmed consultation date and time.',
      }),
      criterion({
        key: 'captured_email',
        label: 'Captured email',
        type: 'boolean',
        weight: 2,
        definition: 'The agent obtained a valid email address for sending the quote.',
      }),
      criterion({
        key: 'call_tone',
        label: 'Tone and pacing',
        type: 'scale',
        weight: 2,
        definition:
          'Rate 1-5 how well the agent listened: did it let the caller finish, acknowledge answers, and avoid talking over them?',
      }),
    ],
  },
  {
    key: 'after_hours_triage',
    ghlAgentId: 'mock-agent-after-hours-triage',
    name: 'After-Hours Triage',
    prompt: `You are the after-hours line for Harbour Property Management.

Collect the caller's name, property address, and the nature of the issue.
Classify it as emergency (flood, fire, no heat, no power, security) or routine.
Emergencies get the on-call number immediately. Routine issues get logged for
the next business day. Never promise a specific response time.`,
    passThreshold: 75,
    partialThreshold: 45,
    criteria: [
      criterion({
        key: 'captured_address',
        label: 'Captured property address',
        type: 'extraction',
        weight: 4,
        definition: 'The agent obtained the address of the property the issue relates to.',
      }),
      criterion({
        key: 'classified_severity',
        label: 'Classified severity',
        type: 'boolean',
        weight: 5,
        definition:
          'The agent established whether the issue was an emergency or routine, and routed accordingly.',
        failWhen: 'The agent logged an emergency as routine, or gave the on-call number for a routine issue.',
      }),
      criterion({
        key: 'avoided_time_promise',
        label: 'Avoided promising a time',
        type: 'boolean',
        weight: 3,
        definition: 'The agent did not commit to a specific response or arrival time.',
      }),
      criterion({
        key: 'captured_callback',
        label: 'Captured callback number',
        type: 'boolean',
        weight: 3,
        definition: 'The agent obtained or confirmed a number to call back on.',
      }),
    ],
  },
]

export function fixtureAgentByKey(key: string): FixtureAgent {
  const agent = FIXTURE_AGENTS.find((a) => a.key === key)
  if (!agent) throw new Error(`Unknown fixture agent: ${key}`)
  return agent
}
