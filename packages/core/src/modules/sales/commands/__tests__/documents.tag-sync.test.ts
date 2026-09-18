/** @jest-environment node */

/**
 * syncSalesDocumentTags (packages/core/src/modules/sales/commands/documents.ts)
 * used to delete every assignment for a document and re-insert the incoming set
 * on any update that carried `tags`, even when the set was unchanged. These
 * tests pin the diff behaviour: an equal set writes nothing at all, and a
 * changed set writes only the delta.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  SalesOrder,
  SalesDocumentTag,
  SalesDocumentTagAssignment,
} from '../../data/entities'
import type { DocumentUpdateInput } from '../documents'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    invalidateCrudCache: jest.fn(),
  }
})

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const TAG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TAG_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const KNOWN_TAG_IDS = [TAG_A, TAG_B, TAG_C]

function makeOrder() {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'O-1',
    status: null,
    statusEntryId: null,
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    currencyCode: 'USD',
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    metadata: null,
    deletedAt: null,
  }
}

type AssignmentShape = 'entity' | 'unwrapped' | 'column'

function makeAssignment(tagId: string, shape: AssignmentShape = 'entity') {
  const base = {
    id: `assignment-${tagId}`,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    documentId: ORDER_ID,
    documentKind: 'order',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
  if (shape === 'unwrapped') return { ...base, tag: tagId }
  if (shape === 'column') return { ...base, tag: null, tag_id: tagId }
  return { ...base, tag: { id: tagId } }
}

function makeEm(existingTagIds: string[], shape: AssignmentShape = 'entity') {
  const assignments = existingTagIds.map((tagId) => makeAssignment(tagId, shape))
  const em: any = {
    findOne: jest.fn(async (entityClass: unknown) => {
      if (entityClass === SalesOrder) return makeOrder()
      return null
    }),
    find: jest.fn(async (entityClass: unknown, where: any) => {
      if (entityClass === SalesDocumentTag) {
        const requested: string[] = where?.id?.$in ?? []
        return requested
          .filter((id) => KNOWN_TAG_IDS.includes(id))
          .map((id) => ({ id, organizationId: ORG_ID, tenantId: TENANT_ID }))
      }
      if (entityClass === SalesDocumentTagAssignment) return assignments
      return []
    }),
    create: jest.fn((_entityClass: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_entityClass: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    fork: () => em,
  }
  return { em, assignments }
}

function makeCtx(em: unknown) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em) })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as any
}

async function updateOrderTags(em: unknown, tags: string[]) {
  const handler = commandRegistry.get<DocumentUpdateInput, { order: SalesOrder }>('sales.orders.update')
  expect(handler).toBeTruthy()
  await handler?.execute({ id: ORDER_ID, tags }, makeCtx(em))
}

function tagIdOf(assignment: any): string {
  return typeof assignment.tag === 'string'
    ? assignment.tag
    : (assignment.tag?.id ?? assignment.tag_id)
}

function persistedTagIds(em: any): string[] {
  return em.persist.mock.calls.map(([assignment]: [any]) => tagIdOf(assignment))
}

function removedTagIds(em: any): string[] {
  return em.remove.mock.calls.map(([assignment]: [any]) => tagIdOf(assignment))
}

describe('syncSalesDocumentTags — diff-based tag assignment sync', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  it('writes nothing when the incoming set equals the stored set', async () => {
    const { em } = makeEm([TAG_A, TAG_B])

    await updateOrderTags(em, [TAG_B, TAG_A])

    expect(em.persist).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('persists only the added tag when the incoming set is a superset', async () => {
    const { em } = makeEm([TAG_A])

    await updateOrderTags(em, [TAG_A, TAG_B])

    expect(persistedTagIds(em)).toEqual([TAG_B])
    expect(em.remove).not.toHaveBeenCalled()
  })

  it('removes only the dropped assignment when the incoming set is a subset', async () => {
    const { em } = makeEm([TAG_A, TAG_B])

    await updateOrderTags(em, [TAG_A])

    expect(removedTagIds(em)).toEqual([TAG_B])
    expect(em.persist).not.toHaveBeenCalled()
  })

  it.each<[string, AssignmentShape]>([
    ['an unwrapped tag id', 'unwrapped'],
    ['a raw tag_id column', 'column'],
  ])('recognises a stored assignment exposing %s', async (_label, shape) => {
    const { em } = makeEm([TAG_A, TAG_B], shape)

    await updateOrderTags(em, [TAG_A, TAG_B])

    expect(em.persist).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
  })

  it('keeps the untouched assignment instance when the set changes', async () => {
    const { em, assignments } = makeEm([TAG_A, TAG_B])

    await updateOrderTags(em, [TAG_A, TAG_C])

    const kept = assignments.find((assignment) => assignment.tag.id === TAG_A)
    expect(em.remove).not.toHaveBeenCalledWith(kept)
    expect(removedTagIds(em)).toEqual([TAG_B])
    expect(persistedTagIds(em)).toEqual([TAG_C])
  })

  it('removes every assignment when the incoming set is empty', async () => {
    const { em } = makeEm([TAG_A, TAG_B])

    await updateOrderTags(em, [])

    expect(removedTagIds(em)).toEqual([TAG_A, TAG_B])
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('writes nothing when the incoming set is empty and none are stored', async () => {
    const { em } = makeEm([])

    await updateOrderTags(em, [])

    expect(em.remove).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })

  it('rejects a tag outside the document scope before writing anything', async () => {
    const { em } = makeEm([TAG_A])
    const unknownTag = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

    await expect(updateOrderTags(em, [TAG_A, unknownTag])).rejects.toMatchObject({
      status: 400,
    })

    expect(em.persist).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })
})
