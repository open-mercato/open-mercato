import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { loadAppEnv } from '../load-env'

/**
 * Regression: bin.ts must load the app's `.env` before initTelemetry(), so
 * TELEMETRY_BACKEND set only in `.env` reaches worker and scheduler processes
 * (ensureEnvLoaded in run() happens after init — too late).
 */

describe('loadAppEnv', () => {
  const TEST_KEY = 'OM_LOAD_ENV_TEST_BACKEND'
  let tmpDir: string
  let cwd: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-'))
    cwd = process.cwd()
    process.chdir(tmpDir)
    delete process.env[TEST_KEY]
  })

  afterEach(() => {
    process.chdir(cwd)
    delete process.env[TEST_KEY]
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads .env from the app directory into process.env', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"env-test-app"}\n')
    fs.mkdirSync(path.join(tmpDir, 'src'))
    fs.writeFileSync(path.join(tmpDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=console\n`)

    await loadAppEnv()

    expect(process.env[TEST_KEY]).toBe('console')
  })

  it('does not override values already set in the real process env', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"env-test-app"}\n')
    fs.writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=from-dotenv\n`)
    process.env[TEST_KEY] = 'from-shell'

    await loadAppEnv()

    expect(process.env[TEST_KEY]).toBe('from-shell')
  })

  it('is a safe no-op when no .env exists', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"env-test-app"}\n')
    await expect(loadAppEnv()).resolves.toBeUndefined()
    expect(process.env[TEST_KEY]).toBeUndefined()
  })

  it('bin.ts awaits loadAppEnv() before initTelemetry() (the guarded ordering)', () => {
    const binSource = fs.readFileSync(path.resolve(__dirname, '../../bin.ts'), 'utf8')
    const loadEnvCall = binSource.indexOf('await loadAppEnv()')
    const initTelemetryCall = binSource.indexOf('await initTelemetry()')
    expect(loadEnvCall).toBeGreaterThan(-1)
    expect(initTelemetryCall).toBeGreaterThan(-1)
    expect(loadEnvCall).toBeLessThan(initTelemetryCall)
  })
})
