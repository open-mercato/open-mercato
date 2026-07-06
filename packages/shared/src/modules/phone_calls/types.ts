export type PhoneCallDirection = 'inbound' | 'outbound' | 'internal' | 'unknown'

export type PhoneCallStatus =
  | 'new'
  | 'ringing'
  | 'answered'
  | 'missed'
  | 'failed'
  | 'completed'
  | 'unknown'

export type PhoneCallParticipantRole = 'caller' | 'callee' | 'agent' | 'unknown'

export interface NormalizedPhoneCallParticipant {
  role: PhoneCallParticipantRole
  providerParticipantId?: string | null
  phoneNumber?: string | null
  displayName?: string | null
  email?: string | null
  metadata?: Record<string, unknown>
}

export interface NormalizedPhoneCallRecording {
  url?: string | null
  providerRecordingId?: string | null
  mimeType?: string | null
  durationSeconds?: number | null
  metadata?: Record<string, unknown>
}

export interface NormalizedPhoneCall {
  externalCallId: string
  externalConversationId?: string | null
  direction: PhoneCallDirection
  status: PhoneCallStatus
  participants: NormalizedPhoneCallParticipant[]
  recording?: NormalizedPhoneCallRecording | null
  startedAt?: Date | null
  answeredAt?: Date | null
  endedAt?: Date | null
  durationSeconds?: number | null
  providerFacts?: Record<string, unknown>
  rawPayload: Record<string, unknown>
}

export interface PhoneCallProviderScope {
  tenantId: string
  organizationId: string
}

export type PhoneCallProviderCredentials = Record<string, unknown>

export interface ValidatePhoneCallProviderInput {
  credentials: PhoneCallProviderCredentials
  scope: PhoneCallProviderScope
  integrationId?: string | null
}

export interface ProviderValidationResult {
  ok: boolean
  message?: string
  details?: Record<string, unknown>
}

export interface FetchPhoneCallInput {
  externalCallId: string
  credentials: PhoneCallProviderCredentials
  scope: PhoneCallProviderScope
  integrationId?: string | null
}

export interface FetchPhoneCallsInput {
  credentials: PhoneCallProviderCredentials
  scope: PhoneCallProviderScope
  integrationId?: string | null
  from?: Date | null
  to?: Date | null
  cursor?: string | null
  limit?: number | null
}

export interface NormalizedPhoneCallBatch {
  calls: NormalizedPhoneCall[]
  nextCursor?: string | null
}
