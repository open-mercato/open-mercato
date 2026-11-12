import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

/**
 * `dictionaries` is optional for `resources`: its entity metadata is only
 * registered with the ORM when the module is enabled, so dictionary reads and
 * seeds must be skipped rather than attempted when it is disabled.
 */
export function isDictionariesModuleEnabled(): boolean {
  return Boolean(getEntityIds(false).dictionaries?.dictionary)
}
