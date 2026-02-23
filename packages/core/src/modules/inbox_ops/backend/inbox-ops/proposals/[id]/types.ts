import type { ThreadMessage, ExtractedParticipant, InboxActionType, InboxDiscrepancyType } from '../../../../data/entities'

export type ProposalDetail = {
  id: string
  summary: string
  confidence: string
  status: string
  participants: ExtractedParticipant[]
  possiblyIncomplete: boolean
  llmModel?: string
  workingLanguage?: string | null
  createdAt: string
}

export type ActionDetail = {
  id: string
  proposalId: string
  sortOrder: number
  actionType: InboxActionType
  description: string
  payload: Record<string, unknown>
  status: string
  confidence: string
  requiredFeature?: string
  createdEntityId?: string
  createdEntityType?: string
  executionError?: string
  executedAt?: string
}

export type DiscrepancyDetail = {
  id: string
  type: InboxDiscrepancyType
  severity: string
  description: string
  expectedValue?: string
  foundValue?: string
  resolved: boolean
  actionId?: string
}

export type EmailDetail = {
  id: string
  subject: string
  forwardedByAddress: string
  forwardedByName?: string
  cleanedText?: string
  threadMessages?: ThreadMessage[]
  status: string
  processingError?: string
  receivedAt: string
}
