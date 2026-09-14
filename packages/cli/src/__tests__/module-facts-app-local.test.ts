import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createResolver } from '../lib/resolver'
import { generateAppLocalModuleFacts } from '../lib/generators/module-facts-app-local'

describe('generateAppLocalModuleFacts', () => {
  let appDir: string

  beforeEach(() => {
    appDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-app-facts-')))
  })

  afterEach(() => {
    fs.rmSync(appDir, { recursive: true, force: true })
  })

  const stageModule = (id: string) => {
    const moduleRoot = path.join(appDir, 'src', 'modules', id)
    fs.mkdirSync(moduleRoot, { recursive: true })
    fs.writeFileSync(path.join(moduleRoot, 'index.ts'), 'export const metadata = { requires: [] }\n')
  }

  it('is a no-op in an app without the agent harness', async () => {
    stageModule('bookings')
    const result = await generateAppLocalModuleFacts({ resolver: createResolver(appDir), quiet: true })
    expect(result.filesWritten).toEqual([])
    expect(fs.existsSync(path.join(appDir, '.ai'))).toBe(false)
  })

  it('projects app modules into .ai/guides/app-modules, stays byte-stable, and prunes removed modules', async () => {
    stageModule('bookings')
    fs.mkdirSync(path.join(appDir, '.ai', 'guides'), { recursive: true })

    const first = await generateAppLocalModuleFacts({ resolver: createResolver(appDir), quiet: true })
    const sheet = path.join(appDir, '.ai', 'guides', 'app-modules', 'bookings', 'index.md')
    expect(fs.existsSync(sheet)).toBe(true)
    expect(first.filesWritten.length).toBeGreaterThan(0)

    const second = await generateAppLocalModuleFacts({ resolver: createResolver(appDir), quiet: true })
    expect(second.filesWritten).toEqual([])

    fs.rmSync(path.join(appDir, 'src', 'modules', 'bookings'), { recursive: true, force: true })
    const third = await generateAppLocalModuleFacts({ resolver: createResolver(appDir), quiet: true })
    expect(third.filesWritten.length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(appDir, '.ai', 'guides', 'app-modules'))).toBe(false)
  })
})
