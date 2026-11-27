import { z } from 'zod'
import {
  MAX_COMPOSE_EXTERNAL_PARTICIPANTS,
  type ExternalParticipantInput,
} from '../../messages/data/validators'

const emailSchema = z.string().email()

type PayloadAddress = { address: string; name: string | null }

function readPayloadAddresses(value: unknown): PayloadAddress[] {
  if (!Array.isArray(value)) return []
  const addresses: PayloadAddress[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      addresses.push({ address: entry, name: null })
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (Array.isArray(record.group)) {
      addresses.push(...readPayloadAddresses(record.group))
      continue
    }
    if (typeof record.address !== 'string') continue
    addresses.push({ address: record.address, name: typeof record.name === 'string' ? record.name : null })
  }
  return addresses
}

/**
 * Extra inbound To/CC addressees worth storing as message participants: every
 * valid address from the MIME `to`/`cc` lists except the sender (already in
 * `external_email`) and the channel's own mailbox. Invalid or excess entries are
 * dropped rather than failing ingest.
 */
export function buildInboundExtraParticipants(
  channelPayload: Record<string, unknown> | null | undefined,
  excludedAddresses: Array<string | null | undefined>,
): ExternalParticipantInput[] {
  if (!channelPayload) return []
  const excluded = new Set(
    excludedAddresses
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase()),
  )
  const seen = new Set<string>()
  const participants: ExternalParticipantInput[] = []
  const roles = [
    ['to', channelPayload.to],
    ['cc', channelPayload.cc],
  ] as const
  for (const [role, list] of roles) {
    for (const { address, name } of readPayloadAddresses(list)) {
      const email = address.trim()
      const normalized = email.toLowerCase()
      if (excluded.has(normalized) || !emailSchema.safeParse(email).success) continue
      const key = `${role}:${normalized}`
      if (seen.has(key)) continue
      seen.add(key)
      const trimmedName = name?.trim()
      participants.push({
        email,
        role,
        ...(trimmedName && trimmedName.length <= 255 ? { name: trimmedName } : {}),
      })
      if (participants.length >= MAX_COMPOSE_EXTERNAL_PARTICIPANTS) return participants
    }
  }
  return participants
}
