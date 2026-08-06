/** @jest-environment node */

// Regression for #4906: Tenant is a global entity — the `tenants` table has neither a
// tenant_id nor an organization_id column — so the query index resolves its source scope
// as `{ kind: 'global' }` and rejects any index event whose payload does not carry both
// scope ids as explicit nulls. The tenant commands used to emit `tenantId: <the tenant's
// own id>`, which made every create/update/delete record a QueryIndexScopeError. We assert
// the emitted identifiers here AND replay them through the real scope resolver, so the
// invariant is pinned against the actual consumer instead of a restated literal.

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => {}),
  }
})

import '@open-mercato/core/modules/directory/commands/tenants'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandUndoLogEntry } from '@open-mercato/shared/lib/commands/types'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import {
  resolveQueryIndexRecordScope,
  type QueryIndexScope,
} from '@open-mercato/core/modules/query_index/lib/subscriber-scope'

const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ACTOR_TENANT_ID = '11111111-1111-4111-8111-111111111111'

const emitCrudSideEffectsMock = emitCrudSideEffects as jest.MockedFunction<typeof emitCrudSideEffects>

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: TENANT_ID,
    name: 'Acme',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as Tenant
}

function makeEm() {
  const em = {
    findOne: jest.fn(async () => null),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    fork: jest.fn(() => em),
  }
  return em
}

function makeDataEngine() {
  return {
    createOrmEntity: jest.fn(async ({ data }: { data: Record<string, unknown> }) => makeTenant(data as Partial<Tenant>)),
    updateOrmEntity: jest.fn(async ({ apply }: { apply: (entity: Tenant) => void }) => {
      const tenant = makeTenant()
      apply(tenant)
      return tenant
    }),
    deleteOrmEntity: jest.fn(async () => makeTenant({ deletedAt: new Date('2026-01-03T00:00:00.000Z') })),
    setCustomFields: jest.fn(async () => {}),
  }
}

function makeCtx(em: ReturnType<typeof makeEm>, de: ReturnType<typeof makeDataEngine>) {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return de
        if (token === 'kmsService') return { isHealthy: () => false }
        throw new Error(`[internal] Unexpected DI token: ${token}`)
      },
    },
    auth: { sub: 'user-1', tenantId: ACTOR_TENANT_ID, orgId: null, isSuperAdmin: true },
  } as unknown as Parameters<CommandHandler['execute']>[1]
}

/**
 * The query-index subscriber copies the emitted identifiers straight into the
 * `query_index.upsert_one` / `delete_one` payload, so feeding them back through the
 * resolver reproduces exactly what blew up in #4906.
 */
function resolveScopeForEmittedIdentifiers(identifiers: {
  organizationId: string | null
  tenantId: string | null
}): QueryIndexScope {
  return resolveQueryIndexRecordScope({
    payloadOrganizationId: identifiers.organizationId,
    payloadTenantId: identifiers.tenantId,
    hasPayloadOrganizationId: true,
    hasPayloadTenantId: true,
    sourceScope: { kind: 'global' },
  })
}

function lastEmittedIdentifiers() {
  expect(emitCrudSideEffectsMock).toHaveBeenCalledTimes(1)
  const call = emitCrudSideEffectsMock.mock.calls[0][0] as {
    identifiers: { id: string; organizationId: string | null; tenantId: string | null }
  }
  return call.identifiers
}

describe('directory tenant commands — global query-index scope (#4906)', () => {
  afterEach(() => jest.clearAllMocks())

  it('emits a null tenant scope when creating a tenant', async () => {
    const de = makeDataEngine()
    const handler = commandRegistry.get('directory.tenants.create') as CommandHandler
    expect(handler).toBeDefined()

    await handler.execute({ name: 'Acme' }, makeCtx(makeEm(), de))

    const identifiers = lastEmittedIdentifiers()
    expect(identifiers).toEqual({ id: TENANT_ID, organizationId: null, tenantId: null })
    expect(resolveScopeForEmittedIdentifiers(identifiers)).toEqual({ organizationId: null, tenantId: null })
  })

  it('emits a null tenant scope when updating a tenant', async () => {
    const de = makeDataEngine()
    const handler = commandRegistry.get('directory.tenants.update') as CommandHandler

    await handler.execute({ id: TENANT_ID, name: 'Acme Renamed' }, makeCtx(makeEm(), de))

    const identifiers = lastEmittedIdentifiers()
    expect(identifiers).toEqual({ id: TENANT_ID, organizationId: null, tenantId: null })
    expect(resolveScopeForEmittedIdentifiers(identifiers)).toEqual({ organizationId: null, tenantId: null })
  })

  it('emits a null tenant scope when deleting a tenant', async () => {
    const de = makeDataEngine()
    const handler = commandRegistry.get('directory.tenants.delete') as CommandHandler

    await handler.execute({ body: { id: TENANT_ID }, query: {} }, makeCtx(makeEm(), de))

    const identifiers = lastEmittedIdentifiers()
    expect(identifiers).toEqual({ id: TENANT_ID, organizationId: null, tenantId: null })
    expect(resolveScopeForEmittedIdentifiers(identifiers)).toEqual({ organizationId: null, tenantId: null })
  })

  it('emits a null tenant scope when redoing a tenant creation', async () => {
    const de = makeDataEngine()
    const handler = commandRegistry.get('directory.tenants.create') as CommandHandler
    expect(handler.redo).toBeDefined()

    const logEntry = {
      resourceId: TENANT_ID,
      payload: {
        undo: {
          after: {
            id: TENANT_ID,
            name: 'Acme',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        },
      },
    } as unknown as CommandUndoLogEntry

    await handler.redo!({ input: {}, ctx: makeCtx(makeEm(), de), logEntry })

    const identifiers = lastEmittedIdentifiers()
    expect(identifiers).toEqual({ id: TENANT_ID, organizationId: null, tenantId: null })
    expect(resolveScopeForEmittedIdentifiers(identifiers)).toEqual({ organizationId: null, tenantId: null })
  })

  it('still rejects a tenant-scoped payload for the global Tenant entity', () => {
    expect(() =>
      resolveScopeForEmittedIdentifiers({ organizationId: null, tenantId: TENANT_ID }),
    ).toThrow(/global entity/)
  })
})
