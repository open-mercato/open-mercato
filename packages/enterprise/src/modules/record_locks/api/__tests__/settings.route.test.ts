import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'
import { createCacheService } from '@open-mercato/cache'
import { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'
import { register } from '@open-mercato/core/modules/configs/di'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { GET, POST } from '@open-mercato/enterprise/modules/record_locks/api/settings/route'
import { resolveRecordLocksApiContext } from '@open-mercato/enterprise/modules/record_locks/api/utils'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../../lib/config'
import { RecordLockService } from '../../lib/recordLockService'
import { setup } from '../../setup'

jest.mock('@open-mercato/enterprise/modules/record_locks/api/utils', () => ({
  resolveRecordLocksApiContext: jest.fn(),
}))

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/record_locks/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('record_locks settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('GET returns current settings', async () => {
    const settings = {
      enabled: false,
      strategy: 'optimistic',
      timeoutSeconds: 300,
      heartbeatSeconds: 30,
      enabledResources: [],
      allowForceUnlock: true,
      allowIncomingOverride: true,
      notifyOnConflict: true,
    }

    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      recordLockService: {
        getSettings: jest.fn().mockResolvedValue(settings),
      },
    })

    const response = await GET(new Request('http://localhost/api/record_locks/settings'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ settings })
  })

  test('POST returns 400 when payload is invalid', async () => {
    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      recordLockService: { saveSettings: jest.fn() },
    })

    const response = await POST(makeRequest({ enabled: 'yes' }))
    expect(response.status).toBe(400)
  })

  test('POST saves and returns settings', async () => {
    const settings = {
      enabled: true,
      strategy: 'pessimistic',
      timeoutSeconds: 600,
      heartbeatSeconds: 30,
      enabledResources: ['sales.quote'],
      allowForceUnlock: true,
      allowIncomingOverride: true,
      notifyOnConflict: true,
    }

    const saveSettings = jest.fn().mockResolvedValue(settings)
    ;(resolveRecordLocksApiContext as jest.Mock).mockResolvedValue({
      recordLockService: { saveSettings },
    })

    const response = await POST(makeRequest(settings))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ settings })
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      strategy: 'pessimistic',
      timeoutSeconds: 600,
      heartbeatSeconds: 30,
      enabledResources: ['sales.quote'],
      allowForceUnlock: true,
      notifyOnConflict: true,
    }))
  })

  test('GET exposes repaired legacy settings after tenant setup and POST customizations survive a rerun', async () => {
    const row = Object.assign(new ModuleConfig(), {
      moduleId: 'record_locks',
      name: 'settings',
      tenantId: null,
      organizationId: null,
      valueJson: { timeoutSeconds: 450, enabledResources: ['', '   '] },
    })
    const findOne = jest.fn(async () => row)
    const flush = jest.fn(async () => {})
    const em = {
      findOne,
      flush,
      getContext: () => em,
      getRepository: () => ({ findOne }),
      getTransactionContext: () => undefined,
      isInTransaction: () => false,
      transactional: async (run: (manager: EntityManager) => Promise<void>) => run(em as unknown as EntityManager),
    } as unknown as EntityManager
    const container = createContainer()
    container.register({
      em: asValue(em),
      cache: asValue(createCacheService({ strategy: 'memory' })),
    })
    register(container)

    const configService = container.resolve<ModuleConfigService>('moduleConfigService')
    const recordLockService = new RecordLockService({ em, moduleConfigService: configService })
    const context = { recordLockService } as Awaited<ReturnType<typeof resolveRecordLocksApiContext>>
    jest.mocked(resolveRecordLocksApiContext).mockResolvedValue(context)
    const scope = { em, container, tenantId: 'tenant-1', organizationId: 'org-1' }
    const request = new Request('http://localhost/api/record_locks/settings')

    try {
      expect(await configService.getValue('record_locks', 'settings')).toEqual(row.valueJson)
      await setup.onTenantCreated?.(scope)
      const repaired = await GET(request)
      expect(repaired.status).toBe(200)
      expect(await repaired.json()).toEqual({ settings: { ...DEFAULT_RECORD_LOCK_SETTINGS, timeoutSeconds: 450 } })

      const custom = { ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['customers.*'], timeoutSeconds: 600 }
      const posted = await POST(makeRequest(custom))
      expect(posted.status).toBe(200)
      expect(await posted.json()).toEqual({ settings: custom })

      flush.mockClear()
      await setup.onTenantCreated?.(scope)
      expect(flush).not.toHaveBeenCalled()
      expect(await (await GET(request)).json()).toEqual({ settings: custom })
    } finally {
      await container.dispose()
    }
  })
})
