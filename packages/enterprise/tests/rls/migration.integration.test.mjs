import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const execute = promisify(execFile)
const docker = (...args) => execute('docker', args, { timeout: 30_000, maxBuffer: 1024 * 1024 })

test('production dbMigrate recovers committed migrations only after RLS reconciliation', { timeout: 180_000 }, async (context) => {
  assert.equal(process.versions.node, '24.22.3', 'Run with Node 24.22.3')
  const suffix = randomUUID()
  const containers = [`om-rls-migration-pg-${suffix}`]
  const password = randomUUID()
  try {
    await docker('run', '-d', '--rm', '--name', containers[0], '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', 'postgres:17-alpine')
    const port = async (name, internal) => Number((await docker('port', name, internal)).stdout.trim().split(':').at(-1))
    const pgPort = await port(containers[0], '5432/tcp')
    for (let attempt = 0; ; attempt += 1) {
      try { await docker('exec', containers[0], 'pg_isready', '-U', 'postgres'); break } catch (error) {
        if (attempt >= 30) throw error
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    const result = await execute(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', fileURLToPath(new URL('./migration.run.ts', import.meta.url))], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, TMPDIR: '/tmp', TSX_TSCONFIG_PATH: fileURLToPath(new URL('./migration.tsconfig.json', import.meta.url)),
        OM_RLS_TEST_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${pgPort}/postgres`,
        OM_LOG_LEVEL: 'error' },
    })
    const passed = result.stdout.split('\n').filter((line) => line.startsWith('PASS '))
    assert.equal(passed.length, 8)
    for (const line of passed) context.diagnostic(line)
    assert.match(result.stdout, /PASS production dbMigrate assertions complete; database fixtures removed/)
  } finally {
    const cleanup = await Promise.allSettled(containers.map((name) => docker('rm', '-f', name)))
    for (let index = 0; index < containers.length; index += 1) {
      const listed = await docker('ps', '-a', '--filter', `name=^/${containers[index]}$`, '--format', '{{.ID}}')
      assert.equal(listed.stdout.trim(), '', `Owned container cleanup failed: ${cleanup[index].status}`)
    }
    context.diagnostic('PASS owned disposable PostgreSQL container removed')
  }
})
