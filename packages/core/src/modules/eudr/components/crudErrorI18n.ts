import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

type Translator = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
) => string

const EUDR_ERROR_KEY_PATTERN = /^eudr\.errors\.[A-Za-z0-9_.-]+$/

function translateEudrErrorToken(token: string, translate: Translator): string {
  const trimmed = token.trim()
  if (!EUDR_ERROR_KEY_PATTERN.test(trimmed)) return token
  const translated = translate(trimmed)
  return translated === trimmed ? token : translated
}

function readEudrErrorToken(err: unknown): string | null {
  if (err == null || typeof err !== 'object') return null
  const candidates = [
    (err as { error?: unknown }).error,
    (err as { message?: unknown }).message,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (EUDR_ERROR_KEY_PATTERN.test(trimmed)) return trimmed
  }
  return null
}

/**
 * Resolves the user-facing message for a rejected EUDR mutation, preferring the
 * server's `eudr.errors.*` token over the caller's generic copy so the reason
 * survives to the user. Falls back to `fallbackMessage` when the rejection
 * carries no known token (network errors, 5xx, unmapped tokens).
 */
export function translateEudrErrorMessage(
  err: unknown,
  translate: Translator,
  fallbackMessage: string,
): string {
  const token = readEudrErrorToken(err)
  if (!token) return fallbackMessage
  const translated = translate(token)
  return translated === token ? fallbackMessage : translated
}

export function translateEudrCrudError(err: unknown, translate: Translator): unknown {
  if (!(err instanceof Error)) return err
  const rawMessage = typeof err.message === 'string' ? err.message : ''
  const translatedMessage = translateEudrErrorToken(rawMessage, translate)
  const rawFieldErrors = (err as { fieldErrors?: Record<string, string> }).fieldErrors
  let fieldErrorsChanged = false
  let translatedFieldErrors: Record<string, string> | undefined
  if (rawFieldErrors && typeof rawFieldErrors === 'object') {
    translatedFieldErrors = {}
    for (const [field, fieldMessage] of Object.entries(rawFieldErrors)) {
      if (typeof fieldMessage !== 'string') continue
      const translatedFieldMessage = translateEudrErrorToken(fieldMessage, translate)
      if (translatedFieldMessage !== fieldMessage) fieldErrorsChanged = true
      translatedFieldErrors[field] = translatedFieldMessage
    }
  }
  if (translatedMessage === rawMessage && !fieldErrorsChanged) return err
  return createCrudFormError(translatedMessage, translatedFieldErrors ?? rawFieldErrors)
}
