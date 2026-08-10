import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

/**
 * Maps a failed PDF response to a user-facing message.
 *
 * The preview/generate routes return a coded `organization_required` error
 * (HTTP 409) when no organization is selected; surface a specific hint for it
 * and fall back to the generic message for anything else (or a non-JSON body
 * such as a PDF stream).
 */
export async function resolveErrorMessage(response: Response | undefined, t: TranslateFn): Promise<string> {
  const generic = t('document_generators.preview.error', 'Failed to generate document.')
  if (!response) return generic
  try {
    const body = await response.clone().json()
    if (body?.error === 'organization_required') {
      return t('document_generators.errors.organization_required', 'Select an organization to generate this document.')
    }
    if (typeof body?.message === 'string' && body.message.trim()) return body.message
  } catch {
    // response was not JSON (e.g. a PDF stream) — keep the generic message
  }
  return generic
}
