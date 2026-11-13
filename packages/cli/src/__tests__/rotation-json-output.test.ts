import type { Module } from '@open-mercato/shared/modules/registry'
import { registerCliModules, run } from '../mercato'

describe('rotation dispatcher JSON progress', () => {
  const previousProgress = process.env.OM_ROTATION_PROGRESS

  afterEach(() => {
    if (previousProgress === undefined) delete process.env.OM_ROTATION_PROGRESS
    else process.env.OM_ROTATION_PROGRESS = previousProgress
    registerCliModules([])
    jest.restoreAllMocks()
  })

  it('keeps a rejected rotation stderr parseable and preserves its failure status', async () => {
    process.env.OM_ROTATION_PROGRESS = 'json'
    const message = 'Recovery refused: "untrusted"\nRetry after checking the report.'
    registerCliModules([{
      id: 'entities',
      cli: [{ command: 'rotate-encryption-key', run: async () => { throw new Error(message) } }],
    } as Module])
    const stdout = jest.spyOn(console, 'log').mockImplementation()
    const humanError = jest.spyOn(console, 'error').mockImplementation()
    const writes = jest.spyOn(process.stderr, 'write').mockReturnValue(true)

    expect(await run(['node', 'mercato', 'entities', 'rotate-encryption-key'])).toBe(1)
    expect(humanError).not.toHaveBeenCalled()
    const lines = writes.mock.calls.map(([chunk]) => String(chunk)).join('').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({
      schemaVersion: 1, type: 'phase.changed', runId: 'rotation', phase: 'rotation.failed', entity: message,
    })
    expect(stdout.mock.calls.flat().join('\n')).toContain('Running entities:rotate-encryption-key')
  })

  it.each([
    ['entities', 'rotate-encryption-key', undefined],
    ['entities', 'rotate-encryption-key', 'plain'],
    ['entities', 'other-command', 'json'],
    ['other-module', 'rotate-encryption-key', 'json'],
  ])('preserves ordinary failure output for %s %s with mode %s', async (moduleId, command, mode) => {
    if (mode === undefined) delete process.env.OM_ROTATION_PROGRESS
    else process.env.OM_ROTATION_PROGRESS = mode
    registerCliModules([{
      id: moduleId,
      cli: [{ command, run: async () => { throw new Error('fixture refused') } }],
    } as Module])
    jest.spyOn(console, 'log').mockImplementation()
    const humanError = jest.spyOn(console, 'error').mockImplementation()
    expect(await run(['node', 'mercato', moduleId, command])).toBe(1)
    expect(humanError).toHaveBeenCalledWith('💥 Failed: fixture refused')
  })
})
