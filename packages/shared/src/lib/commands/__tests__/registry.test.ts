import { commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands'

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
})
