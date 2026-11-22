import commands from '../cli'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { cleanupLegacyNotificationCommands } from '../lib/legacyCommandCleanup'
import { createQueue } from '@open-mercato/queue'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({ invalidateCrudCache: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))
jest.mock('../lib/legacyCommandCleanup', () => ({ cleanupLegacyNotificationCommands: jest.fn() }))
jest.mock('@open-mercato/queue', () => ({ createQueue: jest.fn() }))

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const before = '2026-10-20T00:00:00.000Z'
const cleanup = commands.find((command) => command.command === 'cleanup-legacy-commands')!

describe('legacy notification command cleanup CLI', () => {
  const database = {}
  const emit = jest.fn()
  const em = { fork: jest.fn(), getKysely: () => database }
  const container = { resolve: (name: string) => name === 'em' ? em : { emit } }

  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    jest.mocked(createRequestContainer).mockResolvedValue(container as never)
    jest.mocked(cleanupLegacyNotificationCommands).mockResolvedValue([])
    emit.mockResolvedValue(undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  it.each([
    [],
    ['--before', before],
    ['--tenant', tenantId],
    ['--tenant', 'invalid', '--before', before],
    ['--tenant', tenantId, '--before', 'not-a-date'],
    ['--tenant', tenantId, '--before', '2999-01-01T00:00:00Z'],
    ['--tenant', tenantId, '--before', before, '--limit', '101'],
    ['--tenant', tenantId, '--before', before, '--limit', '0'],
    ['--tenant', tenantId, '--before', before, '--org', 'invalid'],
    ['--tenant', tenantId, '--before', before, '--apply=typo'],
    ['--tenant', tenantId, '--before', before, '--all-tenants'],
  ])('rejects unsafe options before opening a container: %j', async (...args) => {
    await expect(cleanup.run(args)).rejects.toThrow('notifications.cli.legacyCommands.usage')
    expect(createRequestContainer).not.toHaveBeenCalled()
    expect(cleanupLegacyNotificationCommands).not.toHaveBeenCalled()
  })

  it('previews one bounded tenant batch by default without invalidating or emitting', async () => {
    await cleanup.run(['--tenant', tenantId, '--before', before])
    expect(cleanupLegacyNotificationCommands).toHaveBeenCalledWith(database, {
      tenant: tenantId, before, limit: 100, apply: false,
    })
    expect(invalidateCrudCache).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('applies only the requested scope and invalidates each changed organization once after writing', async () => {
    jest.mocked(cleanupLegacyNotificationCommands).mockResolvedValue([
      { id: 'first', tenantId, organizationId },
      { id: 'second', tenantId, organizationId },
    ])
    await cleanup.run(['--tenant', tenantId, '--org', organizationId, '--before', before, '--limit', '2', '--apply'])
    expect(cleanupLegacyNotificationCommands).toHaveBeenCalledWith(database, {
      tenant: tenantId, org: organizationId, before, limit: 2, apply: true,
    })
    expect(invalidateCrudCache).toHaveBeenCalledTimes(1)
    expect(invalidateCrudCache).toHaveBeenCalledWith(container, 'notifications.notification', {
      tenantId, organizationId,
    }, tenantId, 'updated')
    expect(emit).toHaveBeenCalledWith('notifications.expired', {
      tenantId, notificationIds: ['first', 'second'],
    })
    expect(jest.mocked(cleanupLegacyNotificationCommands).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(invalidateCrudCache).mock.invocationCallOrder[0])
  })

  it('does not invalidate caches or emit when the write fails', async () => {
    jest.mocked(cleanupLegacyNotificationCommands).mockRejectedValue(new Error('[internal] Fixture failure'))
    await expect(cleanup.run(['--tenant', tenantId, '--before', before, '--apply'])).rejects.toThrow('[internal] Fixture failure')
    expect(invalidateCrudCache).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('preserves the existing cleanup-expired command', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined)
    jest.mocked(createQueue).mockReturnValue({ enqueue } as never)
    await commands.find((command) => command.command === 'cleanup-expired')!.run([])
    expect(createQueue).toHaveBeenCalledWith('notifications', 'async')
    expect(enqueue).toHaveBeenCalledWith({ type: 'cleanup-expired' })
    expect(createRequestContainer).not.toHaveBeenCalled()
  })
})
