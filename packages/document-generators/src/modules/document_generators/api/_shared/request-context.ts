import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TranslateWithFallbackFn as TranslateFn } from '@open-mercato/shared/lib/i18n/translate'

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>

export type DocumentRequestContext = {
  container: RequestContainer
  auth: AuthContext
  translate: TranslateFn
  locale: string
}

export async function resolveDocumentRequestContext(request: Request): Promise<DocumentRequestContext> {
  const [container, auth, translations] = await Promise.all([
    createRequestContainer(),
    getAuthFromRequest(request),
    resolveTranslations(),
  ])
  return { container, auth, translate: translations.translate, locale: translations.locale }
}
