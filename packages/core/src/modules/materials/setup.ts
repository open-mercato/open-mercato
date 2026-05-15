import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * Materials module — tenant initialization config (Phase 1 Step 15).
 *
 * defaultRoleFeatures: declarative role → features mapping merged into role ACLs during
 * tenant setup. Reflects the spec ACL Features section:
 *   - admin: full access via wildcard.
 *   - employee: operational access (no settings management) via wildcard for module-internal
 *     actions plus all four widget surfaces.
 *
 * seedDefaults: intentionally a no-op in Phase 1. The five material kinds (raw / semi / final /
 * tool / indirect) are enforced as a TEXT enum at the column level — there is no separate
 * dictionary table to populate. A future Phase 2 introducing tenant-extensible kinds via the
 * dictionaries module would seed the platform-shipped values here.
 *
 * Default custom fields (`internal_notes`, `safety_data_sheet_url`) are registered in `ce.ts`
 * via the entities registry; tenants reconcile them via `yarn mercato entities install` rather
 * than seedDefaults.
 *
 * Customer portal access is not granted in Phase 1 — explicit decision per spec ACL section.
 */
export const setup: ModuleSetupConfig = {
  seedDefaults: async () => {
    // No structural reference data to seed in Phase 1. Material kinds are an enum at the
    // column level; future Phase 2 dictionaries-based extensibility will seed kind labels here.
  },

  defaultRoleFeatures: {
    admin: ['materials.*'],
    employee: [
      'materials.material.view',
      'materials.material.manage',
      'materials.units.*',
      'materials.supplier_link.*',
      'materials.price.*',
      'materials.widgets.*',
    ],
  },
}

export default setup
