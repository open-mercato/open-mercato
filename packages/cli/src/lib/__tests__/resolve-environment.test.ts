import os from 'node:os'
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { resolveEnvironment } from '../resolver'

const normalizePath = (p: string) => p.replace(/\\/g, '/')

async function makeDir(root: string, ...segments: string[]): Promise<string> {
  const dir = path.join(root, ...segments)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('resolveEnvironment', () => {
  let tempRoot = ''

  beforeEach(async () => {
    // realpathSync resolves macOS /var -> /private/var symlink so comparisons are stable
    tempRoot = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'om-resolve-env-')))
  })

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  describe('standalone — local node_modules', () => {
    it('returns standalone mode with rootDir = cwd when @open-mercato/core is a real directory at cwd', async () => {
      await makeDir(tempRoot, 'node_modules', '@open-mercato', 'core')

      const env = resolveEnvironment(tempRoot)

      expect(env.mode).toBe('standalone')
      expect(normalizePath(env.rootDir)).toBe(normalizePath(tempRoot))
      expect(normalizePath(env.appDir)).toBe(normalizePath(tempRoot))
    })

    it('resolves packageRoot under node_modules in standalone mode', async () => {
      await makeDir(tempRoot, 'node_modules', '@open-mercato', 'core')

      const env = resolveEnvironment(tempRoot)

      expect(normalizePath(env.packageRoot('@open-mercato/core'))).toBe(
        normalizePath(path.join(tempRoot, 'node_modules', '@open-mercato', 'core')),
      )
    })

    // In local mode (cwd === nodeModulesRoot), appDir === cwd.
    // apps/ subdirectory detection only fires in the hoisted case — see hoisted tests below.
    it('sets appDir to cwd even when apps/mercato subdirectory exists', async () => {
      await makeDir(tempRoot, 'node_modules', '@open-mercato', 'core')
      await makeDir(tempRoot, 'apps', 'mercato')

      const env = resolveEnvironment(tempRoot)

      expect(env.mode).toBe('standalone')
      expect(normalizePath(env.appDir)).toBe(normalizePath(tempRoot))
    })
  })

  describe('standalone — hoisted node_modules', () => {
    it('returns standalone mode with rootDir set to parent when @open-mercato/core is hoisted', async () => {
      // Structure: tempRoot/node_modules/@open-mercato/core (real dir)
      //            tempRoot/myapp/ (the cwd)
      await makeDir(tempRoot, 'node_modules', '@open-mercato', 'core')
      const childDir = await makeDir(tempRoot, 'myapp')

      const env = resolveEnvironment(childDir)

      expect(env.mode).toBe('standalone')
      expect(normalizePath(env.rootDir)).toBe(normalizePath(tempRoot))
      // appDir falls back to childDir since no apps/ found at rootDir
      expect(normalizePath(env.appDir)).toBe(normalizePath(childDir))
    })

    it('detects apps/mercato as appDir when hoisted and apps/mercato exists at rootDir', async () => {
      // Structure: tempRoot/node_modules/@open-mercato/core (real dir)
      //            tempRoot/apps/mercato/ (app directory)
      //            tempRoot/myapp/ (the cwd — simulates running CLI from a sub-directory)
      await makeDir(tempRoot, 'node_modules', '@open-mercato', 'core')
      await makeDir(tempRoot, 'apps', 'mercato')
      const childDir = await makeDir(tempRoot, 'myapp')

      const env = resolveEnvironment(childDir)

      expect(env.mode).toBe('standalone')
      expect(normalizePath(env.rootDir)).toBe(normalizePath(tempRoot))
      expect(normalizePath(env.appDir)).toBe(normalizePath(path.join(tempRoot, 'apps', 'mercato')))
    })

    it('resolves packageRoot under hoisted node_modules', async () => {
      await makeDir(tempRoot, 'node_modules', '@open-mercato', 'core')
      const childDir = await makeDir(tempRoot, 'myapp')

      const env = resolveEnvironment(childDir)

      expect(normalizePath(env.packageRoot('@open-mercato/core'))).toBe(
        normalizePath(path.join(tempRoot, 'node_modules', '@open-mercato', 'core')),
      )
    })
  })

  describe('monorepo — symlinked node_modules', () => {
    it('returns monorepo mode when @open-mercato/core is a symlink', async () => {
      // Structure: tempRoot/packages/core (real source)
      //            tempRoot/node_modules/@open-mercato/core -> ../../packages/core (symlink)
      const packagesCore = await makeDir(tempRoot, 'packages', 'core')
      const nmOpen = await makeDir(tempRoot, 'node_modules', '@open-mercato')
      await symlink(packagesCore, path.join(nmOpen, 'core'))

      const env = resolveEnvironment(tempRoot)

      expect(env.mode).toBe('monorepo')
      expect(normalizePath(env.rootDir)).toBe(normalizePath(tempRoot))
    })

    it('resolves packageRoot under packages/ in monorepo mode', async () => {
      const packagesCore = await makeDir(tempRoot, 'packages', 'core')
      const nmOpen = await makeDir(tempRoot, 'node_modules', '@open-mercato')
      await symlink(packagesCore, path.join(nmOpen, 'core'))

      const env = resolveEnvironment(tempRoot)

      expect(normalizePath(env.packageRoot('@open-mercato/core'))).toBe(
        normalizePath(path.join(tempRoot, 'packages', 'core')),
      )
    })
  })

  describe('no @open-mercato packages present', () => {
    it('falls back to standalone mode with rootDir = cwd', async () => {
      const env = resolveEnvironment(tempRoot)

      expect(env.mode).toBe('standalone')
      expect(normalizePath(env.rootDir)).toBe(normalizePath(tempRoot))
      expect(normalizePath(env.appDir)).toBe(normalizePath(tempRoot))
    })
  })
})
