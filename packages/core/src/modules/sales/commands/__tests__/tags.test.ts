/** @jest-environment node */

/**
 * sales.tags.update / sales.tags.delete (packages/core/src/modules/sales/commands/tags.ts)
 * used to scope the mutation using a request-supplied `tenantId` instead of the
 * loaded tag's own stored tenant, and never checked the stored organization at
 * all — a caller could pass their own tenant id to pass the scope check while
 * mutating a foreign tenant's/organization's tag (#7807). These tests pin the
 * corrected behavior: scope is always derived from the loaded tag.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { SalesDocumentTag, SalesDocumentTagAssignment } from '../../data/entities'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const FOREIGN_ORG_ID = '33333333-3333-4333-8333-333333333333'
const FOREIGN_TENANT_ID = '44444444-4444-4444-8444-444444444444'
const TAG_ID = '55555555-5555-4555-8555-555555555555'

function makeTag(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TAG_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: 'vip',
    label: 'VIP',
    color: null,
    description: null,
    ...overrides,
  }
}

function makeEm(tag: ReturnType<typeof makeTag> | null) {
  const em: any = {
    findOne: jest.fn(async (entityClass: unknown, where: any) => {
      if (entityClass === SalesDocumentTag) {
        if (where?.id && tag && where.id === tag.id) return tag
        return null
      }
      return null
    }),
    create: jest.fn((_entityClass: unknown, data: unknown) => data),
    persist: jest.fn(() => em),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    flush: jest.fn(async () => {}),
    fork: () => em,
  }
  return em
}

function makeCtx(em: unknown, auth: { tenantId: string; orgId: string }) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em) })
  return {
    container,
    auth: { tenantId: auth.tenantId, orgId: auth.orgId, sub: 'user-1' },
    selectedOrganizationId: auth.orgId,
    organizationScope: null,
    organizationIds: null,
  } as any
}

describe('sales.tags.update / sales.tags.delete — scope the stored tag, not the request', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../tags')
  })

  const getUpdate = () =>
    commandRegistry.get<any, { tagId: string }>('sales.tags.update')!
  const getDelete = () =>
    commandRegistry.get<any, { tagId: string }>('sales.tags.delete')!

  it('updates the tag when the caller is in the tag\'s own tenant and organization', async () => {
    const tag = makeTag()
    const em = makeEm(tag)

    await getUpdate().execute(
      { id: TAG_ID, label: 'New Label' },
      makeCtx(em, { tenantId: TENANT_ID, orgId: ORG_ID })
    )

    expect(tag.label).toBe('New Label')
    expect(em.flush).toHaveBeenCalled()
  })

  it('rejects an update claiming the caller\'s own tenant id for a foreign tenant\'s tag', async () => {
    const tag = makeTag({ tenantId: FOREIGN_TENANT_ID })
    const em = makeEm(tag)

    await expect(
      getUpdate().execute(
        // Attacker supplies their own tenantId to try to pass the old, request-trusting check.
        { id: TAG_ID, label: 'Hijacked', tenantId: TENANT_ID },
        makeCtx(em, { tenantId: TENANT_ID, orgId: ORG_ID })
      )
    ).rejects.toMatchObject({ status: 403 })

    expect(tag.label).toBe('VIP')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects an update for a tag in a foreign organization within the same tenant', async () => {
    const tag = makeTag({ organizationId: FOREIGN_ORG_ID })
    const em = makeEm(tag)

    await expect(
      getUpdate().execute(
        { id: TAG_ID, label: 'Hijacked', organizationId: ORG_ID },
        makeCtx(em, { tenantId: TENANT_ID, orgId: ORG_ID })
      )
    ).rejects.toMatchObject({ status: 403 })

    expect(tag.label).toBe('VIP')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('no longer lets a request reassign a tag\'s stored tenant/organization', async () => {
    const tag = makeTag()
    const em = makeEm(tag)

    await getUpdate().execute(
      { id: TAG_ID, tenantId: FOREIGN_TENANT_ID, organizationId: FOREIGN_ORG_ID },
      makeCtx(em, { tenantId: TENANT_ID, orgId: ORG_ID })
    )

    expect(tag.tenantId).toBe(TENANT_ID)
    expect(tag.organizationId).toBe(ORG_ID)
  })

  it('deletes the tag when the caller is in the tag\'s own tenant and organization', async () => {
    const tag = makeTag()
    const em = makeEm(tag)

    await getDelete().execute({ id: TAG_ID }, makeCtx(em, { tenantId: TENANT_ID, orgId: ORG_ID }))

    expect(em.remove).toHaveBeenCalledWith(tag)
    expect(em.flush).toHaveBeenCalled()
  })

  it('rejects deleting a foreign tenant\'s tag', async () => {
    const tag = makeTag({ tenantId: FOREIGN_TENANT_ID })
    const em = makeEm(tag)

    await expect(
      getDelete().execute({ id: TAG_ID }, makeCtx(em, { tenantId: TENANT_ID, orgId: ORG_ID }))
    ).rejects.toMatchObject({ status: 403 })

    expect(em.remove).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })

  it('rejects deleting a tag in a foreign organization within the same tenant', async () => {
    const tag = makeTag({ organizationId: FOREIGN_ORG_ID })
    const em = makeEm(tag)

    await expect(
      getDelete().execute({ id: TAG_ID }, makeCtx(em, { tenantId: TENANT_ID, orgId: ORG_ID }))
    ).rejects.toMatchObject({ status: 403 })

    expect(em.remove).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })
})
