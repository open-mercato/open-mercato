import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvText } from '../../perf/scripts/lib/env.mjs'
import { buildMigrationHead, datasetAgeDays, parseModuleIds, splitModuleSource } from '../../perf/scripts/lib/sutinfo.mjs'
import { assertRunnable, buildRunId } from '../../perf/scripts/commands/run.mjs'
import { planUsers, ownersFromUsers } from '../../perf/scripts/provision-users.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'))
const DURATION = /^\d+(ms|s|m|h)$/

test('tiers.json defines perf-v1 tiers and shape shares that sum to 1', () => {
  const tiers = readJson('perf/config/tiers.json')
  const profile = tiers.profiles['perf-v1']
  assert.deepEqual(Object.keys(profile.tiers), ['XS', 'S', 'M', 'L'])
  assert.deepEqual(Object.values(profile.tiers).map((tier) => tier.customerEntities), [2000, 50000, 100000, 1000000])
  for (const tier of Object.values(profile.tiers)) {
    assert.ok(Number.isInteger(tier.backgroundTenants) && tier.backgroundTenants >= 0)
    assert.ok(tier.backgroundScale > 0 && tier.backgroundScale < 1)
  }
  const shape = profile.shape
  assert.equal(shape.entities.peopleShare + shape.entities.companiesShare, 1)
  const bucketShare = shape.interactions.buckets.reduce((total, bucket) => total + bucket.share, 0)
  assert.ok(Math.abs(bucketShare - 1) < 1e-9)
  assert.deepEqual(shape.interactions.buckets.map((bucket) => bucket.name), ['light', 'medium', 'heavy', 'extreme'])
  assert.ok(shape.deals.statuses.includes('lost'))
  assert.equal(shape.owners.adminUsers + shape.owners.employeeUsers, shape.owners.staffUsers)
})

test('workload.json matches the documented schema', () => {
  const workload = readJson('perf/config/workload.json')
  assert.equal(workload.version, 1)
  assert.deepEqual(Object.keys(workload.groups), ['read', 'write', 'heavy'])
  assert.deepEqual(Object.values(workload.groups).map((group) => group.share), [70, 20, 10])
  for (const group of Object.values(workload.groups)) {
    assert.ok(Object.keys(group.journeys).length > 0)
    for (const weight of Object.values(group.journeys)) assert.ok(Number.isFinite(weight) && weight > 0)
  }
  assert.ok(workload.thinkTime.minSeconds === 5 && workload.thinkTime.maxSeconds === 30)
  assert.match(workload.warmup.duration, DURATION)
  assert.deepEqual(workload.profiles.step.steps, [10, 25, 50, 100, 200])
  assert.deepEqual(workload.profiles.mini.steps, [10, 25])
  for (const name of ['mini', 'step', 'stress', 'soak']) {
    const profile = workload.profiles[name]
    assert.ok(['steps', 'stress', 'soak'].includes(profile.kind), name)
    for (const key of ['ramp', 'hold']) assert.match(profile[key], DURATION, `${name}.${key}`)
  }
  assert.deepEqual(workload.profiles.stress.multipliers, [1.5, 2, 3])
  for (const key of ['controlWindow', 'injectionWindow', 'recoveryWindow', 'bulkTimeout']) assert.match(workload.interference[key], DURATION, key)
  for (const journey of workload.interference.injectorJourneys) assert.ok(journey in workload.groups.heavy.journeys, journey)
  assert.equal(workload.safety.maxErrorRate, 0.2)
  assert.equal(workload.safety.maxP95Ms, 30000)
  assert.ok(workload.saturation.p95Factor > 1)
})

test('example env files declare every mandatory key', () => {
  const sut = parseEnvText(fs.readFileSync(path.join(ROOT, 'perf/config/sut.example.env'), 'utf8'))
  for (const key of ['COMPOSE_PROJECT_NAME', 'DEPLOY_ENV', 'POSTGRES_PASSWORD', 'JWT_SECRET', 'MEILISEARCH_MASTER_KEY', 'OM_INIT_SUPERADMIN_PASSWORD', 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'LOOKUP_HASH_PEPPER', 'GRAFANA_ADMIN_PASSWORD', 'DB_POOL_MAX', 'NODE_OPTIONS', 'REDIS_MAXMEMORY', 'PG_SHARED_BUFFERS']) {
    assert.ok(sut.has(key), key)
  }
  assert.equal(sut.get('COMPOSE_PROJECT_NAME'), 'om-perf')
  assert.equal(sut.get('DEPLOY_ENV'), 'perf')
  for (const [key, value] of sut) {
    if (/PASSWORD|SECRET|PEPPER|FALLBACK_KEY|MASTER_KEY/.test(key)) assert.equal(value, '__GENERATE__', `${key} must be a placeholder`)
  }
  const target = parseEnvText(fs.readFileSync(path.join(ROOT, 'perf/config/target.example.env'), 'utf8'))
  for (const key of ['PERF_TARGET_NAME', 'PERF_TARGET_KIND', 'BASE_URL', 'SUT_SSH', 'SUT_REPO_DIR', 'GENERATOR_LOCATION', 'HARDWARE_PROFILE', 'K6_NETWORK', 'PROM_RW_URL']) {
    assert.ok(target.has(key), key)
  }
})

test('module list parsing separates static and env-gated modules', () => {
  const source = "const x = []\nexport const enabledModules: ModuleEntry[] = [\n  { id: 'auth', from: '@open-mercato/core' },\n  { id: 'customers', from: '@open-mercato/core' },\n]\nif (flag) enabledModules.push({ id: 'sso', from: '@open-mercato/enterprise' })\n"
  assert.deepEqual(splitModuleSource(source), { staticIds: ['auth', 'customers'], conditionalIds: ['sso'] })
  assert.deepEqual(parseModuleIds("{ id: 'b' }, { id: \"a\" }"), ['a', 'b'])
  const real = splitModuleSource(fs.readFileSync(path.join(ROOT, 'apps/mercato/src/modules.ts'), 'utf8'))
  assert.ok(real.staticIds.includes('customers'))
  assert.ok(real.staticIds.includes('example'))
})

test('migration head hash is order independent', () => {
  const first = buildMigrationHead([{ module: 'customers', name: 'Migration2', count: 3 }, { module: 'auth', name: 'Migration1', count: 2 }])
  const second = buildMigrationHead([{ module: 'auth', name: 'Migration1', count: 2 }, { module: 'customers', name: 'Migration2', count: 3 }])
  assert.equal(first.hash, second.hash)
  assert.equal(first.latest, 'Migration2')
  assert.equal(first.count, 5)
})

test('dataset age is counted in whole days from the anchor', () => {
  assert.equal(datasetAgeDays('2026-11-20', new Date('2026-11-26T15:00:00Z')), 6)
  assert.equal(datasetAgeDays(null), null)
})

test('run ids and the restore guard', () => {
  assert.equal(buildRunId({ date: '2026-11-26', tier: 'S', scenario: 'step', label: 'Mini Run!' }), '2026-11-26-S-step-mini-run')
  const marker = { tier: 'S', loadPhaseRanSince: false, restoredAt: 'x', snapshotId: 's' }
  assert.doesNotThrow(() => assertRunnable({ restoreMarker: marker, tier: 'S', scenario: 'smoke' }))
  assert.throws(() => assertRunnable({ restoreMarker: null, tier: 'S', scenario: 'smoke' }), /no restore marker/)
  assert.throws(() => assertRunnable({ restoreMarker: { ...marker, loadPhaseRanSince: true }, tier: 'S', scenario: 'smoke' }), /already ran/)
  assert.throws(() => assertRunnable({ restoreMarker: marker, tier: 'L', scenario: 'smoke' }), /holds tier S/)
  assert.throws(() => assertRunnable({ restoreMarker: marker, tier: 'S', scenario: 'nope' }), /unknown scenario/)
})

test('user plan has 20 admins and 180 employees and owners skip unprovisioned users', () => {
  const plan = planUsers()
  assert.equal(plan.length, 200)
  assert.equal(plan.filter((user) => user.role === 'admin').length, 20)
  assert.equal(plan[0].email, 'perf-user-001@perf.local')
  const owners = ownersFromUsers([{ userId: 'u1', staffMemberId: 's1' }, { userId: null }])
  assert.deepEqual(owners, { owners: [{ userId: 'u1', staffMemberId: 's1' }] })
})
