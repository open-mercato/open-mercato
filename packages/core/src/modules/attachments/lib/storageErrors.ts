import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isAttachmentStorageConfigurationError } from './drivers/storageValidation'

export const attachmentStorageErrorSchema = z.object({
  error: z.string(),
  code: z.literal('ATTACHMENT_STORAGE_CONFIGURATION_INVALID'),
  reason: z.string(),
})

export type AttachmentStorageErrorBody = z.infer<typeof attachmentStorageErrorSchema>

export const ATTACHMENT_STORAGE_ERROR_DESCRIPTION =
  'Attachment storage configuration rejected with a localized message, code ATTACHMENT_STORAGE_CONFIGURATION_INVALID and a redacted reason'

export async function attachmentStorageErrorResponse(error: unknown): Promise<Response | null> {
  if (!isAttachmentStorageConfigurationError(error)) return null
  const { t } = await resolveTranslations()
  const body: AttachmentStorageErrorBody = {
    error: t('attachments.errors.storageConfigurationInvalid', 'Attachment storage configuration is unavailable.'),
    code: error.code,
    reason: error.reason,
  }
  return NextResponse.json(body, { status: 503 })
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
