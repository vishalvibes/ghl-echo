import {
  handleTestCasesConfirm,
  handleTestCasesRun,
  handleTestCasesSuggest,
} from './agent-testing.js'
import { handleAgentBackfill, handleCallEvent } from './call-events.js'
import { reconcilePendingWork } from './reconciliation.js'
import { handleWebhookEvent } from './webhook-events.js'

export const eventHandlers = [
  handleWebhookEvent,
  handleCallEvent,
  handleAgentBackfill,
  reconcilePendingWork,
  handleTestCasesConfirm,
  handleTestCasesRun,
  handleTestCasesSuggest,
]
