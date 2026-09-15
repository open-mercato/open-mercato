import type { EntityManager } from '@mikro-orm/core'
import { validateValuesAgainstDefs } from '@open-mercato/shared/modules/entities/validation'
import { loadScopedCustomFieldDefs } from './scoped-field-defs'

export async function validateCustomFieldValuesServer(
  em: EntityManager,
  opts: {
    entityId: string
    organizationId?: string | null
    tenantId?: string | null
    values: Record<string, any>
    rejectUndeclaredKeys?: boolean
  },
): Promise<{ ok: boolean; fieldErrors: Record<string, string> }> {
  const byKey = await loadScopedCustomFieldDefs(em, {
    entityId: opts.entityId,
    organizationId: opts.organizationId,
    tenantId: opts.tenantId,
  })
  return validateValuesAgainstDefs(opts.values, Array.from(byKey.values()) as any, {
    rejectUndeclaredKeys: opts.rejectUndeclaredKeys === true,
  })
}
