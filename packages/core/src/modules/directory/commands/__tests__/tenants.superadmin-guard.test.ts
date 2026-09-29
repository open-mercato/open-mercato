/** @jest-environment node */

import '@open-mercato/core/modules/directory/commands/tenants'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const ACTOR_TENANT_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeCtx(isSuperAdmin: boolean) {
  const de = {
    createOrmEntity: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: TENANT_ID,
      ...data,
    })),
    updateOrmEntity: jest.fn(async () => ({
      id: TENANT_ID,
      name: 'Updated Tenant',
      isActive: true,
    })),
    deleteOrmEntity: jest.fn(async () => ({
      id: TENANT_ID,
      name: 'Deleted Tenant',
    })),
    setCustomFields: jest.fn(async () => {}),
  }

  const em = {
    findOne: jest.fn(async () => ({ id: TENANT_ID, name: 'Existing Tenant' })),
  }

  return {
    ctx: {
      container: {
        resolve: (token: string) => {
          if (token === 'em') return em
          if (token === 'dataEngine') return de
          if (token === 'rbacService') return { loadAcl: async () => ({ isSuperAdmin }) }
          throw new Error(`[internal] Unexpected DI token: ${token}`)
        },
      },
      auth: { sub: 'user-1', tenantId: ACTOR_TENANT_ID, orgId: null, isSuperAdmin },
    } as unknown as Parameters<CommandHandler['execute']>[1],
    de,
    em,
  }
}

describe('directory.tenants commands superadmin guard', () => {
  afterEach(() => jest.clearAllMocks())

  it('rejects directory.tenants.create for non-superadmin', async () => {
    const { ctx } = makeCtx(false)
    const handler = commandRegistry.get('directory.tenants.create') as CommandHandler
    expect(handler).toBeDefined()

    await expect(handler.execute({ name: 'New Tenant' }, ctx)).rejects.toThrow(CrudHttpError)
  })

  it('rejects directory.tenants.update prepare and execute for non-superadmin', async () => {
    const { ctx } = makeCtx(false)
    const handler = commandRegistry.get('directory.tenants.update') as CommandHandler
    expect(handler).toBeDefined()

    if (handler.prepare) {
      await expect(handler.prepare({ id: TENANT_ID, name: 'Updated' }, ctx)).rejects.toThrow(CrudHttpError)
    }
    await expect(handler.execute({ id: TENANT_ID, name: 'Updated' }, ctx)).rejects.toThrow(CrudHttpError)
  })

  it('rejects directory.tenants.delete prepare and execute for non-superadmin', async () => {
    const { ctx } = makeCtx(false)
    const handler = commandRegistry.get('directory.tenants.delete') as CommandHandler
    expect(handler).toBeDefined()

    if (handler.prepare) {
      await expect(handler.prepare({ body: { id: TENANT_ID }, query: {} }, ctx)).rejects.toThrow(CrudHttpError)
    }
    await expect(handler.execute({ body: { id: TENANT_ID }, query: {} }, ctx)).rejects.toThrow(CrudHttpError)
  })
})
