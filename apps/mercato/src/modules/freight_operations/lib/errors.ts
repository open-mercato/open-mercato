import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export async function raiseFreightError(status: number, key: string, fallback: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`freight_operations.errors.${key}`, fallback) })
}

export async function freightMessage(key: string, fallback: string): Promise<string> {
  const { translate } = await resolveTranslations()
  return translate(`freight_operations.audit.${key}`, fallback)
}
