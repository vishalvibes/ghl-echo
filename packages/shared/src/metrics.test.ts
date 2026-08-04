import { describe, expect, it } from 'vitest'
import { computeTranscriptMetrics } from './metrics.js'
import type { Turn, TurnRole } from './transcript.js'

/** Build a transcript without repeating the id/startMs boilerplate. */
function transcript(...entries: Array<[TurnRole, string]>): Turn[] {
  return entries.map(([role, text], id) => ({ id, role, text, startMs: null }))
}

describe('computeTranscriptMetrics', () => {
  it('counts turns and words per role, ignoring system turns', () => {
    const metrics = computeTranscriptMetrics(
      transcript(
        ['system', 'Call connected to agent.'],
        ['agent', 'Thanks for calling, how can I help?'],
        ['caller', 'I need a quote.'],
      ),
    )

    expect(metrics.turns).toEqual({ total: 3, agent: 1, caller: 1 })
    expect(metrics.words).toEqual({ agent: 7, caller: 4 })
  })

  it('reports talk ratio as the agent share of spoken words', () => {
    const metrics = computeTranscriptMetrics(
      transcript(['agent', 'one two three'], ['caller', 'four']),
    )

    expect(metrics.talkRatio).toBeCloseTo(0.75)
  })

  it('returns a null talk ratio when nobody spoke', () => {
    expect(computeTranscriptMetrics([]).talkRatio).toBeNull()
    expect(computeTranscriptMetrics(transcript(['system', 'Voicemail.'])).talkRatio).toBeNull()
  })

  it('flags turns the transcriber marked as unclear, with or without punctuation', () => {
    const metrics = computeTranscriptMetrics(
      transcript(
        ['caller', 'I need to book (unintelligible) next week'],
        ['agent', 'Could you repeat that?'],
        ['caller', '[inaudible]'],
        ['caller', 'Next Tuesday.'],
      ),
    )

    expect(metrics.unclearTurnIds).toEqual([0, 2])
  })

  describe('endpointing', () => {
    it('is unavailable when the source transcript has no punctuation', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['agent', 'thanks for calling how can i help'],
          ['caller', 'i wanted to ask about the'],
        ),
      )

      expect(metrics.endpointing).toBeNull()
    })

    it('flags a caller turn that stops on a hanging word', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['agent', 'How can I help?'],
          ['caller', 'I need to reschedule my appointment for'],
          ['agent', 'Let me pull that up.'],
        ),
      )

      expect(metrics.endpointing?.truncatedTurnIds).toEqual([1])
    })

    it('does not flag a complete utterance that merely lacks a full stop', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['agent', 'How can I help?'],
          ['caller', 'I need help with my account'],
        ),
      )

      expect(metrics.endpointing?.truncatedTurnIds).toEqual([])
      expect(metrics.endpointing?.interruptionRate).toBe(0)
    })

    it('counts an interruption when the agent speaks over a cut-off caller', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['agent', 'How can I help?'],
          ['caller', 'I was calling because'],
          ['agent', 'Sure, I can book that for you.'],
        ),
      )

      expect(metrics.endpointing?.interruptedTurnIds).toEqual([1])
      expect(metrics.endpointing?.interruptionRate).toBe(1)
    })

    it('treats a caller who continues themselves as trailing off, not interrupted', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['agent', 'How can I help?'],
          ['caller', 'I was calling because'],
          ['caller', 'my invoice looks wrong.'],
        ),
      )

      expect(metrics.endpointing?.truncatedTurnIds).toEqual([1])
      expect(metrics.endpointing?.interruptedTurnIds).toEqual([])
    })

    it('looks past a system turn to find who actually spoke next', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['agent', 'How can I help?'],
          ['caller', 'I need to talk about my'],
          ['system', 'Hold music started.'],
          ['agent', 'Transferring you now.'],
        ),
      )

      expect(metrics.endpointing?.interruptedTurnIds).toEqual([1])
    })
  })

  describe('comprehension', () => {
    it('flags the agent asking the caller to repeat themselves', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['caller', 'Upper right molar, the filling came loose.'],
          ['agent', 'Sorry, could you repeat which tooth it was?'],
          ['agent', "I didn't catch that."],
        ),
      )

      expect(metrics.comprehension.agentRepeatRequestTurnIds).toEqual([1, 2])
    })

    it('flags a caller left talking to silence', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['caller', 'Upper right, near the back. Hello? Are you still there?'],
          ['caller', 'Hello?'],
          ['caller', 'I would like to book an appointment.'],
        ),
      )

      expect(metrics.comprehension.unansweredCallerTurnIds).toEqual([0, 1])
    })

    it('catches a breakdown that turn-similarity alone would call a clean call', () => {
      // Taken from a real Northside Dental call: the caller never repeats
      // themselves, so repeatPairs stays empty — but the agent asks for a
      // repeat and the caller ends up talking to nobody.
      const metrics = computeTranscriptMetrics(
        transcript(
          ['agent', 'Northside Dental, this is Ava. How can I help?'],
          ['caller', 'Hi, I need to get in for a filling that came loose.'],
          ['agent', 'Let me check the calendar for you. One moment.'],
          ['caller', 'Sure.'],
          ['agent', "Okay, so for a filling we'd want to get you in with — sorry, could you repeat which tooth it was?"],
          ['caller', 'Upper right, near the back. Hello? Are you still there?'],
          ['caller', 'Hello?'],
        ),
      )

      expect(metrics.comprehension.repeatPairs).toEqual([])
      expect(metrics.comprehension.agentRepeatRequestTurnIds).toEqual([4])
      expect(metrics.comprehension.unansweredCallerTurnIds).toEqual([5, 6])
    })

    it('does not mistake a normal greeting for an unanswered check-in', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['agent', 'Hello, thanks for calling.'],
          ['caller', 'Hi, I need to book an appointment.'],
        ),
      )

      expect(metrics.comprehension.unansweredCallerTurnIds).toEqual([])
    })
  })

  describe('repetition', () => {
    it('pairs a caller turn with the earlier turn it restates', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['caller', 'I want to reschedule my dental appointment to Friday.'],
          ['agent', 'Sorry, could you repeat that?'],
          ['caller', 'Reschedule the dental appointment, Friday.'],
        ),
      )

      expect(metrics.comprehension.repeatPairs).toEqual([{ firstTurnId: 0, repeatedTurnId: 2 }])
      expect(metrics.comprehension.callerRepeatRate).toBe(0.5)
    })

    it('matches a third attempt against the earliest phrasing only', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['caller', 'I want to reschedule my dental appointment to Friday.'],
          ['agent', 'Sorry?'],
          ['caller', 'Reschedule the dental appointment, Friday.'],
          ['agent', 'I did not catch that.'],
          ['caller', 'Dental appointment — reschedule it to Friday.'],
        ),
      )

      expect(metrics.comprehension.repeatPairs).toEqual([
        { firstTurnId: 0, repeatedTurnId: 2 },
        { firstTurnId: 0, repeatedTurnId: 4 },
      ])
    })

    it('ignores short confirmations that would trivially overlap', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['caller', 'Yes okay.'],
          ['agent', 'And your name?'],
          ['caller', 'Yes, okay.'],
        ),
      )

      expect(metrics.comprehension.repeatPairs).toEqual([])
    })

    it('does not pair unrelated turns that share one topic word', () => {
      const metrics = computeTranscriptMetrics(
        transcript(
          ['caller', 'I would like to book an appointment next Tuesday morning.'],
          ['caller', 'Also, does the appointment include a follow-up consultation?'],
        ),
      )

      expect(metrics.comprehension.repeatPairs).toEqual([])
    })
  })
})
