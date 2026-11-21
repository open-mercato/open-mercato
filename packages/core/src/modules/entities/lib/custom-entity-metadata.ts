import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import type { UpsertCustomEntityInput } from '../data/validators'

export async function persistCustomEntityMetadata(
  em: EntityManager,
  container: AwilixContainer,
  where: { entityId: string; organizationId: string | null; tenantId: string | null },
  ent: CustomEntity | null,
  input: UpsertCustomEntityInput,
  accessRestrictedExplicit: boolean,
): Promise<CustomEntity> {
  const isCreate = !ent
  if (!ent) {
    const now = new Date()
    ent = em.create(CustomEntity, {
      ...where,
      label: input.label,
      createdAt: now,
      updatedAt: now,
      isActive: true,
      showInSidebar: false,
      accessRestricted: false,
    })
  }
  ent.label = input.label
  ent.description = input.description ?? null
  ent.isActive = input.isActive ?? true
  ent.labelField = input.labelField ?? ent.labelField ?? null
  ent.defaultEditor = input.defaultEditor ?? ent.defaultEditor ?? null
  ent.showInSidebar = input.showInSidebar ?? ent.showInSidebar ?? false
  // Never silently flip a security control on a partial upsert. `access_restricted`
  // changes ONLY when the caller explicitly sends the field. On create without it,
  // fall back to the tenant default-restricted policy; on update without it, keep
  // the entity's current value (a metadata-only update must not un-restrict).
  if (accessRestrictedExplicit) {
    ent.accessRestricted = input.accessRestricted === true
  } else if (isCreate) {
    let policyDefault = false
    try {
      const moduleConfigService = container.resolve('moduleConfigService') as {
        getValue: (m: string, n: string, o?: { defaultValue?: unknown; scope?: { tenantId?: string | null } }) => Promise<unknown>
      }
      policyDefault = (await moduleConfigService.getValue('entities', 'newEntitiesRestrictedByDefault', {
        defaultValue: false,
        scope: { tenantId: where.tenantId },
      })) === true
    } catch {}
    ent.accessRestricted = policyDefault
  } else {
    ent.accessRestricted = ent.accessRestricted ?? false
  }
  ent.updatedAt = new Date()
  em.persist(ent)
  return ent
}

export async function invalidateCustomEntityNavigation(container: AwilixContainer, tenantId: string | null | undefined) {
  try {
    const cache = container.resolve<CacheStrategy | undefined>('cache')
    await cache?.deleteByTags([`nav:entities:${tenantId || 'null'}`])
  } catch {}
}
