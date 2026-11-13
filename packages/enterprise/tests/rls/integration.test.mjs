import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execute = promisify(execFile)
const databaseUrl = process.env.OM_RLS_TEST_DATABASE_URL?.trim()

async function verifyRegression(context, mode) {
  const catalogBoundary = mode === 'catalog'
  const expectedChecks = catalogBoundary ? 26 : 16
  let output
  try {
    const result = await execute(process.execPath, [
      '--import', 'tsx', fileURLToPath(new URL(catalogBoundary ? './catalog.run.ts' : './run.ts', import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
      env: { ...process.env, OM_RLS_TEST_DATABASE_URL: databaseUrl },
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
    })
    output = result.stdout
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown'
    assert.fail(`RLS database regression failed (exit ${code}); run the operator command privately for database diagnostics`)
  }

  const passed = output.split('\n').filter((line) => line.startsWith('PASS '))
  for (const line of passed) context.diagnostic(line)
  assert.equal(passed.length, expectedChecks)
  if (catalogBoundary) {
    assert.ok(output.includes(`Enterprise RLS catalog regression: ${expectedChecks} checks passed; disposable fixtures removed.`))
  } else {
    assert.ok(passed.includes('PASS disposable schema and role are removed'))
    assert.ok(output.includes(`Enterprise RLS runtime regression: ${expectedChecks} checks passed; disposable fixtures only.`))
  }
}

const options = {
  skip: databaseUrl ? false : 'Set OM_RLS_TEST_DATABASE_URL to an explicitly disposable PostgreSQL database',
  timeout: 120_000,
}

test('enterprise RLS runtime guards reject stale leases and escaped ORM transactions', options,
  (context) => verifyRegression(context, 'runtime'))

test('enterprise RLS catalog rejects unsafe roles and policy drift and verifies reconciliation and rollback', options,
  (context) => verifyRegression(context, 'catalog'))
