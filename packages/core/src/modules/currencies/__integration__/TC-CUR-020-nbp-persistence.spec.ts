import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from '@playwright/test'

const runFile = promisify(execFile)

test('persists NBP rates and preserves rows through the provenance migration', async ({}, testInfo) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
  const core = path.join(root, 'packages/core')
  await runFile(process.execPath, [
    path.join(root, 'node_modules/jest/bin/jest.js'),
    '--config', path.join(core, 'jest.config.cjs'),
    '--testMatch', '**/__tests__/**/*.test.ts',
    '--passWithNoTests=false',
    '--runInBand',
    '--runTestsByPath', 'src/modules/currencies/services/__tests__/nbpAverage.persistence.integration.test.ts',
  ], {
    cwd: core,
    env: { ...process.env, OM_CURRENCY_PG_INTEGRATION: '1' },
    encoding: 'utf8',
    timeout: testInfo.timeout - 1_000,
  })
})
