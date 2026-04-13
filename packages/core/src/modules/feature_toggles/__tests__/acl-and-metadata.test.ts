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
      expect(featureIds).toHaveLength(2)
    })

    test('all features reference the correct module', async () => {
      const { features } = await import('../acl')
      for (const feature of features) {
        expect(feature.module).toBe('feature_toggles')
      }
    })
  })

  describe('setup.ts defaultRoleFeatures wildcard covers declared features', () => {
    test('admin wildcard grant covers all declared features', async () => {
      const { setup } = await import('../setup')
      const { features } = await import('../acl')

      const adminFeatures = setup.defaultRoleFeatures?.admin ?? []
      expect(adminFeatures).toContain('feature_toggles.*')

      for (const feature of features) {
        expect(hasFeature(adminFeatures as string[], feature.id)).toBe(true)
      }
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
