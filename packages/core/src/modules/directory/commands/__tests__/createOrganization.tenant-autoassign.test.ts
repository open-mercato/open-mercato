/** @jest-environment node */

// Regression for #2988: a non-super-admin admin submitting the Create Organization
// form sends no tenantId (the form hides the Tenant field for non-super-admins). The
// create command must auto-assign the actor's own tenant instead of returning 403
// "Not authorized to target this tenant." We exercise the real enforceTenantSelection
// so the test pins the call-site behaviour, not a mocked guard.

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (
    _em: unknown,
    phases: Array<() => unknown | Promise<unknown>>,
  ) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('@open-mercato/core/modules/directory/lib/hierarchy', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/directory/lib/hierarchy')
  return {
    ...actual,
    rebuildHierarchyForTenant: jest.fn(async () => {}),
  }
})

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => {}),
  }
})

import '@open-mercato/core/modules/directory/commands/organizations'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

const ACTOR_TENANT_ID = '11111111-1111-4111-8111-111111111111'
const FOREIGN_TENANT_ID = '22222222-2222-4222-8222-222222222222'
const NEW_ORG_ID = 'aaaa1111-0000-4000-8000-000000000001'

function makeEm() {
  return {
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => {}),
    persist: jest.fn(() => ({ flush: jest.fn(async () => {}) })),
  }
}

function makeDataEngine() {
  return {
    createOrmEntity: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: NEW_ORG_ID,
      ...data,
    })),
    setCustomFields: jest.fn(async () => {}),
  }
}

function makeCtx(em: ReturnType<typeof makeEm>, de: ReturnType<typeof makeDataEngine>, isSuperAdmin: boolean) {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return de
        if (token === 'rbacService') return { loadAcl: async () => ({ isSuperAdmin }) }
        throw new Error(`[internal] Unexpected DI token: ${token}`)
      },
    },
    auth: { sub: 'user-1', tenantId: ACTOR_TENANT_ID, orgId: 'org-1', isSuperAdmin },
  } as unknown as Parameters<CommandHandler['execute']>[1]
}

describe('directory.organizations.create — tenant auto-assignment (#2988)', () => {
  afterEach(() => jest.clearAllMocks())

  it('auto-assigns the actor tenant when a non-super-admin omits tenantId', async () => {
    const em = makeEm()
    const de = makeDataEngine()
    const ctx = makeCtx(em, de, false)
    const handler = commandRegistry.get('directory.organizations.create') as CommandHandler
    expect(handler).toBeDefined()

    const result = await handler.execute({ name: 'Acme' }, ctx)

    expect((result as Organization).id).toBe(NEW_ORG_ID)
    expect(de.createOrmEntity).toHaveBeenCalledTimes(1)
    const createArgs = de.createOrmEntity.mock.calls[0][0] as { data: { tenant: { id: string }; name: string } }
    expect(createArgs.data.tenant).toEqual({ id: ACTOR_TENANT_ID })
    expect(createArgs.data.name).toBe('Acme')
  })

  it('still rejects a non-super-admin targeting a foreign tenant', async () => {
    const em = makeEm()
    const de = makeDataEngine()
    const ctx = makeCtx(em, de, false)
    const handler = commandRegistry.get('directory.organizations.create') as CommandHandler

    let captured: unknown
    try {
      await handler.execute({ name: 'Acme', tenantId: FOREIGN_TENANT_ID }, ctx)
    } catch (err) {
      captured = err
    }

    expect(captured).toBeInstanceOf(CrudHttpError)
    expect((captured as CrudHttpError).status).toBe(403)
    expect(de.createOrmEntity).not.toHaveBeenCalled()
  })

  it('lets a super-admin target an explicit tenant', async () => {
    const em = makeEm()
    const de = makeDataEngine()
    const ctx = makeCtx(em, de, true)
    const handler = commandRegistry.get('directory.organizations.create') as CommandHandler

    await handler.execute({ name: 'Globex', tenantId: FOREIGN_TENANT_ID }, ctx)

    const createArgs = de.createOrmEntity.mock.calls[0][0] as { data: { tenant: { id: string } } }
    expect(createArgs.data.tenant).toEqual({ id: FOREIGN_TENANT_ID })
  })
})
