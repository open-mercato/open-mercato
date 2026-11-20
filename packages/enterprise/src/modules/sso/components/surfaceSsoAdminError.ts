import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

type Translate = (key: string, fallback?: string) => string

export type SurfaceSsoAdminErrorOptions = {
  onRefresh?: (() => void) | null
}

export function resolveSsoAdminErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim()
    if (message) return message
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
