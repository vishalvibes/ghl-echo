import { describe, expect, it } from 'vitest'
import { delta, duration, pct, turnStamp } from './format.js'

describe('format helpers', () => {
  it('renders percentages rounded to whole points', () => {
    expect(pct(0.714)).toBe('71%')
    expect(pct(0)).toBe('0%')
    expect(pct(1)).toBe('100%')
  })

  it('renders signed point deltas with a dash for zero', () => {
    expect(delta(0.031)).toBe('▲ 3pt')
    expect(delta(-0.12)).toBe('▼ 12pt')
    expect(delta(0.001)).toBe('—')
  })

  it('renders durations as m/s with zero-padded seconds', () => {
    expect(duration(161)).toBe('2m 41s')
    expect(duration(62)).toBe('1m 02s')
    expect(duration(45)).toBe('45s')
  })

  it('renders turn timestamps from milliseconds', () => {
    expect(turnStamp(4000)).toBe('0:04')
    expect(turnStamp(75_000)).toBe('1:15')
    expect(turnStamp(null)).toBe('')
  })
})
