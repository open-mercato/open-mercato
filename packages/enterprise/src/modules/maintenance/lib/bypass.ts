import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { MaintenanceStateV1 } from './state'

export const BYPASS_COOKIE_NAME = 'om_maintenance_bypass'
export const BYPASS_HEADER_NAME = 'x-maintenance-bypass'
export const BYPASS_PATH = '/maintenance-bypass'
export const DEFAULT_BYPASS_TTL_MS = 2 * 60 * 60 * 1000

export function generateBypassToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashBypassToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export type BypassRejection = 'disabled' | 'missing' | 'invalid' | 'expired' | 'forbidden_by_hold' | 'reopen_barrier'

export function checkBypassToken(
  state: MaintenanceStateV1,
  token: string | null | undefined,
  now: Date,
): { ok: true } | { ok: false; reason: BypassRejection } {
  if (state.reopenBarrier) return { ok: false, reason: 'reopen_barrier' }
  if (state.hold?.forbidsBypass) return { ok: false, reason: 'forbidden_by_hold' }
  if (!state.bypass.enabled || !state.bypass.tokenSha256) return { ok: false, reason: 'disabled' }
  if (!token) return { ok: false, reason: 'missing' }
  if (state.bypass.expiresAt && Date.parse(state.bypass.expiresAt) <= now.getTime()) return { ok: false, reason: 'expired' }
  const expected = Buffer.from(state.bypass.tokenSha256, 'hex')
  const actual = Buffer.from(hashBypassToken(token), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: 'invalid' }
  return { ok: true }
}

export function parseDurationMs(raw: string | null | undefined): number | null {
  if (!raw) return null
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(raw.trim())
  if (!match) return null
  const value = Number(match[1])
  const unit = (match[2] ?? 's').toLowerCase()
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return value * multiplier
}
