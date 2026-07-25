import { commandRegistry, registerCommand, registerCommandLoaders } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})
const loggerDebug = createLogger('shared').debug as jest.Mock


describe('command registry registration', () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    commandRegistry.clear()
    process.env.NODE_ENV = originalNodeEnv
    jest.restoreAllMocks()
  })

  it('throws on duplicate command ids outside development', () => {
    process.env.NODE_ENV = 'test'

    registerCommand({
      id: 'test.command.duplicate',
      execute: jest.fn(),
    })

    expect(() =>
      registerCommand({
        id: 'test.command.duplicate',
        execute: jest.fn(),
      })
    ).toThrow('Duplicate command registration for id test.command.duplicate')
  })

  it('overwrites duplicate command ids in development to tolerate HMR re-evaluation', () => {
    process.env.NODE_ENV = 'development'
    loggerDebug.mockClear()
    const firstExecute = jest.fn(async () => 'first')
    const secondExecute = jest.fn(async () => 'second')

    registerCommand({
      id: 'test.command.hmr',
      execute: firstExecute,
    })

    registerCommand({
      id: 'test.command.hmr',
      execute: secondExecute,
    })

    expect(commandRegistry.get('test.command.hmr')?.execute).toBe(secondExecute)
    expect(loggerDebug).toHaveBeenCalledWith('Commands re-registered (this may occur during HMR)')
  })

  it('loads a command handler on demand from a registered loader', async () => {
    const execute = jest.fn(async () => ({ ok: true }))
    registerCommandLoaders([
      {
        moduleId: 'test',
        id: 'test.command.lazy',
        key: 'test:commands:lazy',
        load: async () => {
          registerCommand({
            id: 'test.command.lazy',
            execute,
          })
        },
      },
    ])

    expect(commandRegistry.get('test.command.lazy')).toBeNull()

    const handler = await commandRegistry.load('test.command.lazy')

    expect(handler?.execute).toBe(execute)
    expect(commandRegistry.get('test.command.lazy')?.execute).toBe(execute)
  })

  it('exposes exact lazy command IDs through list and has before loading', () => {
    registerCommandLoaders([
      {
        moduleId: 'test',
        id: 'test.command.lazy',
        key: 'test:commands:lazy',
        load: async () => {},
      },
      {
        moduleId: 'test',
        key: 'test:commands:fallback',
        load: async () => {},
      },
    ])

    expect(commandRegistry.has('test.command.lazy')).toBe(true)
    expect(commandRegistry.list()).toContain('test.command.lazy')
    expect(commandRegistry.list()).not.toContain('test:commands:fallback')
  })

  it('loads sibling module command files with an exact lazy command', async () => {
    registerCommandLoaders([
      {
        moduleId: 'test',
        id: 'test.command.primary',
        key: 'test:commands:primary',
        load: async () => {
          registerCommand({
            id: 'test.command.primary',
            execute: async () => ({ ok: true }),
          })
        },
      },
      {
        moduleId: 'test',
        key: 'test:commands:sibling',
        load: async () => {
          registerCommand({
            id: 'test.command.sibling',
            execute: async () => ({ ok: true }),
          })
        },
      },
    ])

    await commandRegistry.load('test.command.primary')

    expect(commandRegistry.get('test.command.primary')).not.toBeNull()
    expect(commandRegistry.get('test.command.sibling')).not.toBeNull()
  })
})
