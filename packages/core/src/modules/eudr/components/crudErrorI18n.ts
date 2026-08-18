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
