import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseEnvText, redactEnv, envHash, notableEnv, mergeEnvTemplate, findUnsafeSecrets, keyFingerprint, isSecretKey,
} from '../../perf/scripts/lib/env.mjs'
import { checkComparability, compareTagRows, isTimeRelativeTag } from '../../perf/scripts/lib/guard.mjs'

const BASE_RUN = {
  runId: 'a',
  scenario: 'step',
  tier: 'L',
  profile: 'step',
  hardwareProfile: 'vps-8c32g',
  generatorLocation: 'fsn1-gen',
  modules: ['customers', 'auth', 'example'],
  migrationHead: { hash: 'h1' },
  datasetAgeDays: 2,
  localValidation: false,
}

test('parseEnvText reads keys, strips quotes and skips comments', () => {
  const entries = parseEnvText('# c\nA=1\nB="two words"\nexport C=\'x\'\n\nbad line\n')
  assert.deepEqual([...entries], [['A', '1'], ['B', 'two words'], ['C', 'x']])
})

test('secret keys are recognized and redacted', () => {
  for (const key of ['JWT_SECRET', 'POSTGRES_PASSWORD', 'LOOKUP_HASH_PEPPER', 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'MEILISEARCH_MASTER_KEY']) {
    assert.equal(isSecretKey(key), true, key)
  }
  assert.equal(isSecretKey('DB_POOL_MAX'), false)
  const redacted = redactEnv(new Map([['JWT_SECRET', 'abc'], ['DB_POOL_MAX', '20'], ['OPENAI_API_KEY', '']]))
  assert.deepEqual(redacted, { JWT_SECRET: '<redacted>', DB_POOL_MAX: '20', OPENAI_API_KEY: '' })
})

test('envHash ignores secret values but tracks configuration', () => {
  const first = envHash(new Map([['JWT_SECRET', 'one'], ['DB_POOL_MAX', '20']]))
  const otherSecret = envHash(new Map([['DB_POOL_MAX', '20'], ['JWT_SECRET', 'two']]))
  const otherConfig = envHash(new Map([['JWT_SECRET', 'one'], ['DB_POOL_MAX', '40']]))
  assert.equal(first, otherSecret)
  assert.notEqual(first, otherConfig)
  assert.match(first, /^[0-9a-f]{64}$/)
})

test('notableEnv keeps tuning keys and OM_ flags, never secrets', () => {
  const notable = notableEnv(new Map([['DB_POOL_MAX', '20'], ['OM_ENCRYPTED_SORT_MAX_ROWS', '500'], ['JWT_SECRET', 'x'], ['OM_INIT_SUPERADMIN_PASSWORD', 'y'], ['FOO', 'bar']]))
  assert.deepEqual(notable, { DB_POOL_MAX: '20', OM_ENCRYPTED_SORT_MAX_ROWS: '500' })
})

test('mergeEnvTemplate generates placeholders and never overwrites existing values', () => {
  const template = '# header\nJWT_SECRET=__GENERATE__\nPOSTGRES_PASSWORD=__GENERATE__\nDB_POOL_MAX=20\n'
  const existing = new Map([['JWT_SECRET', 'keep-me'], ['CUSTOM', 'local']])
  const { text, generated } = mergeEnvTemplate(template, existing, (key) => `gen-${key}`)
  const merged = parseEnvText(text)
  assert.equal(merged.get('JWT_SECRET'), 'keep-me')
  assert.equal(merged.get('POSTGRES_PASSWORD'), 'gen-POSTGRES_PASSWORD')
  assert.equal(merged.get('DB_POOL_MAX'), '20')
  assert.equal(merged.get('CUSTOM'), 'local')
  assert.deepEqual(generated, ['POSTGRES_PASSWORD'])
  assert.match(text, /^# header/)
})

test('findUnsafeSecrets rejects compose defaults, placeholders and short keys', () => {
  const unsafe = new Map([
    ['POSTGRES_PASSWORD', 'postgres'],
    ['JWT_SECRET', '__GENERATE__'],
    ['MEILISEARCH_MASTER_KEY', 'meilisearch-dev-key'],
    ['OM_INIT_SUPERADMIN_PASSWORD', 'password'],
    ['GRAFANA_ADMIN_PASSWORD', 'x'],
    ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'short'],
  ])
  const problems = findUnsafeSecrets(unsafe)
  assert.ok(problems.some((problem) => problem.startsWith('POSTGRES_PASSWORD still equals')))
  assert.ok(problems.some((problem) => problem.startsWith('JWT_SECRET is unset')))
  assert.ok(problems.some((problem) => problem.startsWith('MEILISEARCH_MASTER_KEY still equals')))
  assert.ok(problems.some((problem) => problem.startsWith('TENANT_DATA_ENCRYPTION_FALLBACK_KEY is shorter')))
  assert.ok(problems.some((problem) => problem.startsWith('LOOKUP_HASH_PEPPER is unset')))
  const hex = 'a1'.repeat(32)
  const safe = new Map([
    ['POSTGRES_PASSWORD', 'Pf!xyz'], ['JWT_SECRET', hex], ['MEILISEARCH_MASTER_KEY', hex], ['OM_INIT_SUPERADMIN_PASSWORD', 'Pf!abc'],
    ['GRAFANA_ADMIN_PASSWORD', 'Pf!def'], ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', hex], ['LOOKUP_HASH_PEPPER', hex],
  ])
  assert.deepEqual(findUnsafeSecrets(safe), [])
})

test('keyFingerprint changes with either encryption key and never contains it', () => {
  const keys = new Map([['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'k'.repeat(64)], ['LOOKUP_HASH_PEPPER', 'p'.repeat(64)]])
  const fingerprint = keyFingerprint(keys)
  assert.match(fingerprint, /^[0-9a-f]{16}$/)
  assert.notEqual(fingerprint, keyFingerprint(new Map([...keys, ['LOOKUP_HASH_PEPPER', 'q'.repeat(64)]])))
})

test('comparability guard accepts identical runs regardless of module order', () => {
  const result = checkComparability(BASE_RUN, { ...BASE_RUN, runId: 'b', modules: ['example', 'auth', 'customers'] })
  assert.equal(result.comparable, true)
  assert.deepEqual(result.mismatches, [])
  assert.deepEqual(result.flags, [])
})

test('comparability guard refuses mismatched tier, hardware, generator and modules', () => {
  const result = checkComparability(BASE_RUN, { ...BASE_RUN, tier: 'M', hardwareProfile: 'vps-4c8g', generatorLocation: 'laptop', modules: ['auth'] })
  assert.equal(result.comparable, false)
  assert.deepEqual(result.mismatches.map((entry) => entry.key).sort(), ['generatorLocation', 'hardwareProfile', 'modules', 'tier'])
})

test('comparability guard flags migration head and dataset age without refusing', () => {
  const result = checkComparability(BASE_RUN, { ...BASE_RUN, migrationHead: { hash: 'h2' }, datasetAgeDays: 12 })
  assert.equal(result.comparable, true)
  const kinds = result.flags.map((flag) => flag.kind)
  assert.ok(kinds.includes('migration-head'))
  assert.ok(kinds.includes('dataset-age'))
  assert.ok(kinds.includes('time-relative'))
  assert.equal(result.timeRelativeComparable, false)
})

test('compareTagRows computes deltas and marks time-relative tags', () => {
  const rows = compareTagRows(
    [{ name: 'people.list:list', p50: 100, p95: 200, count: 10 }, { name: 'deals.summary', p50: 300, p95: 600, count: 5 }],
    [{ name: 'people.list:list', p50: 110, p95: 300, count: 12 }, { name: 'deals.summary', p50: 300, p95: 600, count: 5 }, { name: 'new.tag', p50: 1, p95: 2, count: 1 }],
    { timeRelativeComparable: false },
  )
  const people = rows.find((row) => row.name === 'people.list:list')
  assert.equal(people.deltaP95, 0.5)
  assert.equal(rows.find((row) => row.name === 'deals.summary').note, 'not comparable (time-relative)')
  assert.equal(rows.find((row) => row.name === 'new.tag').note, 'only in b')
  assert.equal(isTimeRelativeTag('dashboard:widgets'), true)
  assert.equal(isTimeRelativeTag('people.list:list'), false)
})
