import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function mergeInteractionPhoneNumber(
  phoneNumber: string | null | undefined,
  custom: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (phoneNumber === undefined) return custom
  const existing = custom.callPhoneNumber
  const normalized = typeof existing === 'string' ? existing.trim() : existing
  if (existing !== undefined && normalized !== phoneNumber) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(400, {
      error: translate(
        'customers.activities.errors.phoneConflict',
        'Provide the same phone number in phoneNumber and customValues.callPhoneNumber.',
      ),
      fields: ['phoneNumber', 'customValues.callPhoneNumber'],
    })
  }
  return { ...custom, callPhoneNumber: phoneNumber }
}
