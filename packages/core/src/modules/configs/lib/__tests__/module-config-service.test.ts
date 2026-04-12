import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfig } from '../../data/entities'
import {
  createModuleConfigService,
  ModuleConfigRestoreDefaultsError,
} from '../module-config-service'

type MockRepo = {
  findOne: jest.Mock<Promise<ModuleConfig | null>, [Record<string, string>]>
  create: jest.Mock<ModuleConfig, [Partial<ModuleConfig>]>
}

function makeEntity(overrides: Partial<ModuleConfig> = {}): ModuleConfig {
  return {
    id: overrides.id ?? 'cfg-1',
    moduleId: overrides.moduleId ?? 'notifications',
    name: overrides.name ?? 'delivery',
    valueJson: overrides.valueJson ?? { enabled: true },
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
  } as ModuleConfig
}

function createServiceHarness() {
  const repo: MockRepo = {
    findOne: jest.fn(),
    create: jest.fn((input: Partial<ModuleConfig>) => makeEntity({
      id: '',
      moduleId: input.moduleId,
      name: input.name,
      valueJson: input.valueJson,
    })),
  }
  const em = {
    getRepository: jest.fn(() => repo),
    persist: jest.fn(),
    flush: jest.fn(),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      throw new Error(`Unexpected resolve: ${name}`)
    }),
  } as unknown as AppContainer

  return {
    repo,
    em,
    service: createModuleConfigService(container),
  }
}

describe('module-config-service restoreDefaults', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('throws and avoids partial writes when any default entry fails', async () => {
    const { repo, em, service } = createServiceHarness()
    repo.findOne.mockResolvedValue(null)

    let thrown: unknown = null
    try {
      await service.restoreDefaults([
        { moduleId: 'notifications', name: 'delivery', value: { enabled: true } },
        { moduleId: '', name: 'broken', value: 'x' },
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ModuleConfigRestoreDefaultsError)
    expect(thrown).toMatchObject({
      failures: [
        expect.objectContaining({
          moduleId: '',
          name: 'broken',
        }),
      ],
    })

    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[configs.module-config] restoreDefaults failed for entry',
      expect.objectContaining({
        moduleId: '',
        name: 'broken',
      }),
    )
  })

  it('persists staged creates and forced updates when all entries succeed', async () => {
    const { repo, em, service } = createServiceHarness()
    const existing = makeEntity({
      id: 'existing-1',
      moduleId: 'vector',
      name: 'auto_index_enabled',
      valueJson: false,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    repo.findOne.mockImplementation(async ({ moduleId, name }) => {
      if (moduleId === 'vector' && name === 'auto_index_enabled') return existing
      return null
    })

    await service.restoreDefaults(
      [
        { moduleId: 'notifications', name: 'delivery', value: { enabled: true } },
        { moduleId: 'vector', name: 'auto_index_enabled', value: true },
      ],
      { force: true },
    )

    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({
      moduleId: 'notifications',
      name: 'delivery',
      valueJson: { enabled: true },
    }))
    expect(existing.valueJson).toBe(true)
    expect(existing.updatedAt.toISOString()).not.toBe('2026-01-01T00:00:00.000Z')
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
