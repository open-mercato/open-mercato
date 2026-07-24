// Pure, dependency-free helpers describing the ACL features that gate
// custom-entity records. Kept import-free so both the enforcement path
// (`entityAcl.ts`) and the feature catalog (`auth/api/features.ts`) can derive
// the SAME feature id without coupling to each other or to the ORM.
//
// Coarse (route-level) features stay entity-agnostic:
//   entities.records.view   — read any non-restricted custom entity's records
//   entities.records.manage — write any non-restricted custom entity's records
//
// A custom entity flagged `access_restricted` ALSO requires a synthesized
// per-entity feature keyed on its immutable entityId:
//   entities.records.<entityId>.view
//   entities.records.<entityId>.manage
//
// entityId always matches `^[a-z0-9_]+:[a-z0-9_]+$` (it contains a `:` and no
// `.`), so it can never collide with the coarse `view`/`manage` segments and
// stays a single dotted segment for the wildcard matcher.

export type RecordsAction = 'view' | 'manage'

export const RECORDS_VIEW_FEATURE = 'entities.records.view'
export const RECORDS_MANAGE_FEATURE = 'entities.records.manage'

export function coarseRecordFeature(action: RecordsAction): string {
  return action === 'manage' ? RECORDS_MANAGE_FEATURE : RECORDS_VIEW_FEATURE
}

export function deriveCustomEntityRecordFeature(entityId: string, action: RecordsAction): string {
  return `entities.records.${entityId}.${action}`
}

export type SynthesizedRecordFeature = {
  id: string
  action: RecordsAction
  dependsOn: string[]
}

// The per-entity features an admin can grant for a restricted custom entity.
// `dependsOn` mirrors the coarse prerequisite composition: the per-entity grant
// is meaningful only alongside the coarse route-level feature.
export function synthesizedRecordFeatures(entityId: string): SynthesizedRecordFeature[] {
  const view = deriveCustomEntityRecordFeature(entityId, 'view')
  const manage = deriveCustomEntityRecordFeature(entityId, 'manage')
  return [
    { id: view, action: 'view', dependsOn: [RECORDS_VIEW_FEATURE] },
    { id: manage, action: 'manage', dependsOn: [view, RECORDS_MANAGE_FEATURE] },
  ]
}
