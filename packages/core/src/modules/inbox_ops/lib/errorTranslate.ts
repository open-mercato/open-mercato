import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator, type TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('inbox_ops')

/**
 * Translations for a route's error response: falls back to the English defaults when the
 * dictionary cannot be loaded, so the route still answers with its formatted error.
 */
export async function resolveErrorTranslate(): Promise<TranslateWithFallbackFn> {
  try {
    return (await resolveTranslations()).translate
  } catch (error) {
    logger.warn('Failed to load translations for an error response', { err: error })
    return createFallbackTranslator({})
  }
}
