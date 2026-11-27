import { asFunction, asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CrudMutationGuardServiceLike } from '@open-mercato/shared/lib/crud/mutation-guard-service'
import {
  clearOptimisticLockReadersForTests,
  registerOptimisticLockReaders,
} from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { register } from '../di'
import { RecordLockService } from '../lib/recordLockService'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../lib/config'

function buildContainer(extra: Record<string, unknown> = {}) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  const em = {
    findOne: jest.fn(),
  }
  container.register({
    em: asValue(em),
    rbacService: asValue({ userHasAllFeatures: jest.fn().mockResolvedValue(true) }),
  })
  for (const [key, value] of Object.entries(extra)) {
    container.register({ [key]: asValue(value) })
  }
  register(container as unknown as AppContainer)
  return { container, em }
}

describe('record_locks DI with optional peers disabled (#9205)', () => {
  test('resolves every record_locks service without configs or audit_logs registrations', async () => {
    const { container } = buildContainer()

    const recordLockService = container.resolve<RecordLockService>('recordLockService')
    expect(recordLockService).toBeInstanceOf(RecordLockService)
    await expect(recordLockService.getSettings()).resolves.toEqual(DEFAULT_RECORD_LOCK_SETTINGS)

    const guard = container.resolve<{ validateMutation: unknown }>('crudMutationGuardService')
    expect(typeof guard.validateMutation).toBe('function')

    const commandGuard = container.resolve<{ resolveExpected?: unknown }>('commandOptimisticLockGuardService')
    expect(commandGuard).toBeTruthy()
  })

  test.each([false, true])('the CRUD version floor rejects stale writes when audit history is absent or fails (registered=%s)', async (registerFailingHistory) => {
    registerOptimisticLockReaders({
      'test_optional_peers.thing': async () => '2026-01-01T00:00:01.000Z',
    })
    try {
      const { container } = buildContainer()
      const resolveHistory = jest.fn(() => { throw new Error('audit history resolution failed') })
      if (registerFailingHistory) container.register({ actionLogHistoryService: asFunction(resolveHistory) })
      const guard = container.resolve<CrudMutationGuardServiceLike>('crudMutationGuardService')
      const result = await guard.validateMutation({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        resourceKind: 'test_optional_peers.thing',
        resourceId: 'thing-1',
        operation: 'update',
        requestMethod: 'PUT',
        requestHeaders: new Headers({ [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-01-01T00:00:00.000Z' }),
        mutationPayload: { id: 'thing-1' },
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected the OSS floor to reject the stale write')
      expect(result.status).toBe(409)
      expect(resolveHistory).not.toHaveBeenCalled()
    } finally {
      clearOptimisticLockReadersForTests()
    }
  })

  test('still wires the registered moduleConfigService when configs is enabled', async () => {
    const storedSettings = { ...DEFAULT_RECORD_LOCK_SETTINGS, enabled: false }
    const moduleConfigService = { getValue: jest.fn().mockResolvedValue(storedSettings), setValue: jest.fn() }
    const { container } = buildContainer({ moduleConfigService })

    const recordLockService = container.resolve<RecordLockService>('recordLockService')
    await recordLockService.getSettings()

    expect(moduleConfigService.getValue).toHaveBeenCalled()
  })
})
