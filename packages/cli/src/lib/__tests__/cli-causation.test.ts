import { getAmbientCausation, runWithCausation } from '@open-mercato/shared/lib/causation/server'
import { buildCliCausationRef, runCliCommandWithCausation } from '../cli-causation'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('cli causation entry frame', () => {
  const originalFlag = process.env.OM_CAUSATION

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = originalFlag
  })

  it('builds the cli reference from module and command', () => {
    expect(buildCliCausationRef('auth', 'setup')).toBe('cli:auth:setup')
  })

  it('runs the command inside a system entry frame with a fresh correlation', async () => {
    const seen = await runCliCommandWithCausation('auth', 'setup', async () => {
      await Promise.resolve()
      return getAmbientCausation()
    })

    expect(seen?.frames).toEqual([{ kind: 'system', ref: 'cli:auth:setup' }])
    expect(seen?.correlationId).toMatch(UUID_PATTERN)
    expect(getAmbientCausation()).toBeNull()
  })

  it('starts a new entry instead of extending an outer envelope', () => {
    const outer = { correlationId: 'outer-correlation', frames: [{ kind: 'workflow' as const, id: 'instance-1' }] }
    const seen = runWithCausation(outer, () => runCliCommandWithCausation('search', 'reindex', () => getAmbientCausation()))

    expect(seen?.frames).toEqual([{ kind: 'system', ref: 'cli:search:reindex' }])
    expect(seen?.correlationId).not.toBe('outer-correlation')
  })

  it('propagates the command result and errors unchanged', async () => {
    await expect(runCliCommandWithCausation('auth', 'setup', async () => 'ok')).resolves.toBe('ok')
    await expect(runCliCommandWithCausation('auth', 'setup', async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
  })

  it('skips the frame when causation is disabled', () => {
    process.env.OM_CAUSATION = 'off'

    expect(runCliCommandWithCausation('auth', 'setup', () => getAmbientCausation())).toBeNull()
  })
})
