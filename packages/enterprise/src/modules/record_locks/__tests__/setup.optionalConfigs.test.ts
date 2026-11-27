import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { InstanceConfigInitializer } from '@open-mercato/core/modules/configs/lib/instance-config-initializer'
import { setup } from '../setup'
import { DEFAULT_RECORD_LOCK_SETTINGS, normalizeRecordLockSettings } from '../lib/config'

type InitializationInput = Parameters<InstanceConfigInitializer['initialize']>[1]

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const em = {} as EntityManager
const onTenantCreated = setup.onTenantCreated!

function makeContainer(initialize?: InstanceConfigInitializer['initialize']) {
  const resolve = jest.fn(() => initialize ? { initialize } : undefined)
  return { container: { resolve } as unknown as AwilixContainer, resolve }
}

describe('Record Locks settings tenant setup', () => {
  test('skips with no Configs capability', async () => {
    const { container, resolve } = makeContainer()

    await expect(onTenantCreated({ em, ...scope })).resolves.toBeUndefined()
    await expect(onTenantCreated({ em, ...scope, container })).resolves.toBeUndefined()
    expect(resolve).toHaveBeenCalledWith('instanceConfigInitializer', { allowUnregistered: true })
  })

  test('honors the effective module set instead of resolving Configs from a broader container', async () => {
    const initialize = jest.fn<ReturnType<InstanceConfigInitializer['initialize']>, [EntityManager, InitializationInput]>()
    const { container, resolve } = makeContainer(initialize)

    await onTenantCreated({ em, ...scope, container, enabledModuleIds: new Set(['record_locks']) })

    expect(resolve).not.toHaveBeenCalled()
    expect(initialize).not.toHaveBeenCalled()
  })

  test('uses Configs to seed defaults and merge legacy settings without rewriting custom resource lists', async () => {
    const initialize = jest.fn(async (_manager: EntityManager, _input: InitializationInput) => {})
    const { container } = makeContainer(initialize)

    await onTenantCreated({ em, ...scope, container, enabledModuleIds: new Set(['record_locks', 'configs']) })

    const [manager, input] = initialize.mock.calls[0]!
    expect(manager).toBe(em)
    expect(input).toMatchObject({ moduleId: 'record_locks', name: 'settings', initialValue: DEFAULT_RECORD_LOCK_SETTINGS })
    expect(input.merge({ enabledResources: ['', '  example.documents '], timeoutSeconds: 450 })).toBeUndefined()

    for (const enabledResources of [undefined, null, [], ['', '   '], [null, false], 'legacy']) {
      const merged = input.merge({ enabledResources, timeoutSeconds: 450, allowIncomingOverride: false })
      expect(merged).toEqual({
        value: {
          enabledResources: DEFAULT_RECORD_LOCK_SETTINGS.enabledResources,
          timeoutSeconds: 450,
          allowIncomingOverride: false,
        },
      })
      expect(normalizeRecordLockSettings(merged?.value)).toMatchObject({
        enabledResources: DEFAULT_RECORD_LOCK_SETTINGS.enabledResources,
        timeoutSeconds: 450,
        allowIncomingOverride: false,
      })
      expect(input.merge(merged?.value)).toBeUndefined()
    }
  })

  test('propagates a registered provider failure', async () => {
    const failure = new Error('[internal] Configs persistence failed')
    const { container } = makeContainer(jest.fn().mockRejectedValue(failure))

    await expect(onTenantCreated({ em, ...scope, container })).rejects.toBe(failure)
  })
})
