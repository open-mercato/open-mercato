import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { scanModuleDir, resolveModuleFile, SCAN_CONFIGS, type ModuleRoots, type ModuleImports } from '../scanner'

let tmpDir: string
let roots: ModuleRoots
let imps: ModuleImports

function touch(relativePath: string, base: 'app' | 'pkg' = 'pkg') {
  const dir = base === 'app' ? roots.appBase : roots.pkgBase
  const fullPath = path.join(dir, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, '')
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'))
  roots = {
    appBase: path.join(tmpDir, 'app', 'src', 'modules', 'test_mod'),
    pkgBase: path.join(tmpDir, 'pkg', 'src', 'modules', 'test_mod'),
  }
  imps = {
    appBase: '@app/modules/test_mod',
    pkgBase: '@open-mercato/core/modules/test_mod',
  }
  fs.mkdirSync(roots.appBase, { recursive: true })
  fs.mkdirSync(roots.pkgBase, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('scanModuleDir', () => {
  describe('frontend pages — app overrides package', () => {
    it('returns app file when same page exists in both app and package', () => {
      touch('frontend/page.tsx', 'pkg')
      touch('frontend/page.tsx', 'app')
      touch('frontend/settings/page.tsx', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.frontendPages)

      expect(files).toHaveLength(2)
      const rootPage = files.find((f) => f.relPath === 'page.tsx')
      expect(rootPage).toBeDefined()
      expect(rootPage!.fromApp).toBe(true)
      const settingsPage = files.find((f) => f.relPath === 'settings/page.tsx')
      expect(settingsPage).toBeDefined()
      expect(settingsPage!.fromApp).toBe(false)
    })

    it('sorts static routes before dynamic routes', () => {
      touch('frontend/create/page.tsx', 'pkg')
      touch('frontend/[id]/page.tsx', 'pkg')
      touch('frontend/page.tsx', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.frontendPages)
      const paths = files.map((f) => f.relPath)

      const createIdx = paths.indexOf('create/page.tsx')
      const dynamicIdx = paths.indexOf('[id]/page.tsx')
      expect(createIdx).toBeLessThan(dynamicIdx)
    })
  })

  describe('backend pages — app overrides package', () => {
    it('returns app file when same page exists in both app and package', () => {
      touch('backend/page.tsx', 'pkg')
      touch('backend/page.tsx', 'app')

      const files = scanModuleDir(roots, SCAN_CONFIGS.backendPages)

      expect(files).toHaveLength(1)
      expect(files[0].fromApp).toBe(true)
    })
  })

  describe('subscribers — app overrides package', () => {
    it('returns app file when same subscriber exists in both', () => {
      touch('subscribers/on-created.ts', 'pkg')
      touch('subscribers/on-created.ts', 'app')
      touch('subscribers/on-deleted.ts', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.subscribers)

      expect(files).toHaveLength(2)
      const onCreated = files.find((f) => f.relPath === 'on-created.ts')
      expect(onCreated!.fromApp).toBe(true)
      const onDeleted = files.find((f) => f.relPath === 'on-deleted.ts')
      expect(onDeleted!.fromApp).toBe(false)
    })

    it('skips test and spec files', () => {
      touch('subscribers/handler.ts', 'pkg')
      touch('subscribers/handler.test.ts', 'pkg')
      touch('subscribers/handler.spec.ts', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.subscribers)

      expect(files).toHaveLength(1)
      expect(files[0].relPath).toBe('handler.ts')
    })

    it('skips __tests__ and __mocks__ directories', () => {
      touch('subscribers/handler.ts', 'pkg')
      touch('subscribers/__tests__/handler.test.ts', 'pkg')
      touch('subscribers/__mocks__/handler.ts', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.subscribers)

      expect(files).toHaveLength(1)
    })
  })

  describe('workers — app overrides package', () => {
    it('returns app file when same worker exists in both', () => {
      touch('workers/send-email.ts', 'pkg')
      touch('workers/send-email.ts', 'app')
      touch('workers/sync-data.ts', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.workers)

      expect(files).toHaveLength(2)
      const sendEmail = files.find((f) => f.relPath === 'send-email.ts')
      expect(sendEmail!.fromApp).toBe(true)
      const syncData = files.find((f) => f.relPath === 'sync-data.ts')
      expect(syncData!.fromApp).toBe(false)
    })
  })

  describe('dashboard widgets — app overrides package', () => {
    it('returns app file when same widget exists in both', () => {
      touch('widgets/dashboard/sales/widget.tsx', 'pkg')
      touch('widgets/dashboard/sales/widget.tsx', 'app')
      touch('widgets/dashboard/stats/widget.ts', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.dashboardWidgets)

      expect(files).toHaveLength(2)
      const sales = files.find((f) => f.relPath === 'sales/widget.tsx')
      expect(sales!.fromApp).toBe(true)
      const stats = files.find((f) => f.relPath === 'stats/widget.ts')
      expect(stats!.fromApp).toBe(false)
    })

    it('sorts results alphabetically', () => {
      touch('widgets/dashboard/zebra/widget.tsx', 'pkg')
      touch('widgets/dashboard/alpha/widget.tsx', 'pkg')
      touch('widgets/dashboard/middle/widget.tsx', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.dashboardWidgets)
      const paths = files.map((f) => f.relPath)

      expect(paths).toEqual([
        'alpha/widget.tsx',
        'middle/widget.tsx',
        'zebra/widget.tsx',
      ])
    })

    it('matches widget.ts, widget.tsx, widget.jsx, widget.js', () => {
      touch('widgets/dashboard/a/widget.ts', 'pkg')
      touch('widgets/dashboard/b/widget.tsx', 'pkg')
      touch('widgets/dashboard/c/widget.jsx', 'pkg')
      touch('widgets/dashboard/d/widget.js', 'pkg')
      touch('widgets/dashboard/e/not-a-widget.ts', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.dashboardWidgets)

      expect(files).toHaveLength(4)
    })
  })

  describe('injection widgets — app overrides package', () => {
    it('returns app file when same widget exists in both', () => {
      touch('widgets/injection/sidebar/widget.tsx', 'pkg')
      touch('widgets/injection/sidebar/widget.tsx', 'app')

      const files = scanModuleDir(roots, SCAN_CONFIGS.injectionWidgets)

      expect(files).toHaveLength(1)
      expect(files[0].fromApp).toBe(true)
    })

    it('sorts results alphabetically', () => {
      touch('widgets/injection/z-panel/widget.tsx', 'pkg')
      touch('widgets/injection/a-panel/widget.tsx', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.injectionWidgets)
      const paths = files.map((f) => f.relPath)

      expect(paths).toEqual([
        'a-panel/widget.tsx',
        'z-panel/widget.tsx',
      ])
    })
  })

  describe('API routes', () => {
    it('finds route.ts files and sorts static before dynamic', () => {
      touch('api/route.ts', 'pkg')
      touch('api/[id]/route.ts', 'pkg')
      touch('api/list/route.ts', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.apiRoutes)
      const paths = files.map((f) => f.relPath)

      expect(paths.indexOf('list/route.ts')).toBeLessThan(paths.indexOf('[id]/route.ts'))
    })

    it('plain files skip method dirs and route.ts', () => {
      touch('api/helpers.ts', 'pkg')
      touch('api/route.ts', 'pkg')
      touch('api/get/list.ts', 'pkg')
      touch('api/post/create.ts', 'pkg')
      touch('api/nested/util.ts', 'pkg')

      const files = scanModuleDir(roots, SCAN_CONFIGS.apiPlainFiles)
      const paths = files.map((f) => f.relPath)

      expect(paths).toContain('helpers.ts')
      expect(paths).toContain('nested/util.ts')
      expect(paths).not.toContain('route.ts')
      expect(paths).not.toContain('get/list.ts')
      expect(paths).not.toContain('post/create.ts')
    })
  })

  describe('edge cases', () => {
    it('returns empty when neither app nor pkg dir exists', () => {
      const emptyRoots: ModuleRoots = {
        appBase: path.join(tmpDir, 'nonexistent', 'app'),
        pkgBase: path.join(tmpDir, 'nonexistent', 'pkg'),
      }
      const files = scanModuleDir(emptyRoots, SCAN_CONFIGS.subscribers)
      expect(files).toEqual([])
    })

    it('deduplicates files found in both app and package', () => {
      touch('subscribers/handler.ts', 'pkg')
      touch('subscribers/handler.ts', 'app')

      const files = scanModuleDir(roots, SCAN_CONFIGS.subscribers)

      expect(files).toHaveLength(1)
      expect(files[0].relPath).toBe('handler.ts')
      expect(files[0].fromApp).toBe(true)
    })

    it('handles nested directory structures', () => {
      touch('subscribers/domain/orders/on-placed.ts', 'pkg')
      touch('subscribers/domain/orders/on-cancelled.ts', 'app')

      const files = scanModuleDir(roots, SCAN_CONFIGS.subscribers)

      expect(files).toHaveLength(2)
    })
  })
})

describe('resolveModuleFile', () => {
  it('resolves package file when only package has it', () => {
    touch('search.ts', 'pkg')

    const result = resolveModuleFile(roots, imps, 'search.ts')

    expect(result).not.toBeNull()
    expect(result!.fromApp).toBe(false)
    expect(result!.importPath).toBe('@open-mercato/core/modules/test_mod/search')
  })

  it('resolves app file when both app and package have it', () => {
    touch('search.ts', 'pkg')
    touch('search.ts', 'app')

    const result = resolveModuleFile(roots, imps, 'search.ts')

    expect(result).not.toBeNull()
    expect(result!.fromApp).toBe(true)
    expect(result!.importPath).toBe('@app/modules/test_mod/search')
  })

  it('returns null when file does not exist anywhere', () => {
    const result = resolveModuleFile(roots, imps, 'nonexistent.ts')
    expect(result).toBeNull()
  })

  it('resolves nested paths like data/extensions.ts', () => {
    touch('data/extensions.ts', 'pkg')

    const result = resolveModuleFile(roots, imps, 'data/extensions.ts')

    expect(result).not.toBeNull()
    expect(result!.importPath).toBe('@open-mercato/core/modules/test_mod/data/extensions')
  })

  it('resolves widgets/injection-table.ts', () => {
    touch('widgets/injection-table.ts', 'app')

    const result = resolveModuleFile(roots, imps, 'widgets/injection-table.ts')

    expect(result).not.toBeNull()
    expect(result!.fromApp).toBe(true)
    expect(result!.importPath).toBe('@app/modules/test_mod/widgets/injection-table')
  })

  it('app override takes precedence for all convention files', () => {
    const conventionFiles = [
      'acl.ts', 'ce.ts', 'search.ts', 'notifications.ts',
      'ai-tools.ts', 'events.ts', 'analytics.ts', 'setup.ts',
      'data/extensions.ts', 'data/fields.ts',
    ]
    for (const file of conventionFiles) {
      touch(file, 'pkg')
      touch(file, 'app')
    }

    for (const file of conventionFiles) {
      const result = resolveModuleFile(roots, imps, file)
      expect(result).not.toBeNull()
      expect(result!.fromApp).toBe(true)
    }
  })
})
