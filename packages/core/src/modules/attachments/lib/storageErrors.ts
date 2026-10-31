import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isAttachmentStorageConfigurationError } from './drivers/storageValidation'

export async function attachmentStorageErrorResponse(error: unknown): Promise<Response | null> {
  if (!isAttachmentStorageConfigurationError(error)) return null
  const { t } = await resolveTranslations()
  return NextResponse.json({
    error: t('attachments.errors.storageConfigurationInvalid', 'Attachment storage configuration is unavailable.'),
    code: error.code,
    reason: error.reason,
  }, { status: 503 })
}

export function withAttachmentStorageErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args)
    } catch (error) {
      const response = await attachmentStorageErrorResponse(error)
      if (response) return response
      throw error
    }
  }
}
