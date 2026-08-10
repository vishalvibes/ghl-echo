import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Canonical starter prompt for synthetic testing (`agents.prompt`).
 * Loaded once from the repo fixture; new agents get this seeded automatically.
 */
let cached: string | null = null

export function defaultAgentPrompt(): string {
  if (cached) return cached
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../Test/Prompts/default-prompt.md',
  )
  cached = readFileSync(path, 'utf8')
  return cached
}
