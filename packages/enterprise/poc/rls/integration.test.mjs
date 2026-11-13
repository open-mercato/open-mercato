import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execute = promisify(execFile)
const databaseUrl = process.env.OM_RLS_POC_DATABASE_URL?.trim()

async function verifyProof(context, mode) {
  const runtimeBoundary = mode === 'runtime'
  const catalogBoundary = mode === 'catalog'
  const expectedChecks = catalogBoundary ? 21 : runtimeBoundary ? 16 : 13
  let output
  try {
    const result = await execute(process.execPath, [
      '--import', 'tsx', fileURLToPath(new URL(catalogBoundary ? './catalog.run.ts' : './run.ts', import.meta.url)),
      ...(runtimeBoundary ? ['--runtime'] : []),
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
  assert.equal(passed.length, expectedChecks)
  if (catalogBoundary) {
    assert.ok(output.includes(`Enterprise RLS catalog proof: ${expectedChecks} checks passed; disposable fixtures removed.`))
  } else {
    assert.ok(passed.includes('PASS disposable schema and role are removed'))
    assert.ok(output.includes(`${runtimeBoundary ? 'Enterprise RLS runtime proof' : 'Enterprise RLS PoC'}: ${expectedChecks} checks passed; disposable fixtures only.`))
  }
}

const options = {
  skip: databaseUrl ? false : 'Set OM_RLS_POC_DATABASE_URL to an explicitly disposable PostgreSQL database',
  timeout: 120_000,
}

test('enterprise RLS prototype isolates real pooled database operations and removes its fixtures', options,
  (context) => verifyProof(context, 'prototype'))

test('enterprise RLS runtime guards reject stale leases and escaped ORM transactions', options,
  (context) => verifyProof(context, 'runtime'))

test('enterprise RLS catalog rejects unsafe roles and policy drift and verifies reconciliation and rollback', options,
  (context) => verifyProof(context, 'catalog'))
