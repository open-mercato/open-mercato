import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export async function raiseFleetError(status: number, key: string, fallback: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`fleet_management.errors.${key}`, fallback) })
}

export async function fleetMessage(key: string, fallback: string): Promise<string> {
  const { translate } = await resolveTranslations()
  return translate(`fleet_management.audit.${key}`, fallback)
}