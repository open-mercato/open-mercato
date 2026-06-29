import { commandRegistry, registerCommand, registerCommandLoaders } from '@open-mercato/shared/lib/commands'

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
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
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
    expect(debugSpy).toHaveBeenCalledWith('[Bootstrap] Commands re-registered (this may occur during HMR)')
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
})
