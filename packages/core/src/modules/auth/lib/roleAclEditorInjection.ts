import { z } from 'zod'
import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import { normalizeRoleAclSnapshot, type RoleAclSnapshot } from './roleAclFingerprint'

/**
 * Injection spots of the role editor's Access section (`backend/roles/[id]/edit`), whose ACL is
 * edited outside the CrudForm values and so is published on its own spots:
 * - `auth.role.acl:toolbar` — actions above the ACL editor.
 * - `auth.role.acl:banner` — banners above the ACL editor; after a successful save of the role
 *   and its ACL the page dispatches `onAfterSave` to its widgets, and a widget's `onDataChange` may
 *   replace the editor's ACL (`isSuperAdmin`, `features`, `organizations`; validated, nothing else).
 * Both receive `RoleAclEditorInjectionContext` as `context` and the current, unsaved
 * `RoleAclEditorInjectionData` as `data`.
 */
export const ROLE_ACL_EDITOR_TOOLBAR_SPOT_ID: InjectionSpotId = 'auth.role.acl:toolbar'

export const ROLE_ACL_EDITOR_BANNER_SPOT_ID: InjectionSpotId = 'auth.role.acl:banner'

export type RoleAclEditorInjectionContext = {
  formId: string
  recordId: string
  tenantId: string | null
}

export type RoleAclEditorInjectionData = {
  roleId: string
  tenantId: string | null
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
  updatedAt: string | null
}

/** A stable id per role editor document (the role id). */
export function roleAclEditorFormId(roleId: string): string {
  return `auth.role.acl:${roleId}`
}

const roleAclDataChangeSchema = z.object({
  isSuperAdmin: z.boolean(),
  features: z.array(z.string()).max(2000),
  organizations: z.array(z.string()).max(1000).nullable(),
})

/**
 * The ACL a banner widget may load into the editor through `onDataChange`, validated and
 * normalized like the role ACL write; anything else in the widget's data is ignored. `null` when
 * nothing valid.
 */
export function readRoleAclEditorDataChange(next: unknown): RoleAclSnapshot | null {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return null
  const record = next as Record<string, unknown>
  const parsed = roleAclDataChangeSchema.safeParse({
    isSuperAdmin: record.isSuperAdmin,
    features: record.features,
    organizations: record.organizations,
  })
  return parsed.success ? normalizeRoleAclSnapshot(parsed.data) : null
}
