import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { UserMfaMethod } from '../../data/entities'
import '../removeMfaMethod'
import '../regenerateRecoveryCodes'

type MethodRecord = UserMfaMethod & {
  id: string
}

function buildMethod(overrides?: Partial<MethodRecord>): MethodRecord {
  return {
    id: 'method-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    type: 'totp',
    label: 'Phone',
    secret: null,
    providerMetadata: { device: 'phone' },
    isActive: true,
    lastUsedAt: null,
    createdAt: new Date('2026-03-10T10:00:00.000Z'),
    updatedAt: new Date('2026-03-10T10:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as MethodRecord
}

function createMethodContext(records: MethodRecord[]) {
  const em = {
    findOne: jest.fn(async (_entity: unknown, query: Record<string, unknown>) => {
      return records.find((record) => {
        if (query.id !== undefined && record.id !== query.id) return false
        if (query.userId !== undefined && record.userId !== query.userId) return false
        if (query.deletedAt !== undefined && record.deletedAt !== query.deletedAt) return false
        return true
      }) ?? null
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn((record: MethodRecord) => records.push(record)),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn().mockReturnThis(),
  }

  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em as unknown as EntityManager
        throw new Error(`Unexpected dependency: ${name}`)
      },
    },
    em,
  }
}

describe('security MFA commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('remove command soft-deletes the method through the service', async () => {
    const handler = commandRegistry.get('security.mfa.method.remove')
    expect(handler).toBeTruthy()

    const mfaService = {
      removeMethod: jest.fn().mockResolvedValue(undefined),
    }

    await handler!.execute(
      { id: '5f9be724-3382-4e44-9039-54fb5b3a0d00' },
      {
        auth: { sub: 'user-1' },
        container: {
          resolve: (name: string) => {
            if (name === 'mfaService') return mfaService
            throw new Error(`Unexpected dependency: ${name}`)
          },
        },
      } as never,
    )

    expect(mfaService.removeMethod).toHaveBeenCalledWith('user-1', '5f9be724-3382-4e44-9039-54fb5b3a0d00')
  })

  test('remove command maps MFA service errors to CrudHttpError', async () => {
    const handler = commandRegistry.get('security.mfa.method.remove')
    const error = Object.assign(new Error('MFA method not found'), {
      name: 'MfaServiceError',
      statusCode: 404,
    })
    const mfaService = {
      removeMethod: jest.fn().mockRejectedValue(error),
    }

    await expect(handler!.execute(
      { id: '5f9be724-3382-4e44-9039-54fb5b3a0d00' },
      {
        auth: { sub: 'user-1' },
        container: {
          resolve: (name: string) => {
            if (name === 'mfaService') return mfaService
            throw new Error(`Unexpected dependency: ${name}`)
          },
        },
      } as never,
    )).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 404,
      body: { error: 'MFA method not found' },
    })
  })

  test('remove command undo restores the previous MFA method snapshot', async () => {
    const handler = commandRegistry.get('security.mfa.method.remove')
    expect(handler?.undo).toBeTruthy()

    const record = buildMethod({
      isActive: false,
      deletedAt: new Date('2026-03-10T12:00:00.000Z'),
    })
    const { container } = createMethodContext([record])

    await handler!.undo?.({
      input: undefined,
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: record.id,
              userId: 'user-1',
              tenantId: 'tenant-1',
              organizationId: 'org-1',
              type: 'totp',
              label: 'Phone',
              secret: null,
              providerMetadata: { device: 'phone' },
              isActive: true,
              lastUsedAt: null,
              deletedAt: null,
            },
          },
        },
      },
      ctx: { container } as never,
    })

    expect(record.isActive).toBe(true)
    expect(record.deletedAt).toBeNull()
  })

  test('regenerate command returns the new recovery codes from the service', async () => {
    const handler = commandRegistry.get('security.mfa.recovery_codes.regenerate')
    expect(handler).toBeTruthy()

    const mfaService = {
      generateRecoveryCodes: jest.fn().mockResolvedValue(['AAAAA11111', 'BBBBB22222']),
    }

    await expect(handler!.execute(
      {},
      {
        auth: { sub: 'user-1' },
        container: {
          resolve: (name: string) => {
            if (name === 'mfaService') return mfaService
            throw new Error(`Unexpected dependency: ${name}`)
          },
        },
      } as never,
    )).resolves.toEqual({
      ok: true,
      recoveryCodes: ['AAAAA11111', 'BBBBB22222'],
    })
  })
})
