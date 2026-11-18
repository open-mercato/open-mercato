import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

export function isDictionariesModuleEnabled(): boolean {
  return Boolean(getEntityIds(false).dictionaries?.dictionary)
}
