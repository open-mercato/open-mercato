import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GET, metadata, openApi } from '../get/version'

jest.mock('@open-mercato/shared/lib/version', () => ({
  APP_VERSION: '7.7.7-platform',
  appVersion: '7.7.7-platform',
}))

type VersionBody = { version: string; platform: string; app: string | null }

const ENV_KEYS = ['OM_VERSION', 'OPEN_MERCATO_VERSION'] as const

async function loadFreshBody(): Promise<VersionBody> {
  let body: VersionBody | undefined
  await jest.isolateModulesAsync(async () => {
    const mod = await import('../get/version')
    const res = await mod.GET()
    body = (await res.json()) as VersionBody
  })
  if (!body) throw new Error('[internal] version route returned no body')
  return body
}

describe('api_docs /api/version route', () => {
  const originalEnv: Record<string, string | undefined> = {}
  let cwdSpy: jest.SpyInstance<string, []> | null = null
  let tempDir: string | null = null

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
    cwdSpy?.mockRestore()
    cwdSpy = null
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  })

  function useAppShell(packageJson: Record<string, unknown> | null) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-version-'))
    if (packageJson) fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson))
    const dir = tempDir
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(dir)
  }

  it('is served at /api/version without auth', () => {
    expect(metadata.path).toBe('/version')
    expect(metadata.GET.requireAuth).toBe(false)
  })

  it('keeps version a non-empty string', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as VersionBody
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
  })

  it('reports the installed platform version, not the app shell package.json version', async () => {
    useAppShell({ name: 'my-app', version: '0.6.5' })
    const body = await loadFreshBody()
    expect(body).toEqual({ version: '7.7.7-platform', platform: '7.7.7-platform', app: '0.6.5' })
  })

  it('returns a null app version when the app package.json cannot be read', async () => {
    useAppShell(null)
    const body = await loadFreshBody()
    expect(body).toEqual({ version: '7.7.7-platform', platform: '7.7.7-platform', app: null })
  })

  it('returns a null app version when the app package.json has no version', async () => {
    useAppShell({ name: 'my-app' })
    const body = await loadFreshBody()
    expect(body.app).toBeNull()
  })

  it('prefers an explicit OM_VERSION override for version while platform stays the installed version', async () => {
    useAppShell({ version: '0.6.5' })
    process.env.OM_VERSION = '9.9.9-test'
    const body = await loadFreshBody()
    expect(body).toEqual({ version: '9.9.9-test', platform: '7.7.7-platform', app: '0.6.5' })
  })

  it('accepts OPEN_MERCATO_VERSION as the override alias', async () => {
    useAppShell({ version: '0.6.5' })
    process.env.OPEN_MERCATO_VERSION = '8.8.8-alias'
    const body = await loadFreshBody()
    expect(body.version).toBe('8.8.8-alias')
    expect(body.platform).toBe('7.7.7-platform')
  })

  it('documents every response field in the OpenAPI schema', () => {
    const schema = openApi.methods.GET?.responses?.[0]?.schema as { shape?: Record<string, unknown> } | undefined
    expect(Object.keys(schema?.shape ?? {}).sort()).toEqual(['app', 'platform', 'version'])
  })
})
