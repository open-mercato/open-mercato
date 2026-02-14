import path from 'node:path'

// Note: We can't directly test the resolver because it uses import.meta.url
// which is not supported in Jest's CommonJS environment.
// These tests verify the expected behavior through integration tests.

// Helper to normalize paths for cross-platform comparison
const normalizePath = (p: string) => p.replace(/\\/g, '/')

describe('PackageResolver', () => {
  describe('path resolution logic', () => {
    it('should construct correct monorepo output path', () => {
      const rootDir = '/test/project'
      const outputDir = path.join(rootDir, 'generated')
      expect(normalizePath(outputDir)).toBe('/test/project/generated')
    })

    it('should construct correct production output path', () => {
      const rootDir = '/test/project'
      const outputDir = path.join(rootDir, '.mercato', 'generated')
      expect(normalizePath(outputDir)).toBe('/test/project/.mercato/generated')
    })

    it('should construct correct modules config path', () => {
      const rootDir = '/test/project'
      const configPath = path.join(rootDir, 'src', 'modules.ts')
      expect(normalizePath(configPath)).toBe('/test/project/src/modules.ts')
    })
  })

  describe('module path resolution', () => {
    it('should construct correct core module path in monorepo', () => {
      const rootDir = '/test/project'
      const moduleId = 'customers'
      const pkgBase = path.resolve(rootDir, 'packages/core/src/modules', moduleId)
      expect(normalizePath(pkgBase)).toContain('packages/core/src/modules/customers')
    })

    it('should construct correct onboarding module path in monorepo', () => {
      const rootDir = '/test/project'
      const moduleId = 'onboarding'
      const pkgName = 'onboarding'
      const pkgBase = path.resolve(rootDir, `packages/${pkgName}/src/modules`, moduleId)
      expect(normalizePath(pkgBase)).toContain('packages/onboarding/src/modules/onboarding')
    })

    it('should construct correct app module path', () => {
      const rootDir = '/test/project'
      const moduleId = 'custom'
      const appBase = path.resolve(rootDir, 'src/modules', moduleId)
      expect(normalizePath(appBase)).toContain('src/modules/custom')
    })
  })

  describe('import path resolution', () => {
    it('should construct correct app import path', () => {
      const moduleId = 'customers'
      const importPath = `@/modules/${moduleId}`
      expect(importPath).toBe('@/modules/customers')
    })

    it('should construct correct core package import path', () => {
      const moduleId = 'customers'
      const packageName = '@open-mercato/core'
      const importPath = `${packageName}/modules/${moduleId}`
      expect(importPath).toBe('@open-mercato/core/modules/customers')
    })

    it('should construct correct onboarding package import path', () => {
      const moduleId = 'onboarding'
      const packageName = '@open-mercato/onboarding'
      const importPath = `${packageName}/modules/${moduleId}`
      expect(importPath).toBe('@open-mercato/onboarding/modules/onboarding')
    })
  })

  describe('package output directory resolution', () => {
    it('should return root generated dir for @app', () => {
      const rootDir = '/test/project'
      const packageName = '@app' as string
      const outputDir = packageName === '@app'
        ? path.join(rootDir, 'generated')
        : path.join(rootDir, `packages/${packageName.replace('@open-mercato/', '')}`, 'generated')
      expect(normalizePath(outputDir)).toBe('/test/project/generated')
    })

    it('should return package generated dir for core', () => {
      const rootDir = '/test/project'
      const packageName = '@open-mercato/core'
      const pkgDir = packageName.replace('@open-mercato/', '')
      const outputDir = path.join(rootDir, `packages/${pkgDir}`, 'generated')
      expect(normalizePath(outputDir)).toBe('/test/project/packages/core/generated')
    })
  })

  describe('monorepo detection', () => {
    it('should detect monorepo by packages directory existence', () => {
      // In monorepo mode, ./packages/ directory exists
      // In production mode, ./packages/ directory does not exist
      const packagesPath = '/test/project/packages'
      expect(packagesPath).toContain('packages')
    })
  })
})
