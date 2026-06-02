/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { hasFeature } from '@open-mercato/shared/security/features'
import * as fs from 'fs'
import * as path from 'path'

describe('feature_toggles ACL and route metadata', () => {
  describe('ACL feature declarations', () => {
    test('exports the expected features', async () => {
      const { features } = await import('../acl')
      const featureIds = features.map((f: { id: string }) => f.id)

      expect(featureIds).toContain('feature_toggles.view')
      expect(featureIds).toContain('feature_toggles.manage')
      expect(featureIds).toContain('feature_toggles.global.manage')
      expect(featureIds).toHaveLength(3)
    })

    test('all features reference the correct module', async () => {
      const { features } = await import('../acl')
      for (const feature of features) {
        expect(feature.module).toBe('feature_toggles')
      }
    })
  })

  describe('global feature toggle authorization (issue #2266)', () => {
    test('admin can view and manage per-tenant overrides', async () => {
      const { setup } = await import('../setup')
      const adminFeatures = (setup.defaultRoleFeatures?.admin ?? []) as string[]

      expect(hasFeature(adminFeatures, 'feature_toggles.view')).toBe(true)
      expect(hasFeature(adminFeatures, 'feature_toggles.manage')).toBe(true)
    })

    test('admin is NOT granted system-wide global toggle management', async () => {
      const { setup } = await import('../setup')
      const adminFeatures = (setup.defaultRoleFeatures?.admin ?? []) as string[]

      // The `feature_toggles.*` wildcard must not be used, since FeatureToggle is a
      // global (non-tenant-scoped) table; otherwise tenant admins could mutate
      // platform-wide flags every other tenant depends on.
      expect(adminFeatures).not.toContain('feature_toggles.*')
      expect(hasFeature(adminFeatures, 'feature_toggles.global.manage')).toBe(false)
    })

    test('superadmin is granted system-wide global toggle management', async () => {
      const { setup } = await import('../setup')
      const superadminFeatures = (setup.defaultRoleFeatures?.superadmin ?? []) as string[]

      expect(hasFeature(superadminFeatures, 'feature_toggles.global.manage')).toBe(true)
    })

    test('global write routes require the global-manage feature, not the tenant manage feature', () => {
      const routeFile = path.resolve(__dirname, '..', 'api', 'global', 'route.ts')
      const content = fs.readFileSync(routeFile, 'utf-8')

      const writeMethods = content.match(/(POST|PUT|DELETE):\s*\{[^}]*requireFeatures:\s*\[[^\]]*\]/g) ?? []
      expect(writeMethods.length).toBe(3)
      for (const method of writeMethods) {
        expect(method).toContain("feature_toggles.global.manage")
      }
    })

    test('global toggle commands enforce a super-admin guard (defense in depth)', () => {
      const commandsFile = path.resolve(__dirname, '..', 'commands', 'global.ts')
      const content = fs.readFileSync(commandsFile, 'utf-8')

      // Each write command execute() must call the super-admin assertion.
      const guardCalls = content.match(/assertGlobalToggleSuperAdmin\(ctx\)/g) ?? []
      expect(guardCalls.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('No route or page uses requireRoles (source-level check)', () => {
    const moduleRoot = path.resolve(__dirname, '..')

    function findTsFiles(dir: string, pattern: RegExp): string[] {
      const results: string[] = []
      if (!fs.existsSync(dir)) return results
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') {
          results.push(...findTsFiles(full, pattern))
        } else if (entry.isFile() && pattern.test(entry.name)) {
          results.push(full)
        }
      }
      return results
    }

    test('no API route file contains requireRoles', () => {
      const apiDir = path.join(moduleRoot, 'api')
      const routeFiles = findTsFiles(apiDir, /route\.ts$/)
      expect(routeFiles.length).toBeGreaterThan(0)

      for (const file of routeFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(content).not.toMatch(/requireRoles/)
      }
    })

    test('no page.meta.ts file contains requireRoles', () => {
      const backendDir = path.join(moduleRoot, 'backend')
      const metaFiles = findTsFiles(backendDir, /page\.meta\.ts$/)
      expect(metaFiles.length).toBeGreaterThan(0)

      for (const file of metaFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(content).not.toMatch(/requireRoles/)
      }
    })

    test('all management API route files use requireFeatures', () => {
      const globalDir = path.join(moduleRoot, 'api', 'global')
      const overridesDir = path.join(moduleRoot, 'api', 'overrides')
      const managementRoutes = [
        ...findTsFiles(globalDir, /route\.ts$/),
        ...findTsFiles(overridesDir, /route\.ts$/),
      ]
      expect(managementRoutes.length).toBeGreaterThanOrEqual(4)

      for (const file of managementRoutes) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(content).toMatch(/requireFeatures/)
      }
    })

    test('all page.meta.ts files use requireFeatures', () => {
      const backendDir = path.join(moduleRoot, 'backend')
      const metaFiles = findTsFiles(backendDir, /page\.meta\.ts$/)

      for (const file of metaFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        expect(content).toMatch(/requireFeatures/)
      }
    })
  })
})
