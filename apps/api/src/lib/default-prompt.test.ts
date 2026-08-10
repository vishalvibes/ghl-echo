import { describe, expect, it } from 'vitest'
import { defaultAgentPrompt } from './default-prompt.js'

describe('defaultAgentPrompt', () => {
  it('loads the repo default prompt fixture', () => {
    const prompt = defaultAgentPrompt()
    expect(prompt).toContain('# Role')
    expect(prompt.length).toBeGreaterThan(200)
    expect(defaultAgentPrompt()).toBe(prompt)
  })
})
