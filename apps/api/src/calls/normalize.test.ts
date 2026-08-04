import { describe, expect, it } from 'vitest'
import { isJudgeable, normalizePlainText, normalizeTranscript } from './normalize.js'

describe('call transcript normalization', () => {
  it('maps provider role aliases onto agent / caller / system', () => {
    const turns = normalizeTranscript([
      { role: 'assistant', text: 'Hi there' },
      { role: 'customer', text: 'Hello' },
      { role: 'voicemail_beep', text: 'beep' },
    ])

    expect(turns.map((t) => t.role)).toEqual(['agent', 'caller', 'system'])
  })

  it('reads text from whichever field the provider used', () => {
    const turns = normalizeTranscript([
      { role: 'agent', message: 'from message' },
      { role: 'agent', transcript: 'from transcript' },
      { role: 'agent', content: 'from content' },
    ])

    expect(turns.map((t) => t.text)).toEqual(['from message', 'from transcript', 'from content'])
  })

  it('assigns dense ids after dropping empty turns', () => {
    const turns = normalizeTranscript([
      { role: 'agent', text: 'one' },
      { role: 'caller', text: '   ' },
      { role: 'agent', text: 'two' },
    ])

    expect(turns.map((t) => t.id)).toEqual([0, 1])
    expect(turns.map((t) => t.text)).toEqual(['one', 'two'])
  })

  it('treats sub-1000 timestamps as seconds and larger ones as milliseconds', () => {
    const turns = normalizeTranscript([
      { role: 'agent', text: 'a', startTime: 4 },
      { role: 'caller', text: 'b', startTime: 12500 },
    ])

    expect(turns[0]?.startMs).toBe(4000)
    expect(turns[1]?.startMs).toBe(12500)
  })

  it('leaves startMs null when the provider gives no timing', () => {
    expect(normalizeTranscript([{ role: 'agent', text: 'a' }])[0]?.startMs).toBeNull()
  })
})

describe('normalizePlainText', () => {
  it('splits speaker-prefixed lines into turns', () => {
    const turns = normalizePlainText('Agent: Hello there\nCaller: Hi, who is this?')

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ id: 0, role: 'agent', text: 'Hello there' })
    expect(turns[1]).toMatchObject({ id: 1, role: 'caller', text: 'Hi, who is this?' })
  })

  it('folds unprefixed lines into the previous speaker', () => {
    const turns = normalizePlainText('Agent: Hello there\nand welcome\nCaller: Hi')

    expect(turns[0]?.text).toBe('Hello there and welcome')
    expect(turns).toHaveLength(2)
  })
})

describe('isJudgeable', () => {
  it('rejects calls too short to say anything about', () => {
    expect(isJudgeable(normalizePlainText('Agent: Hello?\nCaller: Wrong number'))).toBe(false)
  })

  it('accepts a call with enough substance', () => {
    const text = [
      'Agent: Hi, this is Ava calling from Northside Dental about your appointment request.',
      'Caller: Oh right, yes, I filled that form in yesterday afternoon.',
      'Agent: Perfect. I have Thursday at two or Friday at ten, which suits you better?',
      'Caller: Thursday at two works for me.',
    ].join('\n')

    expect(isJudgeable(normalizePlainText(text))).toBe(true)
  })
})
