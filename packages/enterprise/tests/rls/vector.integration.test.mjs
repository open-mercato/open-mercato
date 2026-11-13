import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const execute = promisify(execFile)
test('production enterprise adapter supports restricted pgvector runtime and enforced canary', { timeout: 120_000 }, async (context) => {
  assert.ok(process.env.OM_RLS_TEST_DATABASE_URL?.trim(), 'Set OM_RLS_TEST_DATABASE_URL to an explicitly disposable pgvector database; this live regression never skips')
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const directory = await mkdtemp(path.join(tmpdir(), 'om-vector-loader-'))
  const config = path.join(directory, 'tsconfig.json')
  await writeFile(config, JSON.stringify({ extends: path.join(root, 'tsconfig.base.json'), compilerOptions: {
    paths: { '@open-mercato/search/*': [path.join(root, 'packages/search/src/*')], '@open-mercato/shared/*': [path.join(root, 'packages/shared/src/*')] },
  }, files: [path.join(root, 'packages/enterprise/tests/rls/vector.run.ts')] }))
  let output
  try {
    const result = await execute(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./vector.run.ts', import.meta.url))], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)), env: { ...process.env, TSX_TSCONFIG_PATH: config }, timeout: 90_000, maxBuffer: 1024 * 1024,
    })
    output = result.stdout
  } catch {
    assert.fail('RLS vector regression failed; run vector.run.ts privately with source path aliases for database diagnostics')
  } finally { await rm(directory, { recursive: true, force: true }) }
  const passed = output.split('\n').filter((line) => line.startsWith('PASS '))
  for (const line of passed) context.diagnostic(line)
  assert.equal(passed.length, 6)
  assert.ok(output.includes('Enterprise RLS vector regression: 6 checks passed; disposable fixtures removed.'))
})
