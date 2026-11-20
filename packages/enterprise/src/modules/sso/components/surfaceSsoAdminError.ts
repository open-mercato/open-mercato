import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

type Translate = (key: string, fallback?: string) => string

export type SurfaceSsoAdminErrorOptions = {
  onRefresh?: (() => void) | null
}

const GENERIC_SERVER_ERROR_MESSAGES = new Set(['internal server error'])

function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

export function resolveSsoAdminErrorMessage(error: unknown, fallback: string): string {
  const status = readErrorStatus(error)
  if (status !== null && status >= 500) return fallback
  if (error instanceof Error) {
    const message = error.message.trim()
    if (message && !GENERIC_SERVER_ERROR_MESSAGES.has(message.toLowerCase())) return message
  }
  return fallback
}

export function surfaceSsoAdminError(
  error: unknown,
  t: Translate,
  fallback: string,
  options: SurfaceSsoAdminErrorOptions = {},
): string | null {
  if (surfaceRecordConflict(error, t, { onRefresh: options.onRefresh ?? null })) return null
  const message = resolveSsoAdminErrorMessage(error, fallback)
  flash(message, 'error')
  return message
}
