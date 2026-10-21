import { createHash } from 'node:crypto'
import { INTERACTION_STATUS_COMPLETED } from './interactionStatus'

export type PhoneCallParticipantPayload = {
  role?: string | null
  phoneNumber?: string | null
  displayName?: string | null
  email?: string | null
}

export type PhoneCallCompletedPayload = {
  id: string
  organizationId: string
  tenantId: string
  providerKey?: string | null
  direction?: string | null
  startedAt?: string | Date | null
  endedAt?: string | Date | null
  durationSeconds?: number | null
  recordingUrl?: string | null
  participants?: PhoneCallParticipantPayload[]
}

export function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/[^\d]/g, '')
  return digits.length >= 6 ? digits : null
}

export function buildPhoneCallInteractionKey(callId: string, personId: string): string {
  const hex = createHash('sha1').update(`phone_call:${callId}:${personId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(18, 30)}`
}

function resolveDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function buildPhoneCallInteraction(input: {
  call: PhoneCallCompletedPayload
  personId: string
  authorUserId?: string | null
}) {
  const { call, personId } = input
  const direction = call.direction === 'inbound' ? 'Inbound' : call.direction === 'outbound' ? 'Outbound' : 'Phone'
  const occurredAt = resolveDate(call.endedAt) ?? resolveDate(call.startedAt) ?? new Date()
  const minutes = typeof call.durationSeconds === 'number' && call.durationSeconds > 0
    ? Math.max(1, Math.ceil(call.durationSeconds / 60))
    : null
  return {
    organizationId: call.organizationId,
    tenantId: call.tenantId,
    entityId: personId,
    interactionType: 'call',
    title: `${direction} call`,
    body: call.recordingUrl ? `Recording: ${call.recordingUrl}` : null,
    status: INTERACTION_STATUS_COMPLETED,
    occurredAt,
    durationMinutes: minutes,
    source: 'phone_calls',
    channelProviderKey: call.providerKey ?? null,
    externalMessageId: buildPhoneCallInteractionKey(call.id, personId),
    authorUserId: input.authorUserId ?? null,
    participants: (call.participants ?? [])
      .filter((participant) => participant.displayName || participant.email || participant.phoneNumber)
      .map((participant) => ({
        name: participant.displayName ?? undefined,
        email: participant.email ?? undefined,
      })),
  }
}
