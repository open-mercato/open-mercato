import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

/**
 * `api_keys` and `business_rules` are optional peers of `workflows`: their entity
 * metadata is registered with the ORM only when the module is enabled in
 * `src/modules.ts`. These checks gate the side features that need them so the
 * engine degrades instead of failing on a missing-metadata error (#9217).
 *
 * An empty registry means entity ids were never bootstrapped (isolated scripts,
 * unit tests); that is not evidence the module is off, so it reports enabled and
 * keeps the pre-existing behavior.
 */
function isModuleEntityRegistered(moduleId: string, entityKey: string): boolean {
  const ids = getEntityIds(false)
  if (Object.keys(ids).length === 0) return true
  return Boolean(ids[moduleId]?.[entityKey])
}

export function isApiKeysModuleEnabled(): boolean {
  return isModuleEntityRegistered('api_keys', 'api_key')
}

export function isBusinessRulesModuleEnabled(): boolean {
  return isModuleEntityRegistered('business_rules', 'business_rule')
}
