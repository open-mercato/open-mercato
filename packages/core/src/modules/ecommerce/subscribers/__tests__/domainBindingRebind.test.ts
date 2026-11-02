jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (entity: unknown, where: unknown) => Promise<unknown[]> }, entity: unknown, where: unknown) =>
    em.find(entity, where),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: jest.fn(async () => undefined),
}))

import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import type { EcommerceStoreDomainBinding } from '../../data/entities'
import type { EcommerceSubscriberContext } from '../../lib/subscriberSupport'
import handle, { metadata } from '../domain-binding-rebind'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const OLD_MAPPING = 'mapping-old'
const NEW_MAPPING = 'mapping-new'

type BindingRow = Pick<
  EcommerceStoreDomainBinding,
  'id' | 'storeId' | 'domainMappingId' | 'pathPrefix' | 'tenantId' | 'organizationId' | 'deletedAt'
>

function binding(id: string, domainMappingId: string, pathPrefix: string | null, overrides: Partial<BindingRow> = {}): BindingRow {
  return {
    id,
    storeId: `store-${id}`,
    domainMappingId,
    pathPrefix,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
    ...overrides,
  }
}

function createEm(rows: BindingRow[]) {
  const findCalls: Array<Record<string, unknown>> = []
  const em = {
    find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      findCalls.push(where)
      return rows.filter(
        (row) =>
          row.domainMappingId === where.domainMappingId &&
          row.tenantId === where.tenantId &&
          row.organizationId === where.organizationId &&
          (row.deletedAt ?? null) === null,
      )
    }),
    flush: jest.fn(async () => undefined),
    fork: (): unknown => em,
  }
  return { em, findCalls }
}

function createDataEngine() {
  return {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
}

function createCtx(services: Record<string, unknown>): EcommerceSubscriberContext {
  return {
    resolve: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`not registered: ${name}`)
      return services[name] as T
    },
    eventName: 'customer_accounts.domain_mapping.replaced',
  }
}

const replacedPayload = {
  id: NEW_MAPPING,
  hostname: 'new.example.com',
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  replacedDomainId: OLD_MAPPING,
  replacedHostname: 'old.example.com',
}

describe('ecommerce domain binding re-binding subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('is a persistent subscriber of customer_accounts.domain_mapping.replaced', () => {
    expect(metadata).toMatchObject({ event: 'customer_accounts.domain_mapping.replaced', persistent: true })
  })

  it('re-points live bindings from the superseded mapping to the replacement within tenant and organization', async () => {
    const rows = [
      binding('b1', OLD_MAPPING, null),
      binding('b2', OLD_MAPPING, '/shop'),
      binding('b3', OLD_MAPPING, '/other', { organizationId: 'org-2' }),
      binding('b4', OLD_MAPPING, '/gone', { deletedAt: new Date() }),
    ]
    const { em, findCalls } = createEm(rows)
    const dataEngine = createDataEngine()
    await handle(replacedPayload, createCtx({ em, dataEngine }))

    expect(findCalls[0]).toEqual({ domainMappingId: OLD_MAPPING, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null })
    expect(rows.map((row) => row.domainMappingId)).toEqual([NEW_MAPPING, NEW_MAPPING, OLD_MAPPING, OLD_MAPPING])
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(2)
    const marks = dataEngine.markOrmEntityChange.mock.calls.map(([mark]) => mark)
    expect(marks.map((mark) => mark.action)).toEqual(['updated', 'updated'])
    expect(marks.map((mark) => mark.identifiers)).toEqual([
      { id: 'b1', tenantId: TENANT_ID, organizationId: ORG_ID },
      { id: 'b2', tenantId: TENANT_ID, organizationId: ORG_ID },
    ])
    expect(marks[0].events.buildPayload({ entity: rows[0] })).toEqual({
      id: 'b1',
      storeId: 'store-b1',
      domainMappingId: NEW_MAPPING,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(marks[0].events).toMatchObject({ module: 'ecommerce', entity: 'store_domain_binding' })
    expect(dataEngine.flushOrmEntityChanges).toHaveBeenCalledTimes(1)
    expect(invalidateCrudCache).toHaveBeenCalledTimes(2)
  })

  it('is idempotent: a second delivery finds nothing on the superseded mapping and writes nothing', async () => {
    const rows = [binding('b1', OLD_MAPPING, null)]
    const { em } = createEm(rows)
    const dataEngine = createDataEngine()
    await handle(replacedPayload, createCtx({ em, dataEngine }))
    await handle(replacedPayload, createCtx({ em, dataEngine }))
    expect(rows[0].domainMappingId).toBe(NEW_MAPPING)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(1)
  })

  it('skips a binding whose path prefix is already bound on the replacement mapping', async () => {
    const rows = [
      binding('b1', OLD_MAPPING, '/shop'),
      binding('b2', OLD_MAPPING, null),
      binding('existing', NEW_MAPPING, '/shop'),
    ]
    const { em } = createEm(rows)
    const dataEngine = createDataEngine()
    await handle(replacedPayload, createCtx({ em, dataEngine }))
    expect(rows.map((row) => row.domainMappingId)).toEqual([OLD_MAPPING, NEW_MAPPING, NEW_MAPPING])
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledTimes(1)
    expect(dataEngine.markOrmEntityChange.mock.calls[0][0].identifiers.id).toBe('b2')
  })

  it('treats two root bindings as a collision and writes nothing when every binding collides', async () => {
    const rows = [binding('b1', OLD_MAPPING, null), binding('existing', NEW_MAPPING, null)]
    const { em } = createEm(rows)
    const dataEngine = createDataEngine()
    await handle(replacedPayload, createCtx({ em, dataEngine }))
    expect(rows[0].domainMappingId).toBe(OLD_MAPPING)
    expect(em.flush).not.toHaveBeenCalled()
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('ignores payloads that do not identify both mappings and the scope', async () => {
    const { em } = createEm([binding('b1', OLD_MAPPING, null)])
    const ctx = createCtx({ em, dataEngine: createDataEngine() })
    await handle({ ...replacedPayload, replacedDomainId: undefined }, ctx)
    await handle({ ...replacedPayload, organizationId: undefined }, ctx)
    await handle({ ...replacedPayload, replacedDomainId: NEW_MAPPING }, ctx)
    expect(em.find).not.toHaveBeenCalled()
  })
})
