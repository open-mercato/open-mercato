import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findAllApps, findAppRoot, type AppRoot } from '../appResolver'

type NextConfigName = 'next.config.ts' | 'next.config.js' | 'next.config.mjs'

function createApp(rootDir: string, relativeAppDir: string, configName: NextConfigName, withGeneratedDir: boolean = true): AppRoot {
  const appDir = path.join(rootDir, relativeAppDir)
  const mercatoDir = path.join(appDir, '.mercato')
  const generatedDir = path.join(mercatoDir, 'generated')

  fs.mkdirSync(appDir, { recursive: true })
  fs.writeFileSync(path.join(appDir, configName), 'export default {}')

  if (withGeneratedDir) {
    fs.mkdirSync(generatedDir, { recursive: true })
  }

  return { appDir, mercatoDir, generatedDir }
}

describe('appResolver', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-mercato-app-resolver-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('findAppRoot', () => {
    it('finds the nearest app root from a nested directory', () => {
      const app = createApp(tempDir, 'apps/mercato', 'next.config.ts')
      const nestedDir = path.join(app.appDir, 'src', 'modules', 'customers')

      fs.mkdirSync(nestedDir, { recursive: true })

      expect(findAppRoot(nestedDir)).toEqual(app)
    })

    it.each<NextConfigName>(['next.config.ts', 'next.config.js', 'next.config.mjs'])(
      'supports %s app config files',
      (configName) => {
        const app = createApp(tempDir, configName.replace(/\./g, '-'), configName)

        expect(findAppRoot(app.appDir)).toEqual(app)
      },
    )

    it('returns the nearest Next.js app even when generated output is missing', () => {
      const outerApp = createApp(tempDir, 'apps/outer', 'next.config.ts')
      const innerApp = createApp(outerApp.appDir, 'examples/inner', 'next.config.js', false)
      const nestedDir = path.join(innerApp.appDir, 'src')

      fs.mkdirSync(nestedDir, { recursive: true })

      expect(findAppRoot(nestedDir)).toEqual(innerApp)
    })

    it('returns null when no Next.js app can be found', () => {
      const nestedDir = path.join(tempDir, 'packages', 'shared', 'src')

      fs.mkdirSync(nestedDir, { recursive: true })

      expect(findAppRoot(nestedDir)).toBeNull()
    })
  })

  describe('findAllApps', () => {
    it('returns an empty array when the monorepo has no apps directory', () => {
      expect(findAllApps(tempDir)).toEqual([])
    })

    it('returns only Next.js apps with generated output', () => {
      createApp(tempDir, 'apps/mercato', 'next.config.ts')
      createApp(tempDir, 'apps/docs', 'next.config.js')
      createApp(tempDir, 'apps/admin', 'next.config.mjs')
      createApp(tempDir, 'apps/incomplete', 'next.config.ts', false)

      fs.writeFileSync(path.join(tempDir, 'apps', 'README.md'), 'not an app')

      const appNames = findAllApps(tempDir)
        .map((app) => path.basename(app.appDir))
        .sort()

      expect(appNames).toEqual(['admin', 'docs', 'mercato'])
    })
  })
})
