import { buildCatalog, buildManifest, canonicalJson, manifestChecksum } from '../catalog'
import { buildBatch, planEntity } from '../generator'
import { NO_HIT_TERMS } from '../profile'
import { MANIFEST_COUNT_KEYS, emptyManifestCounts } from '../types'
import { buildTestContext, TEST_ANCHOR } from './fixtures'

describe('perf seed manifest', () => {
  it('follows the contract shape and checksums the canonical identity', () => {
    const ctx = buildTestContext()
    const counts = { ...emptyManifestCounts(), customer_entities: 2000, customer_tags: 50 }
    const manifest = buildManifest(ctx, counts, { startedAt: '2026-11-26T10:00:00.000Z', finishedAt: new Date('2026-11-26T10:05:00.000Z') })
    expect(Object.keys(manifest).sort()).toEqual(
      ['anchor', 'checksum', 'counts', 'durationMs', 'finishedAt', 'organizationId', 'profile', 'seed', 'startedAt', 'tenantId', 'tier', 'version'].sort(),
    )
    expect(Object.keys(manifest.counts)).toEqual([...MANIFEST_COUNT_KEYS])
    expect(manifest).toMatchObject({ version: 1, profile: 'perf-v1', tier: 'XS', seed: 42, anchor: TEST_ANCHOR, durationMs: 300000 })
    expect(manifest.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.checksum).toBe(manifestChecksum({ profile: 'perf-v1', tier: 'XS', seed: 42, anchor: TEST_ANCHOR, counts }))
    expect(manifestChecksum({ profile: 'perf-v1', tier: 'XS', seed: 42, anchor: TEST_ANCHOR, counts: { ...counts, customer_entities: 1 } })).not.toBe(manifest.checksum)
  })

  it('serializes canonical JSON with sorted keys', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}')
  })
})

describe('perf seed catalog', () => {
  const ctx = buildTestContext()
  const catalog = buildCatalog(ctx)

  it('follows the contract shape and caps every array', () => {
    expect(Object.keys(catalog).sort()).toEqual(
      ['anchor', 'companies', 'deals', 'dictionaries', 'emailPrefixes', 'heavyOwners', 'hotSet', 'organizationId', 'owners', 'people', 'pipelines', 'profile', 'searchTerms', 'seed', 'tags', 'tenantId', 'tier', 'version'].sort(),
    )
    expect(Object.keys(catalog.people).sort()).toEqual(['extreme', 'heavy', 'light', 'medium'])
    expect(Object.keys(catalog.searchTerms).sort()).toEqual(['common', 'noHit', 'prefix', 'unique'])
    expect(catalog.hotSet.people).toHaveLength(50)
    expect(catalog.hotSet.companies).toHaveLength(20)
    expect(catalog.pipelines).toHaveLength(2)
    expect(catalog.pipelines.every((pipeline) => pipeline.stages.length === 6)).toBe(true)
    expect(Object.keys(catalog.deals.byStage)).toHaveLength(12)
    expect(catalog.tags).toHaveLength(50)
    expect(catalog.heavyOwners).toHaveLength(20)
    const arrays: unknown[][] = [
      ...Object.values(catalog.people),
      ...Object.values(catalog.companies),
      catalog.deals.sample,
      ...Object.values(catalog.deals.byStage),
      catalog.tags,
      catalog.owners,
      catalog.emailPrefixes,
    ]
    for (const array of arrays) expect(array.length).toBeLessThanOrEqual(2000)
  })

  it('assigns entities to the bucket matching their interaction count', () => {
    const plansById = new Map(Array.from({ length: ctx.entityCount }, (_, index) => planEntity(ctx, index)).map((plan) => [plan.id, plan]))
    for (const [bucket, ids] of Object.entries(catalog.people)) {
      for (const id of ids) {
        const plan = plansById.get(id)
        expect(plan?.kind).toBe('person')
        expect(plan?.bucket).toBe(bucket)
      }
    }
  })

  it('computes expected hit counts from the generated plaintext names', () => {
    const people = Array.from({ length: ctx.entityCount }, (_, index) => planEntity(ctx, index)).filter((plan) => plan.kind === 'person')
    const tokenHits = (term: string) =>
      people.filter((plan) => plan.firstName?.toLowerCase() === term.toLowerCase() || plan.lastName?.toLowerCase() === term.toLowerCase()).length
    expect(catalog.searchTerms.unique.length).toBeGreaterThan(0)
    for (const entry of catalog.searchTerms.unique) expect(tokenHits(entry.term)).toBe(1)
    for (const entry of catalog.searchTerms.common) {
      expect(entry.expected).toBeGreaterThan(1)
      expect(tokenHits(entry.term)).toBe(entry.expected)
    }
    for (const entry of catalog.searchTerms.prefix) {
      const lowered = entry.term.toLowerCase()
      const hits = people.filter(
        (plan) => plan.firstName?.toLowerCase().startsWith(lowered) || plan.lastName?.toLowerCase().startsWith(lowered),
      ).length
      expect(hits).toBe(entry.expected)
    }
    expect(catalog.searchTerms.noHit.map((entry) => entry.term)).toEqual(NO_HIT_TERMS)
  })

  it('never emits no-hit terms anywhere in generated text', () => {
    const batch = buildBatch(ctx, 0, ctx.entityCount)
    const needles = NO_HIT_TERMS.map((term) => term.toLowerCase())
    const texts: string[] = []
    for (const rows of Object.values(batch.rows)) {
      for (const row of rows) {
        for (const value of Object.values(row)) if (typeof value === 'string') texts.push(value.toLowerCase())
      }
    }
    for (const draft of batch.customFields) if (typeof draft.value === 'string') texts.push(draft.value.toLowerCase())
    const corpus = texts.join('\n')
    expect(needles.filter((needle) => corpus.includes(needle))).toEqual([])
  })
})
