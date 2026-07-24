import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

/**
 * TC-PLAT-002: mercato inspect CLI
 * Source: .ai/specs/2026-06-17-platform-map-introspection.md
 */
test.describe('TC-PLAT-002: mercato inspect CLI', () => {
  test('mercato inspect --json returns a PlatformMap with module surface', async () => {
    const repoRoot = path.resolve(__dirname, '../../../../..')
    const cliEntry = path.join(repoRoot, 'packages/cli/src/bin.ts')

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', cliEntry, 'inspect', '--json', '--surface', 'module', '--tier', '1'],
      {
        cwd: path.join(repoRoot, 'apps/mercato'),
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
    )

    const payload = JSON.parse(stdout) as {
      schemaVersion?: number
      surfaces?: Record<string, { rows?: Array<{ id?: string }> }>
    }

    expect(payload.schemaVersion).toBe(1)
    expect(payload.surfaces?.module?.rows?.length).toBeGreaterThan(0)
  })
})
