import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type {
  ExtractedParticipant,
  InboxEmail,
  InboxProposal,
  InboxProposalAction,
  ProposalTranslations,
  ThreadMessage,
} from '../data/entities'

function parseDecryptedJson(value: unknown): unknown {
  return typeof value === 'string' ? parseDecryptedFieldValue(value) : value
}

function asArray<T>(value: unknown): T[] {
  const parsed = parseDecryptedJson(value)
  return Array.isArray(parsed) ? parsed as T[] : []
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = parseDecryptedJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

function asNullableRecord<T extends Record<string, unknown>>(value: unknown): T | null {
  if (value == null) return null
  const parsed = parseDecryptedJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as T
    : null
}

export function serializeInboxProposal(proposal: InboxProposal) {
  return {
    ...proposal,
    participants: asArray<ExtractedParticipant>(proposal.participants),
    translations: asNullableRecord<ProposalTranslations>(proposal.translations),
  }
}

export function serializeInboxProposalAction(action: InboxProposalAction) {
  return {
    ...action,
    payload: asRecord(action.payload),
  }
}

export function serializeInboxEmail(email: InboxEmail | null) {
  if (!email) return null
  return {
    ...email,
    threadMessages: asArray<ThreadMessage>(email.threadMessages),
  }
}
