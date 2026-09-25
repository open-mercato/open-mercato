import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export async function raiseTransportError(status: number, key: string, fallback: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`transport_operations.errors.${key}`, fallback) })
}

export async function transportMessage(key: string, fallback: string): Promise<string> {
  const { translate } = await resolveTranslations()
  return translate(`transport_operations.audit.${key}`, fallback)
}
