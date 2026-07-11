import { flash } from '@open-mercato/ui/backend/FlashMessages'

/**
 * Surfaces a mutation failure as an error flash toast. Prefers the thrown
 * error's own message (already server-derived and translated by
 * `raiseCrudError`/`useGuardedMutation`) and falls back to a translated,
 * dialog-specific message otherwise (#4103).
 */
export function flashMutationError(error: unknown, fallbackMessage: string): void {
  flash(error instanceof Error ? error.message : fallbackMessage, 'error')
}
