import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export function getKanbanPermissionMessage(error: unknown, t: TranslateFn): string | null {
  if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 403) return null
  return translateWithFallback(
    t,
    'ui.auth.accessDenied.generic',
    'Access denied: you do not have permission to perform this action.',
  )
}

export function localizeKanbanPermissionError(error: unknown, t: TranslateFn): unknown {
  const message = getKanbanPermissionMessage(error, t)
  return message ? new Error(message, { cause: error }) : error
}
