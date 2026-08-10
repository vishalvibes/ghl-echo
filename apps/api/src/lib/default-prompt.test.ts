import { describe, expect, it } from 'vitest'
import { agents } from '../db/schema.js'
import { defaultAgentPrompt } from './default-prompt.js'

describe('defaultAgentPrompt', () => {
  it('loads the repo default prompt fixture', () => {
    const prompt = defaultAgentPrompt()
    expect(prompt).toContain('# Role')
    expect(prompt.length).toBeGreaterThan(200)
    expect(defaultAgentPrompt()).toBe(prompt)
  })

  it('is the required database default for every new agent', () => {
    expect(agents.prompt.notNull).toBe(true)
    expect(agents.prompt.hasDefault).toBe(true)
    expect(agents.prompt.default).toBe(defaultAgentPrompt())
  })
})
