import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isAttachmentStorageConfigurationError } from './drivers/storageValidation'

export function withAttachmentStorageErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args)
    } catch (error) {
      if (!isAttachmentStorageConfigurationError(error)) throw error
      const { t } = await resolveTranslations()
      return NextResponse.json({
        error: t('attachments.errors.storageConfigurationInvalid', 'Attachment storage configuration is unavailable.'),
        code: error.code,
        reason: error.reason,
      }, { status: 503 })
    }
  }
}
