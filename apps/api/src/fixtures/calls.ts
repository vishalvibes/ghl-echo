import type { CallDirection, CallOutcome, JudgeOutput } from '@copilot/shared'
import { normalizePlainText } from '../calls/normalize.js'
import type { Turn } from '@copilot/shared'

/**
 * Handcrafted demo calls, each paired with the evaluation a judge would
 * plausibly produce. The paired outputs serve two purposes:
 *   1. `USE_FIXTURES=true` + LLM disabled → seeded evaluations make the whole
 *      dashboard work with zero API keys.
 *   2. With the LLM enabled they become regression references — if the real
 *      judge disagrees wildly with these, the prompt drifted.
 *
 * Every call is inserted with `isMock: true`. Dates are assigned at seed time
 * by spreading `daysAgo` across the window, so trend charts have shape.
 */

export interface FixtureCall {
  agentKey: string
  ghlCallId: string
  contactName: string
  contactPhone: string
  direction: CallDirection
  outcome: CallOutcome
  durationSec: number
  daysAgo: number
  transcript: Turn[]
  judgeOutput: JudgeOutput
}

const t = normalizePlainText

export const FIXTURE_CALLS: FixtureCall[] = [
  // --- Inbound Receptionist: clean pass -------------------------------------
  {
    agentKey: 'inbound_reception',
    ghlCallId: 'mock-call-ir-001',
    contactName: 'Priya Sharma',
    contactPhone: '+14155550171',
    direction: 'inbound',
    outcome: 'completed',
    durationSec: 142,
    daysAgo: 1,
    transcript: t(`Agent: Good morning, this is Ava at Northside Dental. How can I help you today?
Caller: Hi, I'd like to book a cleaning sometime next week if possible.
Agent: Of course. I have Tuesday at 10am or Thursday at 2:30pm — do either of those work?
Caller: Thursday at 2:30 is perfect.
Agent: Great, Thursday at 2:30pm it is. Can I confirm the best number to reach you on?
Caller: This one — 415-555-0171.
Agent: Got it. You're booked for a cleaning Thursday at 2:30pm, and you'll get a text reminder the day before. Anything else?
Caller: No, that's everything, thanks.
Agent: Wonderful. See you Thursday, have a great day!`),
    judgeOutput: {
      summary:
        'Caller requested a cleaning; the agent offered two slots, confirmed Thursday 2:30pm, verified the callback number and closed with the next step.',
      callerSentiment: 'positive',
      criteria: [
        { key: 'identified_practice', met: true, value: null, confidence: 0.98, evidenceTurnIds: [0], rationale: 'Opened with name and practice.' },
        { key: 'booked_appointment', met: true, value: null, confidence: 0.97, evidenceTurnIds: [2, 3, 4], rationale: 'Thursday 2:30pm offered and confirmed.' },
        { key: 'captured_callback', met: true, value: null, confidence: 0.95, evidenceTurnIds: [4, 5], rationale: 'Number confirmed on the call.' },
        { key: 'handled_urgency', met: true, value: null, confidence: 0.9, evidenceTurnIds: [], rationale: 'No urgency raised; met by default.' },
        { key: 'confirmed_next_step', met: true, value: null, confidence: 0.95, evidenceTurnIds: [6], rationale: 'Restated booking and reminder text.' },
      ],
      findings: [],
      segments: [],
    },
  },

  // --- Inbound Receptionist: pain caller mishandled --------------------------
  {
    agentKey: 'inbound_reception',
    ghlCallId: 'mock-call-ir-002',
    contactName: 'Daniel Okafor',
    contactPhone: '+14155550138',
    direction: 'inbound',
    outcome: 'completed',
    durationSec: 118,
    daysAgo: 2,
    transcript: t(`Agent: Good afternoon, Northside Dental, this is Ava speaking.
Caller: Hi, I've had a really bad toothache since last night, it's throbbing and I barely slept.
Agent: I'm sorry to hear that. We have availability next Monday at 11am or Wednesday at 3pm.
Caller: Monday? It really hurts — is there nothing sooner?
Agent: Those are the next standard slots I'm showing. Would Monday at 11 work?
Caller: I guess, if that's all you have.
Agent: Booked for Monday at 11am then. Have a nice day!
Caller: Okay... thanks.`),
    judgeOutput: {
      summary:
        'Caller reported acute pain but was offered only standard slots days away. The agent never triggered the same-day urgency path and did not capture a callback number.',
      callerSentiment: 'negative',
      criteria: [
        { key: 'identified_practice', met: true, value: null, confidence: 0.97, evidenceTurnIds: [0], rationale: 'Practice and name given.' },
        { key: 'booked_appointment', met: true, value: null, confidence: 0.85, evidenceTurnIds: [4, 5, 6], rationale: 'Monday 11am was booked, though reluctantly.' },
        { key: 'captured_callback', met: false, value: null, confidence: 0.92, evidenceTurnIds: [], rationale: 'No number requested or confirmed.' },
        { key: 'handled_urgency', met: false, value: null, confidence: 0.95, evidenceTurnIds: [1, 2, 3, 4], rationale: 'Pain reported twice; no same-day slot or escalation offered.' },
        { key: 'confirmed_next_step', met: false, value: null, confidence: 0.8, evidenceTurnIds: [6], rationale: 'Closed abruptly without reminder or instructions.' },
      ],
      findings: [
        {
          type: 'missed_goal',
          severity: 'high',
          title: 'Urgent pain routed to standard booking',
          detail:
            'The caller described acute overnight pain twice. Script requires offering the earliest same-day slot or escalating; the agent offered slots five days out instead.',
          quote: "It really hurts — is there nothing sooner?",
          turnIds: [1, 3, 4],
        },
        {
          type: 'abrupt_ending',
          severity: 'medium',
          title: 'Closed without confirming details',
          detail: 'No callback number, no reminder, and a cheerful sign-off tone-mismatched to a caller in pain.',
          quote: null,
          turnIds: [6, 7],
        },
      ],
      segments: [
        { turnStart: 1, turnEnd: 5, actionType: 'human_followup', reason: 'Patient in acute pain booked five days out — front desk should call back with a same-day option.' },
        { turnStart: 2, turnEnd: 4, actionType: 'script_gap', reason: 'Agent had no urgency branch when the caller pushed back on timing.' },
      ],
    },
  },

  // --- Inbound Receptionist: partial — booked but no number ------------------
  {
    agentKey: 'inbound_reception',
    ghlCallId: 'mock-call-ir-003',
    contactName: 'Maria Reyes',
    contactPhone: '+14155550152',
    direction: 'inbound',
    outcome: 'completed',
    durationSec: 96,
    daysAgo: 4,
    transcript: t(`Agent: Northside Dental, Ava speaking, how can I help?
Caller: Hi, do you take Delta Dental insurance?
Agent: We do, yes — Delta Dental PPO plans are accepted here.
Caller: Oh good. Could I get in for a check-up?
Agent: Certainly. I can offer Friday at 9am or next Tuesday at 4pm.
Caller: Friday at 9 works.
Agent: You're set for Friday at 9am. Anything else I can help with?
Caller: No that's it, thank you!
Agent: Thanks for calling, see you Friday.`),
    judgeOutput: {
      summary:
        'Insurance question answered correctly and a check-up booked for Friday 9am, but the agent never captured a callback number or mentioned reminders.',
      callerSentiment: 'positive',
      criteria: [
        { key: 'identified_practice', met: true, value: null, confidence: 0.97, evidenceTurnIds: [0], rationale: 'Practice and name in the greeting.' },
        { key: 'booked_appointment', met: true, value: null, confidence: 0.95, evidenceTurnIds: [4, 5, 6], rationale: 'Friday 9am confirmed.' },
        { key: 'captured_callback', met: false, value: null, confidence: 0.9, evidenceTurnIds: [], rationale: 'Number never requested.' },
        { key: 'handled_urgency', met: true, value: null, confidence: 0.9, evidenceTurnIds: [], rationale: 'No urgency present.' },
        { key: 'confirmed_next_step', met: true, value: null, confidence: 0.7, evidenceTurnIds: [6, 8], rationale: 'Restated day and time, though no reminder mentioned.' },
      ],
      findings: [
        {
          type: 'missed_goal',
          severity: 'low',
          title: 'Callback number not captured',
          detail: 'Booking completed without confirming a contact number, so reminder texts may go to an unverified number.',
          quote: null,
          turnIds: [6],
        },
      ],
      segments: [],
    },
  },

  // --- Inbound Receptionist: caller gave up ----------------------------------
  {
    agentKey: 'inbound_reception',
    ghlCallId: 'mock-call-ir-004',
    contactName: 'Tom Whitfield',
    contactPhone: '+14155550119',
    direction: 'inbound',
    outcome: 'completed',
    durationSec: 74,
    daysAgo: 6,
    transcript: t(`Agent: Good morning, Northside Dental, Ava speaking.
Caller: Hi — how much is a crown, roughly?
Agent: Pricing depends on the specific treatment plan your dentist recommends.
Caller: Sure, but ballpark? Are we talking five hundred or two thousand?
Agent: I wouldn't be able to give an exact figure, every case is different.
Caller: Right. Okay. I'll ring around, thanks.
Agent: No problem, have a great day!`),
    judgeOutput: {
      summary:
        'Price shopper asked twice for a ballpark crown cost, got deflections both times, and left to call competitors. No booking attempt, no contact captured.',
      callerSentiment: 'negative',
      criteria: [
        { key: 'identified_practice', met: true, value: null, confidence: 0.97, evidenceTurnIds: [0], rationale: 'Standard greeting delivered.' },
        { key: 'booked_appointment', met: false, value: null, confidence: 0.95, evidenceTurnIds: [5], rationale: 'Caller ended the call to ring competitors.' },
        { key: 'captured_callback', met: false, value: null, confidence: 0.95, evidenceTurnIds: [], rationale: 'Nothing captured.' },
        { key: 'handled_urgency', met: true, value: null, confidence: 0.9, evidenceTurnIds: [], rationale: 'No urgency present.' },
        { key: 'confirmed_next_step', met: false, value: null, confidence: 0.9, evidenceTurnIds: [6], rationale: 'Call ended with no next step at all.' },
      ],
      findings: [
        {
          type: 'objection_unhandled',
          severity: 'high',
          title: 'Price question deflected twice, caller lost',
          detail:
            'The caller asked for a rough range twice. A range plus an offer of a free consultation would likely have kept them; instead they left to comparison-shop.',
          quote: "I'll ring around, thanks.",
          turnIds: [1, 2, 3, 4, 5],
        },
      ],
      segments: [
        { turnStart: 1, turnEnd: 5, actionType: 'script_gap', reason: 'No approved price-range script for common treatments — agent can only deflect.' },
        { turnStart: 5, turnEnd: 5, actionType: 'human_followup', reason: 'Warm lead lost to comparison shopping — worth a callback with pricing guidance.' },
      ],
    },
  },

  // --- Outbound Qualifier: textbook pass -------------------------------------
  {
    agentKey: 'outbound_qualifier',
    ghlCallId: 'mock-call-oq-001',
    contactName: 'Janet Liu',
    contactPhone: '+16285550107',
    direction: 'outbound',
    outcome: 'completed',
    durationSec: 231,
    daysAgo: 1,
    transcript: t(`Agent: Hi, is this Janet? This is Max from BrightSolar about the quote you requested online.
Caller: Oh yes, hi, that was me.
Agent: Great. Quick couple of questions so we send the right numbers — do you own the home on Cedar Lane?
Caller: Yes, we've been there eight years.
Agent: Perfect. And roughly what's your average monthly electricity bill?
Caller: Around $280 in summer, maybe $210 in winter.
Agent: That's very workable. Are you hoping to get this done soon, or just exploring?
Caller: If the numbers make sense, within the next few months.
Agent: Then the next step is a free 30-minute consultation. I have Wednesday at 5pm or Saturday at 10am.
Caller: Saturday morning is better.
Agent: Saturday at 10am it is. What's the best email for the quote ahead of that?
Caller: janet.liu@example.com.
Agent: Got it. You'll see the quote by Thursday and the consultant Saturday at 10. Thanks Janet!`),
    judgeOutput: {
      summary:
        'Fully qualified call: identity, ownership, bill and timeline all confirmed, consultation booked for Saturday 10am and email captured.',
      callerSentiment: 'positive',
      criteria: [
        { key: 'confirmed_identity', met: true, value: null, confidence: 0.97, evidenceTurnIds: [0, 1], rationale: 'Named the caller and the enquiry.' },
        { key: 'qualified_bill', met: true, value: '$210-280/month', confidence: 0.95, evidenceTurnIds: [4, 5], rationale: 'Range captured for both seasons.' },
        { key: 'handled_price_objection', met: true, value: null, confidence: 0.85, evidenceTurnIds: [], rationale: 'Cost never raised; met by default.' },
        { key: 'booked_consultation', met: true, value: null, confidence: 0.97, evidenceTurnIds: [8, 9, 10], rationale: 'Saturday 10am confirmed.' },
        { key: 'captured_email', met: true, value: null, confidence: 0.95, evidenceTurnIds: [10, 11], rationale: 'Email captured verbatim.' },
        { key: 'call_tone', met: true, value: 5, confidence: 0.9, evidenceTurnIds: [2, 6], rationale: 'Acknowledged each answer before moving on.' },
      ],
      findings: [],
      segments: [
        { turnStart: 0, turnEnd: 12, actionType: 'training_example', reason: 'Clean qualification flow worth using as the reference call for this script.' },
      ],
    },
  },

  // --- Outbound Qualifier: price objection deflected --------------------------
  {
    agentKey: 'outbound_qualifier',
    ghlCallId: 'mock-call-oq-002',
    contactName: 'Rob Castellanos',
    contactPhone: '+16285550143',
    direction: 'outbound',
    outcome: 'completed',
    durationSec: 187,
    daysAgo: 2,
    transcript: t(`Agent: Hi, is this Rob? Max here from BrightSolar about your solar quote request.
Caller: Yeah, that's me.
Agent: Great. Do you own the property on Hillcrest Drive?
Caller: I do.
Agent: And what's your average monthly electric bill, roughly?
Caller: Honestly my first question is cost. What does a system like this actually run?
Agent: There are a lot of variables there. Let me get you booked with a consultant who can walk through it.
Caller: I'd rather have a rough idea before I book anything.
Agent: The consultant really is the best person for exact figures. Does Thursday evening work?
Caller: Look, just email me something and I'll have a read.
Agent: Sure, I can do that. What's your email?
Caller: rob.c@example.com. Bye now.`),
    judgeOutput: {
      summary:
        'Qualification stalled the moment cost came up. The agent deflected to the consultant twice instead of using the financing script, and the caller downgraded to "email me something".',
      callerSentiment: 'negative',
      criteria: [
        { key: 'confirmed_identity', met: true, value: null, confidence: 0.95, evidenceTurnIds: [0, 1], rationale: 'Identity confirmed at open.' },
        { key: 'qualified_bill', met: false, value: null, confidence: 0.9, evidenceTurnIds: [4, 5], rationale: 'Bill question asked but never answered.' },
        { key: 'handled_price_objection', met: false, value: null, confidence: 0.95, evidenceTurnIds: [5, 6, 7, 8], rationale: 'Financing options never mentioned despite two direct cost questions.' },
        { key: 'booked_consultation', met: false, value: null, confidence: 0.95, evidenceTurnIds: [9], rationale: 'Caller declined and asked for email instead.' },
        { key: 'captured_email', met: true, value: null, confidence: 0.9, evidenceTurnIds: [10, 11], rationale: 'Email captured at the end.' },
        { key: 'call_tone', met: false, value: 2, confidence: 0.85, evidenceTurnIds: [6, 8], rationale: 'Repeated the same deflection instead of engaging with the question.' },
      ],
      findings: [
        {
          type: 'objection_unhandled',
          severity: 'high',
          title: 'Price question deflected instead of answered',
          detail:
            'The script has a financing branch for exactly this moment. The agent skipped it twice, so a qualified homeowner downgraded to a cold email lead.',
          quote: "I'd rather have a rough idea before I book anything.",
          turnIds: [5, 6, 7, 8],
        },
      ],
      segments: [
        { turnStart: 5, turnEnd: 9, actionType: 'objection_lost', reason: 'Cost objection raised twice and never addressed — the moment the call was lost.' },
        { turnStart: 9, turnEnd: 11, actionType: 'human_followup', reason: 'Lead requested pricing by email — a rep should send financing options and call back.' },
      ],
    },
  },

  // --- Outbound Qualifier: booked without qualifying --------------------------
  {
    agentKey: 'outbound_qualifier',
    ghlCallId: 'mock-call-oq-003',
    contactName: 'Aisha Bello',
    contactPhone: '+16285550178',
    direction: 'outbound',
    outcome: 'completed',
    durationSec: 121,
    daysAgo: 3,
    transcript: t(`Agent: Hi, is this Aisha? This is Max from BrightSolar about your quote request.
Caller: Yes, hi!
Agent: Wonderful. Let me find you a consultation time — I have tomorrow at 6pm or Friday at noon.
Caller: Um, tomorrow at 6 could work I suppose.
Agent: Excellent, you're booked for tomorrow at 6pm.
Caller: Should I have anything ready? Like our electric bills?
Agent: The consultant will cover all of that with you.
Caller: Alright then.
Agent: Thanks Aisha, talk soon!`),
    judgeOutput: {
      summary:
        'The agent jumped straight to booking without qualifying ownership, bill or timeline, and brushed off the caller\'s own offer to prepare bills. Slot booked but the consultation will start blind.',
      callerSentiment: 'neutral',
      criteria: [
        { key: 'confirmed_identity', met: true, value: null, confidence: 0.95, evidenceTurnIds: [0, 1], rationale: 'Identity confirmed.' },
        { key: 'qualified_bill', met: false, value: null, confidence: 0.95, evidenceTurnIds: [5, 6], rationale: 'Never asked; caller volunteered and was deflected.' },
        { key: 'handled_price_objection', met: true, value: null, confidence: 0.8, evidenceTurnIds: [], rationale: 'Cost not raised; met by default.' },
        { key: 'booked_consultation', met: true, value: null, confidence: 0.9, evidenceTurnIds: [2, 3, 4], rationale: 'Tomorrow 6pm booked.' },
        { key: 'captured_email', met: false, value: null, confidence: 0.95, evidenceTurnIds: [], rationale: 'Email never requested.' },
        { key: 'call_tone', met: false, value: 3, confidence: 0.75, evidenceTurnIds: [2, 6], rationale: 'Rushed; skipped acknowledgements to reach booking.' },
      ],
      findings: [
        {
          type: 'missed_goal',
          severity: 'medium',
          title: 'Booked without qualifying',
          detail:
            'Script requires ownership, bill and timeline before offering slots. None were asked, so the consultant walks in blind and no-show risk is higher.',
          quote: 'Let me find you a consultation time',
          turnIds: [2],
        },
        {
          type: 'poor_listening',
          severity: 'low',
          title: 'Brushed off caller-offered qualification',
          detail: 'The caller volunteered to prepare electric bills — exactly the data the script wants — and was deflected.',
          quote: 'The consultant will cover all of that with you.',
          turnIds: [5, 6],
        },
      ],
      segments: [
        { turnStart: 2, turnEnd: 6, actionType: 'script_gap', reason: 'Agent path allows reaching booking before qualification is complete.' },
      ],
    },
  },

  // --- Outbound Qualifier: voicemail -----------------------------------------
  {
    agentKey: 'outbound_qualifier',
    ghlCallId: 'mock-call-oq-004',
    contactName: 'Sean Murphy',
    contactPhone: '+16285550120',
    direction: 'outbound',
    outcome: 'voicemail',
    durationSec: 32,
    daysAgo: 5,
    transcript: t(`System: Call connected to voicemail.
Agent: Hi, this message is for Sean. It's Max from BrightSolar about the solar quote you requested. I'll try you again tomorrow, or you can call us back on 628-555-0100. Thanks!`),
    judgeOutput: {
      summary: 'Voicemail reached; a compliant callback message was left. Not a judgeable conversation.',
      callerSentiment: 'neutral',
      criteria: [
        { key: 'confirmed_identity', met: false, value: null, confidence: 0.5, evidenceTurnIds: [], rationale: 'No live caller.' },
        { key: 'qualified_bill', met: false, value: null, confidence: 0.5, evidenceTurnIds: [], rationale: 'No live caller.' },
        { key: 'handled_price_objection', met: true, value: null, confidence: 0.5, evidenceTurnIds: [], rationale: 'Not applicable on voicemail.' },
        { key: 'booked_consultation', met: false, value: null, confidence: 0.5, evidenceTurnIds: [], rationale: 'No live caller.' },
        { key: 'captured_email', met: false, value: null, confidence: 0.5, evidenceTurnIds: [], rationale: 'No live caller.' },
        { key: 'call_tone', met: true, value: 4, confidence: 0.6, evidenceTurnIds: [1], rationale: 'Clear, short, actionable message.' },
      ],
      findings: [],
      segments: [],
    },
  },

  // --- After-Hours Triage: emergency handled right ----------------------------
  {
    agentKey: 'after_hours_triage',
    ghlCallId: 'mock-call-ah-001',
    contactName: 'Gwen Park',
    contactPhone: '+19175550163',
    direction: 'inbound',
    outcome: 'completed',
    durationSec: 156,
    daysAgo: 2,
    transcript: t(`Agent: Harbour Property Management after-hours line, how can I help?
Caller: Hi — there's water coming through my kitchen ceiling, it started about twenty minutes ago.
Agent: That's an emergency, let's move quickly. Can I take your name and the property address?
Caller: Gwen Park, unit 4B at 210 Marina Way.
Agent: Thank you Gwen. Is the water near any light fixtures or outlets?
Caller: It's close to the ceiling light, yes.
Agent: Please don't touch that switch. The on-call maintenance number is 917-555-0100 — they answer 24/7. I'm also logging this now with everything you've told me.
Caller: Okay, calling them now.
Agent: Before you go — is this the best number to reach you on tonight?
Caller: Yes, this one.
Agent: Logged. Call the on-call line right away, they're expecting emergencies like this.`),
    judgeOutput: {
      summary:
        'Active leak classified as an emergency immediately; address captured, a live safety warning given, on-call number provided and callback number confirmed.',
      callerSentiment: 'neutral',
      criteria: [
        { key: 'captured_address', met: true, value: 'unit 4B, 210 Marina Way', confidence: 0.97, evidenceTurnIds: [2, 3], rationale: 'Full address captured.' },
        { key: 'classified_severity', met: true, value: null, confidence: 0.97, evidenceTurnIds: [2, 6], rationale: 'Named it an emergency and routed to on-call.' },
        { key: 'avoided_time_promise', met: true, value: null, confidence: 0.9, evidenceTurnIds: [6], rationale: 'No arrival time promised.' },
        { key: 'captured_callback', met: true, value: null, confidence: 0.95, evidenceTurnIds: [8, 9], rationale: 'Number confirmed explicitly.' },
      ],
      findings: [],
      segments: [
        { turnStart: 4, turnEnd: 6, actionType: 'training_example', reason: 'Unprompted electrical-safety check is exactly the behaviour to reinforce.' },
      ],
    },
  },

  // --- After-Hours Triage: emergency misclassified ----------------------------
  {
    agentKey: 'after_hours_triage',
    ghlCallId: 'mock-call-ah-002',
    contactName: 'Victor Hames',
    contactPhone: '+19175550149',
    direction: 'inbound',
    outcome: 'completed',
    durationSec: 133,
    daysAgo: 3,
    transcript: t(`Agent: Harbour Property Management after-hours line, how can I help?
Caller: Our heating's been completely dead since this morning and it's meant to drop below freezing tonight. We've got a newborn here.
Agent: I'm sorry about that. I'll log a maintenance request for the heating system.
Caller: Tonight though? It's going to be freezing. Isn't this urgent?
Agent: The maintenance team will pick it up first thing on the next business day.
Caller: That's Monday! It's Friday night and we have a baby.
Agent: I understand. I've noted the urgency in the ticket. Can I get the property address?
Caller: 88 Colton Street. This is ridiculous.
Agent: It's logged. The team will be in touch. Goodnight.`),
    judgeOutput: {
      summary:
        'No-heat call on a sub-freezing night with an infant — squarely an emergency per script — was logged as routine for Monday. Caller left angry; no callback number taken.',
      callerSentiment: 'negative',
      criteria: [
        { key: 'captured_address', met: true, value: '88 Colton Street', confidence: 0.9, evidenceTurnIds: [6, 7], rationale: 'Address captured late in the call.' },
        { key: 'classified_severity', met: false, value: null, confidence: 0.97, evidenceTurnIds: [1, 2, 4, 8], rationale: 'No-heat below freezing is an emergency; routed as routine.' },
        { key: 'avoided_time_promise', met: true, value: null, confidence: 0.85, evidenceTurnIds: [4], rationale: 'Only the standard next-business-day framing given.' },
        { key: 'captured_callback', met: false, value: null, confidence: 0.9, evidenceTurnIds: [], rationale: 'Never requested.' },
      ],
      findings: [
        {
          type: 'compliance_risk',
          severity: 'high',
          title: 'No-heat emergency logged as routine',
          detail:
            'Script lists "no heat" as an emergency requiring the on-call number. Freezing forecast plus an infant compounds the habitability risk. Routed to Monday instead.',
          quote: "It's Friday night and we have a baby.",
          turnIds: [1, 3, 4, 5],
        },
      ],
      segments: [
        { turnStart: 1, turnEnd: 5, actionType: 'human_followup', reason: 'Tenant must be called back tonight with the on-call number — habitability issue.' },
        { turnStart: 2, turnEnd: 4, actionType: 'script_gap', reason: 'Agent did not map "no heat" onto its own emergency list when phrased conversationally.' },
      ],
    },
  },

  // --- After-Hours Triage: routine handled fine, minor slip -------------------
  {
    agentKey: 'after_hours_triage',
    ghlCallId: 'mock-call-ah-003',
    contactName: 'Lena Fischer',
    contactPhone: '+19175550188',
    direction: 'inbound',
    outcome: 'completed',
    durationSec: 104,
    daysAgo: 5,
    transcript: t(`Agent: Harbour Property Management after-hours line, how can I help?
Caller: Hi, not an emergency — the dishwasher in my unit has stopped draining.
Agent: Thanks for flagging it. Can I take your name and the property address?
Caller: Lena Fischer, 12 Beacon Court, apartment 9.
Agent: Got it. I'll log this for the maintenance team and someone will be out to you by tomorrow afternoon at the latest.
Caller: Great, this number is the best one to reach me.
Agent: Noted. You'll hear from the team soon.`),
    judgeOutput: {
      summary:
        'Routine dishwasher issue logged correctly with address and callback captured, but the agent promised "tomorrow afternoon at the latest", which the script forbids.',
      callerSentiment: 'positive',
      criteria: [
        { key: 'captured_address', met: true, value: '12 Beacon Court, apt 9', confidence: 0.95, evidenceTurnIds: [2, 3], rationale: 'Full address captured.' },
        { key: 'classified_severity', met: true, value: null, confidence: 0.95, evidenceTurnIds: [1, 4], rationale: 'Correctly treated as routine.' },
        { key: 'avoided_time_promise', met: false, value: null, confidence: 0.95, evidenceTurnIds: [4], rationale: 'Committed to "tomorrow afternoon at the latest".' },
        { key: 'captured_callback', met: true, value: null, confidence: 0.9, evidenceTurnIds: [5, 6], rationale: 'Caller confirmed the number; agent acknowledged.' },
      ],
      findings: [
        {
          type: 'incorrect_information',
          severity: 'medium',
          title: 'Promised a response time',
          detail:
            'Script explicitly forbids committing to response times. "Tomorrow afternoon at the latest" creates an expectation maintenance may not meet.',
          quote: 'someone will be out to you by tomorrow afternoon at the latest',
          turnIds: [4],
        },
      ],
      segments: [
        { turnStart: 4, turnEnd: 4, actionType: 'script_gap', reason: 'Agent invents time commitments when reassuring callers — needs an approved phrasing.' },
      ],
    },
  },
]
