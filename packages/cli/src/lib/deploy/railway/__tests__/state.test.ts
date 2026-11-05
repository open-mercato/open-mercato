import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRailwayState,
  loadRailwayState,
  railwayStatePath,
  saveRailwayState,
} from '../state'

describe('Railway deployment state', () => {
  it('round-trips schema version 1 without secrets', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mercato-railway-state-'))
    const path = railwayStatePath(cwd, true)
    const state = createRailwayState('my-shop', '0.6.4')
    state.projectId = 'project-id'
    state.environments.production = { environmentId: 'environment-id' }
    saveRailwayState(path, state)

    expect(loadRailwayState(path)).toEqual(state)
    expect(readFileSync(path, 'utf8')).not.toMatch(/token|password/i)
    expect(railwayStatePath(cwd, false).endsWith('.mercato/railway.json.local')).toBe(true)
  })
})
