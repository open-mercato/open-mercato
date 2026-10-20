import type { Module } from '@open-mercato/shared/modules/registry'
import { getAmbientCausation, type CausationEnvelope } from '@open-mercato/shared/lib/causation/server'
import { registerCliModules, run, runModuleCommand } from '../mercato'

type CapturedRun = { args: string[]; causation: CausationEnvelope | null }

function captureModule(moduleId: string, commandName: string, captured: CapturedRun[]): Module {
  return {
    id: moduleId,
    cli: [
      {
        command: commandName,
        run: async (args: string[]) => {
          captured.push({ args, causation: getAmbientCausation() })
        },
      },
    ],
  } as Module
}

describe('mercato module command causation', () => {
  let consoleLogSpy: jest.SpyInstance
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('runs a module command inside a cli system entry frame', async () => {
    const seen: Array<CausationEnvelope | null> = []
    registerCliModules([
      {
        id: 'causation_probe',
        cli: [{ command: 'capture', run: async () => { seen.push(getAmbientCausation()) } }],
      } as Module,
    ])

    const exitCode = await run(['node', 'mercato', 'causation_probe', 'capture', '--flag'])

    expect(exitCode).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.frames).toEqual([{ kind: 'system', ref: 'cli:causation_probe:capture' }])
    expect(getAmbientCausation()).toBeNull()
  })

  it('keeps a failing module command reported as a failure', async () => {
    registerCliModules([
      {
        id: 'causation_probe',
        cli: [{ command: 'explode', run: async () => { throw new Error('probe failure') } }],
      } as Module,
    ])

    const exitCode = await run(['node', 'mercato', 'causation_probe', 'explode'])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('probe failure'))
  })

  it('does not seed a frame for built-in infrastructure commands', async () => {
    const seen: Array<CausationEnvelope | null> = []
    registerCliModules([
      {
        id: 'db',
        cli: [{ command: 'generate', run: async () => { seen.push(getAmbientCausation()) } }],
      } as Module,
    ])

    const exitCode = await run(['node', 'mercato', 'db', 'generate'])

    expect(exitCode).toBe(0)
    expect(seen).toEqual([null])
  })
})

describe('runModuleCommand causation', () => {
  const originalFlag = process.env.OM_CAUSATION
  let consoleLogSpy: jest.SpyInstance

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    if (originalFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = originalFlag
  })

  it('runs a nested module command inside its own cli system entry frame', async () => {
    const captured: CapturedRun[] = []

    const ran = await runModuleCommand([captureModule('auth', 'setup', captured)], 'auth', 'setup', ['--tenant', 't-1'])

    expect(ran).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0].args).toEqual(['--tenant', 't-1'])
    expect(captured[0].causation?.frames).toEqual([{ kind: 'system', ref: 'cli:auth:setup' }])
    expect(getAmbientCausation()).toBeNull()
  })

  it('gives every nested module command a fresh correlation', async () => {
    const captured: CapturedRun[] = []
    const modules = [captureModule('auth', 'setup', captured), captureModule('search', 'reindex', captured)]

    await runModuleCommand(modules, 'auth', 'setup')
    await runModuleCommand(modules, 'search', 'reindex')

    expect(captured.map((entry) => entry.causation?.frames)).toEqual([
      [{ kind: 'system', ref: 'cli:auth:setup' }],
      [{ kind: 'system', ref: 'cli:search:reindex' }],
    ])
    expect(captured[0].causation?.correlationId).not.toBe(captured[1].causation?.correlationId)
  })

  it('applies the same built-in module exemption as the top-level dispatch', async () => {
    const captured: CapturedRun[] = []

    for (const builtinModuleId of ['queue', 'generate', 'deploy', 'db', 'server', 'test']) {
      await runModuleCommand([captureModule(builtinModuleId, 'probe', captured)], builtinModuleId, 'probe')
    }

    expect(captured.map((entry) => entry.causation)).toEqual([null, null, null, null, null, null])
  })

  it('skips a missing optional command without running anything', async () => {
    const captured: CapturedRun[] = []

    const ran = await runModuleCommand([captureModule('auth', 'setup', captured)], 'dashboards', 'seed-defaults', [], {
      optional: true,
      silentOptional: true,
    })

    expect(ran).toBe(false)
    expect(captured).toEqual([])
  })

  it('propagates a failing nested command and leaves no frame behind', async () => {
    const failure = new Error('nested failure')
    const modules = [{ id: 'auth', cli: [{ command: 'setup', run: async () => { throw failure } }] } as Module]

    await expect(runModuleCommand(modules, 'auth', 'setup')).rejects.toBe(failure)
    expect(getAmbientCausation()).toBeNull()
  })

  it('installs no envelope when causation is disabled', async () => {
    process.env.OM_CAUSATION = 'off'
    const captured: CapturedRun[] = []

    await runModuleCommand([captureModule('auth', 'setup', captured)], 'auth', 'setup')

    expect(captured[0].causation).toBeNull()
  })
})
