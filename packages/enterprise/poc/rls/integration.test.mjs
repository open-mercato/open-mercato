import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execute = promisify(execFile)
const databaseUrl = process.env.OM_RLS_POC_DATABASE_URL?.trim()

test('enterprise RLS isolates real pooled database operations and removes its fixtures', {
  skip: databaseUrl ? false : 'Set OM_RLS_POC_DATABASE_URL to an explicitly disposable PostgreSQL database',
  timeout: 120_000,
}, async (context) => {
  let output
  try {
    const result = await execute(process.execPath, [
      '--import', 'tsx', fileURLToPath(new URL('./run.ts', import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
      env: { ...process.env, OM_RLS_POC_DATABASE_URL: databaseUrl },
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
    })
    output = result.stdout
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown'
    assert.fail(`RLS database proof failed (exit ${code}); run the operator command privately for database diagnostics`)
  }

  const passed = output.split('\n').filter((line) => line.startsWith('PASS '))
  for (const line of passed) context.diagnostic(line)
  assert.equal(passed.length, 13)
  assert.ok(passed.includes('PASS disposable schema and role are removed'))
  assert.match(output, /Enterprise RLS PoC: 13 checks passed; disposable fixtures only\./)
})
