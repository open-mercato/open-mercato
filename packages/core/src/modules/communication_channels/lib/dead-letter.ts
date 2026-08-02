import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelIngestDeadLetter } from '../data/entities'
import type { NormalizedInboundMessage } from './adapter'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'dead-letter' })

const DEAD_LETTER_RAW_BODY_MAX_BYTES_DEFAULT = 32_768

export function extractExternalUid(message: NormalizedInboundMessage): string | null {
  const meta = message.channelMetadata as Record<string, unknown> | undefined
  if (meta && typeof meta.uid === 'string') return meta.uid
  if (meta && typeof meta.uid === 'number') return String(meta.uid)
  return null
}

/**
 * First N *bytes* of the raw body, for dead-letter forensics. Counts bytes (not
 * UTF-16 code units) so a multi-byte body cannot blow past the intended cap.
 */
export function truncateRawBody(message: NormalizedInboundMessage): string | null {
  const envCap = Number.parseInt(process.env.OM_CHANNEL_DEAD_LETTER_RAW_BODY_MAX_BYTES ?? '', 10)
  const cap = Number.isFinite(envCap) && envCap > 0 ? envCap : DEAD_LETTER_RAW_BODY_MAX_BYTES_DEFAULT
  const body = message.body ?? ''
  if (body.length === 0) return null
  const buf = Buffer.from(body, 'utf-8')
  if (buf.byteLength <= cap) return body
  return `${buf.subarray(0, cap).toString('utf-8')}…[truncated]`
}

export interface WriteIngestDeadLetterArgs {
  em: EntityManager
  scope: { tenantId: string; organizationId?: string | null }
  channel: { id: string; providerKey: string }
  message: NormalizedInboundMessage
  err: unknown
  errorMessage: string
}

/**
 * Persist a `ChannelIngestDeadLetter` row for a permanently-failed inbound
 * message so an operator can replay it later. Best-effort: a failure to write
 * the dead-letter is logged but never thrown, so a bad message cannot block the
 * caller from advancing its cursor.
 *
 * Idempotent on `(channelId, externalMessageId)`: a replayed page that fails the
 * same message again is a no-op, so the dead-letter table never accumulates
 * duplicate rows for the same poison message.
 */
export async function writeIngestDeadLetter(args: WriteIngestDeadLetterArgs): Promise<void> {
  const { em, scope, channel, message, err, errorMessage } = args
  const externalMessageId = message.externalMessageId ?? null
  try {
    if (externalMessageId) {
      const existing = await findOneWithDecryption(
        em,
        ChannelIngestDeadLetter,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId ?? null,
          channelId: channel.id,
          externalMessageId,
        },
        undefined,
        { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null },
      )
      if (existing) return
    }
    const deadLetter = em.create(ChannelIngestDeadLetter, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
      channelId: channel.id,
      providerKey: channel.providerKey,
      externalUid: extractExternalUid(message),
      externalMessageId,
      errorClass: err instanceof Error ? err.name : 'Error',
      errorMessage,
      rawBody: truncateRawBody(message),
    })
    em.persist(deadLetter)
    await em.flush()
  } catch (ddlErr) {
    logger.error('failed to record dead-letter for channel', { channelId: channel.id, err: ddlErr })
  }
}
