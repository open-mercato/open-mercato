import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const token = process.env.RAILWAY_INTEGRATION_TOKEN
const appRoot = process.env.RAILWAY_INTEGRATION_APP_ROOT
const cliBin = resolve(process.cwd(), 'packages/cli/dist/bin.js')

function runCli(args: string[]): string {
  if (!appRoot || !token) throw new Error('Railway integration environment is incomplete.')
  return execFileSync(process.execPath, [cliBin, ...args], {
    cwd: appRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      RAILWAY_API_TOKEN: token,
      CI: 'true',
    },
    timeout: 15 * 60 * 1000,
  })
}

test.describe('mercato deploy railway live integration', () => {
  test.skip(!token || !appRoot, 'RAILWAY_INTEGRATION_TOKEN and RAILWAY_INTEGRATION_APP_ROOT are required')

  test('deploys, verifies health, resumes, and cleans up', async ({ request }) => {
    expect(existsSync(cliBin)).toBe(true)
    const projectName = `mercato-integration-${Date.now()}`

    try {
      const output = runCli([
        'deploy',
        'railway',
        '--project',
        projectName,
        '--source',
        'local',
        '--no-worker',
        '--non-interactive',
      ])
      const outputLines = output.trim().split(/\r?\n/)
      const deployUrl = outputLines
        .find((line) => line.startsWith('DEPLOY_URL='))
        ?.slice('DEPLOY_URL='.length)
      expect(deployUrl).toBeTruthy()
      expect(outputLines.at(-1)).toBe(`DEPLOY_URL=${deployUrl}`)

      const health = await request.get(`${deployUrl}/api/healthz`)
      expect(health.status()).toBe(200)
      expect(await health.json()).toEqual({
        status: 'ok',
        ts: expect.any(String),
      })

      const resumeOutput = runCli([
        'deploy',
        'railway',
        '--source',
        'local',
        '--no-worker',
        '--non-interactive',
      ])
      expect(resumeOutput).toContain(`Project:     https://railway.com/project/`)
    } finally {
      if (appRoot && existsSync(resolve(appRoot, '.mercato', 'railway.json'))) {
        runCli(['deploy', 'railway', '--cleanup', '--non-interactive', '--yes'])
      }
    }
  })
})
