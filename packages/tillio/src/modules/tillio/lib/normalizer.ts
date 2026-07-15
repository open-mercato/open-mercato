import { z } from 'zod'
import type {
  NormalizedPhoneCall,
  NormalizedPhoneCallParticipant,
  NormalizedPhoneCallRecording,
  PhoneCallDirection,
  PhoneCallStatus,
} from '@open-mercato/shared/modules/phone_calls/types'
import type { TillioOperatorPlugin } from './operators-store'
import { parseTillioTimestamp } from './tz'

const stringish = z.union([z.string(), z.number()]).transform((value) => String(value))

const tillioCallSchema = z.object({
  id: stringish,
  date: stringish.optional(),
  type: stringish.optional(),
  caller: stringish.optional(),
  destination: stringish.optional(),
  status: stringish.optional(),
  waitTime: stringish.optional(),
  billSec: stringish.optional(),
  extraFields: z.record(z.string(), z.unknown()).optional(),
})

export type TillioRawCall = z.infer<typeof tillioCallSchema>

const ANSWERED_STATUSES = new Set(['ANSWERED', 'PROPER', 'REPEATED', 'CONNECTED'])
const MISSED_STATUSES = new Set(['NO ANSWER', 'NO FORWARD', 'VOICEMAIL', 'NO EXTENSION'])

const HTML_ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
}

export type TillioCallExtraction = {
  callerDisplayName?: string | null
  recording?: NormalizedPhoneCallRecording | null
  providerFacts?: Record<string, unknown>
}

export type TillioCallExtractor = (extraFields: Record<string, unknown>) => TillioCallExtraction

export type NormalizeContext = {
  operatorId: string
  plugin: TillioOperatorPlugin
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:quot|apos|#39|lt|gt|amp);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
}

// Ringostat sends a SIP-style `"display name" <uri>` string, HTML-escaped.
function extractDisplayName(value: string): string | null {
  const decoded = decodeHtmlEntities(value).trim()
  if (!decoded) return null
  const quoted = decoded.match(/^"([^"]*)"/)
  const name = (quoted?.[1] ?? decoded.replace(/<[^>]*>/g, '')).trim()
  return name || null
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  return null
}

function parseSeconds(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.trunc(parsed)
}

function mapDirection(type: string | undefined): PhoneCallDirection {
  switch ((type ?? '').trim().toUpperCase()) {
    case 'IN':
      return 'inbound'
    case 'OUT':
      return 'outbound'
    default:
      return 'unknown'
  }
}

// A billed call connected, whatever the textual status claims.
export function mapStatus(status: string | undefined, durationSeconds: number | null): PhoneCallStatus {
  if (durationSeconds !== null && durationSeconds > 0) return 'answered'
  const normalized = (status ?? '').trim().toUpperCase()
  if (ANSWERED_STATUSES.has(normalized)) return 'answered'
  if (MISSED_STATUSES.has(normalized)) return 'missed'
  return 'failed'
}

export const ringostatExtractor: TillioCallExtractor = (extraFields) => {
  const providerFacts: Record<string, unknown> = {}
  const callCard = readString(extraFields, 'call_card')
  if (callCard) providerFacts.tillioCallCardUrl = callCard

  const recordingUrl = readString(extraFields, 'recording')
  const hasRecording = readString(extraFields, 'has_recording') === '1' && Boolean(recordingUrl)

  const rawCaller = readString(extraFields, 'caller')

  return {
    callerDisplayName: rawCaller ? extractDisplayName(rawCaller) : null,
    recording: hasRecording ? { url: recordingUrl } : null,
    providerFacts,
  }
}

const passthroughExtractor: TillioCallExtractor = () => ({})

const EXTRACTORS: Record<TillioOperatorPlugin, TillioCallExtractor> = {
  Ringostat: ringostatExtractor,
}

export function getExtractorForPlugin(plugin: TillioOperatorPlugin): TillioCallExtractor {
  return EXTRACTORS[plugin] ?? passthroughExtractor
}

export function normalizeTillioCall(
  rawCall: Record<string, unknown>,
  context: NormalizeContext,
): NormalizedPhoneCall {
  const parsed = tillioCallSchema.safeParse(rawCall)
  if (!parsed.success) {
    throw new Error('[internal] Tillio returned a call payload without a usable id.')
  }
  const call = parsed.data
  const extraction = getExtractorForPlugin(context.plugin)(call.extraFields ?? {})

  const durationSeconds = parseSeconds(call.billSec)
  const waitTimeSeconds = parseSeconds(call.waitTime)

  const participants: NormalizedPhoneCallParticipant[] = []
  if (call.caller) {
    participants.push({
      role: 'caller',
      phoneNumber: call.caller,
      displayName: extraction.callerDisplayName ?? null,
    })
  }
  if (call.destination) {
    participants.push({ role: 'callee', phoneNumber: call.destination })
  }

  const providerFacts: Record<string, unknown> = {
    ...extraction.providerFacts,
    tillioStatus: call.status ?? null,
    tillioType: call.type ?? null,
    operatorId: context.operatorId,
    plugin: context.plugin,
  }
  if (waitTimeSeconds !== null) providerFacts.tillioWaitTimeSeconds = waitTimeSeconds

  return {
    externalCallId: call.id,
    direction: mapDirection(call.type),
    status: mapStatus(call.status, durationSeconds),
    participants,
    recording: extraction.recording ?? null,
    startedAt: parseTillioTimestamp(call.date),
    answeredAt: null,
    endedAt: null,
    durationSeconds,
    providerFacts,
    rawPayload: rawCall,
  }
}
