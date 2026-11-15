import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { UserMfaMethod } from '../../data/entities'
import '../removeMfaMethod'
import '../regenerateRecoveryCodes'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

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

  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em as unknown as EntityManager) })
  return { container, em }
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

  test('remove command persists only non-sensitive audit data without replay input or an undo token', async () => {
    const record = buildMethod({
      id: '5f9be724-3382-4e44-9039-54fb5b3a0d00',
      secret: 'JBSWY3DPEHPK3PXP',
      providerMetadata: { credential: 'private-provider-credential' },
    })
    const { container } = createMethodContext([record])
    const log = jest.fn(async (entry: Record<string, unknown>) => ({ id: 'log-1', ...entry }))
    container.register({
      actionLogService: asValue({ log }),
      mfaService: asValue({
        removeMethod: async () => {
          record.isActive = false
          record.deletedAt = new Date()
        },
      }),
    })

    const { result } = await new CommandBus().execute('security.mfa.method.remove', {
      input: { id: record.id },
      ctx: {
        container,
        auth: { sub: record.userId, tenantId: record.tenantId, orgId: record.organizationId },
        organizationScope: null,
        selectedOrganizationId: record.organizationId,
        organizationIds: null,
      },
    })

    expect(result).toEqual({ ok: true })
    expect(record.isActive).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    const entry = log.mock.calls[0][0]
    expect(entry).toMatchObject({
      commandId: 'security.mfa.method.remove',
      resourceId: record.id,
      actorUserId: record.userId,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      snapshotBefore: { id: record.id, type: 'totp', label: 'Phone', isActive: true },
    })
    expect(entry.snapshotBefore).not.toHaveProperty('secret')
    expect(entry.snapshotBefore).not.toHaveProperty('providerMetadata')
    expect(entry.undoToken).toBeFalsy()
    expect(entry.commandPayload).toBeUndefined()
    expect(JSON.stringify(entry)).not.toContain(record.secret)
    expect(JSON.stringify(entry)).not.toContain('private-provider-credential')
  })

  test.each(['user-1', 'tenant-admin'])('rejects legacy undo by %s before claiming or restoring a removed method', async (actorUserId) => {
    const record = buildMethod({
      isActive: false,
      deletedAt: new Date('2026-03-10T12:00:00.000Z'),
    })
    const { container, em } = createMethodContext([record])
    const claimForUndo = jest.fn().mockResolvedValue(true)
    const markUndone = jest.fn().mockResolvedValue(undefined)
    container.register({
      actionLogService: asValue({
        findByUndoToken: async () => ({
          id: 'legacy-log',
          commandId: 'security.mfa.method.remove',
          commandPayload: {
            undo: {
              before: {
                id: record.id,
                userId: 'user-1',
                tenantId: 'tenant-1',
                organizationId: 'org-1',
                type: 'totp',
                label: 'Phone',
                secret: 'JBSWY3DPEHPK3PXP',
                providerMetadata: { device: 'phone' },
                isActive: true,
                lastUsedAt: null,
                deletedAt: null,
              },
            },
          },
        }),
        claimForUndo,
        markUndone,
      }),
    })

    await expect(new CommandBus().undo('legacy-token', {
      container,
      auth: { sub: actorUserId, tenantId: record.tenantId, orgId: record.organizationId },
      organizationScope: null,
      selectedOrganizationId: record.organizationId,
      organizationIds: null,
    })).rejects.toThrow('Command security.mfa.method.remove is not undoable')

    expect(commandRegistry.get('security.mfa.method.remove')?.isUndoable).toBe(false)
    expect(commandRegistry.get('security.mfa.method.remove')?.undo).toBeUndefined()
    expect(claimForUndo).not.toHaveBeenCalled()
    expect(markUndone).not.toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(record.isActive).toBe(false)
    expect(record.deletedAt).toEqual(new Date('2026-03-10T12:00:00.000Z'))
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
