import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEV_SUPERVISOR_MANIFEST_FILE,
  getRegisteredDevSupervisorManifest,
  loadDevSupervisorManifest,
  registerDevSupervisorManifest,
  resetDevSupervisorManifestForTests,
} from '../dev-supervisor-manifest'

function writeManifest(appDir: string, value: unknown): string {
  const filePath = path.join(appDir, '.mercato', 'generated', DEV_SUPERVISOR_MANIFEST_FILE)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8')
  return filePath
}

describe('dev supervisor manifest', () => {
  let appDir: string

  beforeEach(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-dev-supervisor-'))
    resetDevSupervisorManifestForTests()
  })

  afterEach(() => {
    resetDevSupervisorManifestForTests()
    fs.rmSync(appDir, { recursive: true, force: true })
  })

  it('loads and registers primitive worker and scheduler metadata', () => {
    writeManifest(appDir, {
      version: 1,
      workers: [
        {
          id: 'events:workers:dispatch',
          moduleId: 'events',
          queue: 'events',
          concurrency: 2,
        },
      ],
      schedulerStartStatus: 'ok',
    })

    const manifest = loadDevSupervisorManifest(appDir)
    expect(manifest).toEqual({
      version: 1,
      workers: [
        {
          id: 'events:workers:dispatch',
          moduleId: 'events',
          queue: 'events',
          concurrency: 2,
        },
      ],
      schedulerStartStatus: 'ok',
    })

    registerDevSupervisorManifest(manifest)
    expect(getRegisteredDevSupervisorManifest()).toBe(manifest)
  })

  it('reports a missing generated manifest with regeneration guidance', () => {
    expect(() => loadDevSupervisorManifest(appDir)).toThrow(
      /dev-supervisor\.generated\.json.*Run `yarn generate`/,
    )
  })

  it('rejects malformed JSON', () => {
    const filePath = path.join(appDir, '.mercato', 'generated', DEV_SUPERVISOR_MANIFEST_FILE)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, '{', 'utf8')

    expect(() => loadDevSupervisorManifest(appDir)).toThrow(/JSON could not be parsed/)
  })

  it('rejects unsupported versions and invalid worker fields', () => {
    writeManifest(appDir, {
      version: 2,
      workers: [],
      schedulerStartStatus: 'missing-module',
    })
    expect(() => loadDevSupervisorManifest(appDir)).toThrow(/unsupported version 2/)

    writeManifest(appDir, {
      version: 1,
      workers: [{ id: 'worker', queue: '', concurrency: 1 }],
      schedulerStartStatus: 'missing-module',
    })
    expect(() => loadDevSupervisorManifest(appDir)).toThrow(/workers\[0\]\.queue/)
  })

  it('rejects unknown scheduler command states', () => {
    writeManifest(appDir, {
      version: 1,
      workers: [],
      schedulerStartStatus: 'maybe',
    })
    expect(() => loadDevSupervisorManifest(appDir)).toThrow(/schedulerStartStatus is invalid/)
  })
})
