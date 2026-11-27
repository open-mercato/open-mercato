import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseSeedPerfOptions } from '../options'
import { runPerfSeed, SEED_PERF_EXIT } from '../run'
import {
  advanceState,
  createInitialState,
  decideResume,
  pendingBatchRanges,
  readSeedState,
  writeSeedState,
  type SeedIdentity,
} from '../state'
import { emptyManifestCounts } from '../types'
import { TEST_ORG_ID, TEST_TENANT_ID } from './fixtures'

const identity: SeedIdentity = {
  profile: 'perf-v1',
  tier: 'XS',
  seed: 42,
  anchor: '2026-11-26',
  scale: 1,
  tenantId: TEST_TENANT_ID,
  organizationId: TEST_ORG_ID,
  entityCount: 2000,
}

describe('perf seed checkpoint and resume', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'perf-seed-'))
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('starts fresh without a checkpoint and refuses to overwrite one without --resume', () => {
    expect(decideResume(null, identity, false)).toEqual({ kind: 'fresh', notice: null })
    expect(decideResume(null, identity, true).kind).toBe('fresh')
    const state = createInitialState(identity, emptyManifestCounts(), new Date('2026-11-26T10:00:00Z'))
    expect(decideResume(state, identity, false).kind).toBe('error')
  })

  it('rejects a checkpoint written for another run identity', () => {
    const state = createInitialState(identity, emptyManifestCounts(), new Date())
    const decision = decideResume(state, { ...identity, seed: 7 }, true)
    expect(decision).toEqual({ kind: 'error', message: expect.stringContaining('seed: checkpoint=42 requested=7') })
  })

  it('persists progress and resumes from the next unprocessed entity', async () => {
    let state = createInitialState(identity, emptyManifestCounts(), new Date('2026-11-26T10:00:00Z'))
    const ranges = pendingBatchRanges(state.nextEntityIndex, identity.entityCount, 750)
    expect(ranges).toEqual([{ start: 0, end: 750 }, { start: 750, end: 1500 }, { start: 1500, end: 2000 }])
    state = advanceState(state, ranges[0].end, { customer_entities: 750, customer_interactions: 7000 }, new Date('2026-11-26T10:01:00Z'))
    await writeSeedState(outDir, state)

    const restored = await readSeedState(outDir)
    const decision = decideResume(restored, identity, true)
    if (decision.kind !== 'resume') throw new Error('expected resume decision')
    expect(decision.state.nextEntityIndex).toBe(750)
    expect(decision.state.counts.customer_entities).toBe(750)
    expect(pendingBatchRanges(decision.state.nextEntityIndex, identity.entityCount, 750)).toEqual([
      { start: 750, end: 1500 },
      { start: 1500, end: 2000 },
    ])
    const finished = advanceState(decision.state, 2000, { customer_entities: 1250 }, new Date())
    expect(finished.counts.customer_entities).toBe(2000)
    expect(finished.counts.customer_interactions).toBe(7000)
    expect(pendingBatchRanges(finished.nextEntityIndex, identity.entityCount, 750)).toEqual([])
  })

  it('returns null when no checkpoint exists', async () => {
    expect(await readSeedState(outDir)).toBeNull()
  })
})

describe('perf seed CLI options', () => {
  const now = new Date('2026-11-26T12:00:00Z')

  it('applies contract defaults', () => {
    const result = parseSeedPerfOptions(['--tenant', TEST_TENANT_ID, '--org', TEST_ORG_ID, '--tier', 'S', '--owners-file', 'owners.json'], now, '/work')
    if (!result.ok) throw new Error(result.message)
    expect(result.options).toMatchObject({
      profile: 'perf-v1',
      seed: 42,
      anchor: '2026-11-26',
      batch: 1000,
      resume: false,
      dryRun: false,
      scale: 1,
      ownersFile: '/work/owners.json',
      outDir: '/work/.mercato/perf-seed/S',
    })
  })

  it('requires owners unless running dry and validates the tier', () => {
    expect(parseSeedPerfOptions(['--tenant', TEST_TENANT_ID, '--org', TEST_ORG_ID, '--tier', 'S'], now, '/work').ok).toBe(false)
    expect(parseSeedPerfOptions(['--tenant', TEST_TENANT_ID, '--org', TEST_ORG_ID, '--tier', 'S', '--dry-run'], now, '/work').ok).toBe(true)
    expect(parseSeedPerfOptions(['--tenant', TEST_TENANT_ID, '--org', TEST_ORG_ID, '--tier', 'XL', '--dry-run'], now, '/work').ok).toBe(false)
  })

  it('exits with the usage code on invalid input and runs a dry run without a database', async () => {
    const lines: string[] = []
    const deps = {
      createContainer: () => Promise.reject(new Error('[internal] container must not be created')),
      seedDictionaries: async () => undefined,
      ensureCustomFieldDefinitions: async () => undefined,
      writeLine: (line: string) => lines.push(line),
      writeError: (line: string) => lines.push(line),
      now: () => now,
      cwd: '/work',
    }
    expect(await runPerfSeed(['--tier', 'S'], deps)).toBe(SEED_PERF_EXIT.usage)
    const code = await runPerfSeed(['--tenant', TEST_TENANT_ID, '--org', TEST_ORG_ID, '--tier', 'XS', '--scale', '0.1', '--dry-run'], deps)
    expect(code).toBe(SEED_PERF_EXIT.ok)
    expect(lines).toContain('[seed-perf]   customer_entities: 200')
    expect(lines).toContain('[seed-perf]   customer_tags: 50')
  })
})
