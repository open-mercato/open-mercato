#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadEnabledModules, moduleFsRoots, moduleImportBase } from './shared/modules-config'

type HttpMethod = 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'

const outFile = path.resolve('generated/modules.generated.ts')
const checksumFile = path.resolve('generated/modules.generated.checksum')
const widgetsOutFile = path.resolve('generated/dashboard-widgets.generated.ts')
const widgetsChecksumFile = path.resolve('generated/dashboard-widgets.generated.checksum')
const injectionWidgetsOutFile = path.resolve('generated/injection-widgets.generated.ts')
const injectionWidgetsChecksumFile = path.resolve('generated/injection-widgets.generated.checksum')
const vectorOutFile = path.resolve('generated/vector.generated.ts')
const vectorChecksumFile = path.resolve('generated/vector.generated.checksum')

type ChecksumRecord = { content: string; structure: string }

function calculateChecksum(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}

function readChecksum(filePath: string): ChecksumRecord | null {
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ChecksumRecord>
    if (parsed && typeof parsed.content === 'string' && typeof parsed.structure === 'string') {
      return { content: parsed.content, structure: parsed.structure }
    } else {
      console.warn(`[generate-module-registry] Warning: Checksum file "${filePath}" exists but has invalid structure. This may indicate corruption or a version mismatch.`)
    }
  } catch (err) {
    console.warn(`[generate-module-registry] Warning: Failed to parse checksum file "${filePath}": ${(err as Error).message}`)
  }
  return null
}

function writeChecksum(filePath: string, record: ChecksumRecord) {
  fs.writeFileSync(filePath, JSON.stringify(record) + '\n')
}

function collectStructureEntries(target: string, base: string, acc: string[]) {
  const entries = fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const fullPath = path.join(target, entry.name)
    const rel = path.relative(base, fullPath)
    const stat = fs.statSync(fullPath)
    if (entry.isDirectory()) {
      acc.push(`dir:${rel}:${stat.mtimeMs}`)
      collectStructureEntries(fullPath, base, acc)
    } else if (entry.isFile()) {
      acc.push(`file:${rel}:${stat.size}:${stat.mtimeMs}`)
    } else {
      acc.push(`other:${rel}:${stat.mtimeMs}`)
    }
  }
}

function calculateStructureChecksum(paths: string[]): string {
  const normalized = Array.from(new Set(paths.map((p) => path.resolve(p)))).sort()
  const entries: string[] = []
  for (const target of normalized) {
    if (!fs.existsSync(target)) {
      entries.push(`missing:${target}`)
      continue
    }
    const stat = fs.statSync(target)
    entries.push(`${stat.isDirectory() ? 'dir' : 'file'}:${target}:${stat.mtimeMs}`)
    if (stat.isDirectory()) collectStructureEntries(target, target, entries)
  }
  return calculateChecksum(entries.join('\n'))
}

function logGenerationResult(label: string, changed: boolean) {
  if (changed) {
    console.log(`✅ Generated ${label}`)
  }
}

function toVar(s: string) { return s.replace(/[^a-zA-Z0-9_]/g, '_') }

function moduleHasExport(filePath: string, exportName: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath)
    return mod != null && Object.prototype.hasOwnProperty.call(mod, exportName)
  } catch {
    return false
  }
}

function scan() {
  const enabled = loadEnabledModules()
  const imports: string[] = []
  const moduleDecls: string[] = []
  let importId = 0
  const trackedRoots = new Set<string>()
  const requiresByModule = new Map<string, string[]>()
  const allDashboardWidgets = new Map<string, { moduleId: string; source: 'app' | 'package'; importPath: string }>()
  const allInjectionWidgets = new Map<string, { moduleId: string; source: 'app' | 'package'; importPath: string }>()
  const vectorConfigs: string[] = []
  const vectorImports: string[] = []

  for (const entry of enabled) {
    const modId = entry.id
    const roots = moduleFsRoots(entry)
    const imps = moduleImportBase(entry)
    trackedRoots.add(roots.appBase)
    trackedRoots.add(roots.pkgBase)

    const frontendRoutes: string[] = []
    const backendRoutes: string[] = []
    const apis: string[] = []
    let cliImportName: string | null = null
    const translations: string[] = []
    const subscribers: string[] = []
    let infoImportName: string | null = null
    let extensionsImportName: string | null = null
    let fieldsImportName: string | null = null
    let featuresImportName: string | null = null
    let customEntitiesImportName: string | null = null
    let vectorImportName: string | null = null
    let customFieldSetsExpr: string = '[]'
    const dashboardWidgets: string[] = []
    const injectionWidgets: string[] = []
    let injectionTableImportName: string | null = null

    // Module metadata: index.ts (overrideable)
    const appIndex = path.join(roots.appBase, 'index.ts')
    const pkgIndex = path.join(roots.pkgBase, 'index.ts')
    const indexTs = fs.existsSync(appIndex) ? appIndex : (fs.existsSync(pkgIndex) ? pkgIndex : null)
    if (indexTs) {
      infoImportName = `I${importId++}_${toVar(modId)}`
      const importPath = indexTs.startsWith(roots.appBase) ? `${imps.appBase}/index` : `${imps.pkgBase}/index`
      imports.push(`import * as ${infoImportName} from '${importPath}'`)
      // Try to eagerly read ModuleInfo.requires for dependency validation
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(indexTs)
        const reqs: string[] | undefined = (mod?.metadata && Array.isArray(mod.metadata.requires)) ? mod.metadata.requires : undefined
        if (reqs && reqs.length) requiresByModule.set(modId, reqs)
      } catch {}
    }

    // Pages: frontend
    const feApp = path.join(roots.appBase, 'frontend')
    const fePkg = path.join(roots.pkgBase, 'frontend')
    if (fs.existsSync(feApp) || fs.existsSync(fePkg)) {
      const found: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) {
            if (e.name === '__tests__' || e.name === '__mocks__') continue
            walk(path.join(dir, e.name), [...rel, e.name])
          }
          else if (e.isFile() && e.name.endsWith('.tsx')) found.push([...rel, e.name].join('/'))
        }
      }
      if (fs.existsSync(fePkg)) walk(fePkg)
      if (fs.existsSync(feApp)) walk(feApp)
      let files = Array.from(new Set(found))
      // Ensure static routes win over dynamic ones (e.g., 'create' before '[id]')
      const isDynamic = (p: string) => /\/(\[|\[\[\.\.\.)/.test(p) || /^\[/.test(p)
      files.sort((a, b) => {
        const ad = isDynamic(a) ? 1 : 0
        const bd = isDynamic(b) ? 1 : 0
        if (ad !== bd) return ad - bd // static first
        // Longer, more specific paths later to not shadow peers
        return a.localeCompare(b)
      })
      // Next-style page.tsx
      for (const rel of files.filter(f => f.endsWith('/page.tsx') || f === 'page.tsx')) {
        const segs = rel.split('/')
        segs.pop()
        const importName = `C${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const pageModName = `CM${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const appFile = path.join(feApp, ...segs, 'page.tsx')
        const fromApp = fs.existsSync(appFile)
        const sub = segs.length ? `${segs.join('/')}/page` : 'page'
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/frontend/${sub}`
        const routePath = '/' + (segs.join('/') || '')
        const metaCandidates = [
          path.join(fromApp ? feApp : fePkg, ...segs, 'page.meta.ts'),
          path.join(fromApp ? feApp : fePkg, ...segs, 'meta.ts')
        ]
        const metaPath = metaCandidates.find(p => fs.existsSync(p))
        let metaExpr = 'undefined'
        if (metaPath) {
          const metaImportName = `M${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
          const metaImportPath = `${fromApp ? imps.appBase : imps.pkgBase}/frontend/${[...segs, path.basename(metaPath).replace(/\.ts$/, '')].join('/')}`
          imports.push(`import * as ${metaImportName} from '${metaImportPath}'`)
          metaExpr = `(${metaImportName}.metadata as any)`
          // Only import default page when meta file exists
          imports.push(`import ${importName} from '${importPath}'`)
        } else {
          // Fallback: metadata exported from the page module itself
          metaExpr = `(${pageModName} as any).metadata`
          imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
        }
        frontendRoutes.push(`{ pattern: '${routePath||'/'}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, requireFeatures: (${metaExpr})?.requireFeatures, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, titleKey: (${metaExpr})?.pageTitleKey ?? (${metaExpr})?.titleKey, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, groupKey: (${metaExpr})?.pageGroupKey ?? (${metaExpr})?.groupKey, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, priority: (${metaExpr})?.pagePriority ?? (${metaExpr})?.priority, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb, Component: ${importName} }`)
      }
      // Back-compat direct files
      for (const rel of files.filter(f => !f.endsWith('/page.tsx') && f !== 'page.tsx')) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.tsx$/, '')
        const routeSegs = [...segs, name].filter(Boolean)
        const importName = `C${importId++}_${toVar(modId)}_${toVar(routeSegs.join('_')||'index')}`
        const pageModName = `CM${importId++}_${toVar(modId)}_${toVar(routeSegs.join('_')||'index')}`
        const appFile = path.join(feApp, ...segs, `${name}.tsx`)
        const fromApp = fs.existsSync(appFile)
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/frontend/${[...segs, name].join('/')}`
        const routePath = '/' + (routeSegs.join('/') || '')
        const metaCandidates = [
          path.join(fromApp ? feApp : fePkg, ...segs, name + '.meta.ts'),
          path.join(fromApp ? feApp : fePkg, ...segs, 'meta.ts')
        ]
        const metaPath = metaCandidates.find(p => fs.existsSync(p))
        let metaExpr = 'undefined'
        if (metaPath) {
          const metaImportName = `M${importId++}_${toVar(modId)}_${toVar(routeSegs.join('_')||'index')}`
          const metaBase = path.basename(metaPath)
          const metaImportSub = metaBase === 'meta.ts' ? 'meta' : name + '.meta'
          const metaImportPath = `${fromApp ? imps.appBase : imps.pkgBase}/frontend/${[...segs, metaImportSub].join('/')}`
          imports.push(`import * as ${metaImportName} from '${metaImportPath}'`)
          metaExpr = `(${metaImportName}.metadata as any)`
          // Only import default page when meta file exists
          imports.push(`import ${importName} from '${importPath}'`)
        } else {
          // Fallback: metadata exported from the page module itself
          metaExpr = `(${pageModName} as any).metadata`
          imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
        }
        frontendRoutes.push(`{ pattern: '${routePath||'/'}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, requireFeatures: (${metaExpr})?.requireFeatures, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, titleKey: (${metaExpr})?.pageTitleKey ?? (${metaExpr})?.titleKey, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, groupKey: (${metaExpr})?.pageGroupKey ?? (${metaExpr})?.groupKey, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, Component: ${importName} }`)
      }
    }

    // Entity extensions: src/modules/<module>/data/extensions.ts
    {
      const appFile = path.join(roots.appBase, 'data', 'extensions.ts')
      const pkgFile = path.join(roots.pkgBase, 'data', 'extensions.ts')
      const hasApp = fs.existsSync(appFile)
      const hasPkg = fs.existsSync(pkgFile)
      if (hasApp || hasPkg) {
        const importName = `X_${toVar(modId)}_${importId++}`
        const importPath = hasApp ? `${imps.appBase}/data/extensions` : `${imps.pkgBase}/data/extensions`
        imports.push(`import * as ${importName} from '${importPath}'`)
        extensionsImportName = importName
      }
    }

    // RBAC feature declarations: module root acl.ts
    {
      const rootApp = path.join(roots.appBase, 'acl.ts')
      const rootPkg = path.join(roots.pkgBase, 'acl.ts')
      const hasRoot = fs.existsSync(rootApp) || fs.existsSync(rootPkg)
      if (hasRoot) {
        const importName = `ACL_${toVar(modId)}_${importId++}`
        const useApp = fs.existsSync(rootApp) ? rootApp : rootPkg
        const importPath = useApp.startsWith(roots.appBase) ? `${imps.appBase}/acl` : `${imps.pkgBase}/acl`
        imports.push(`import * as ${importName} from '${importPath}'`)
        featuresImportName = importName
      }
    }

    // Custom entities declarations: module root ce.ts
    {
      const appFile = path.join(roots.appBase, 'ce.ts')
      const pkgFile = path.join(roots.pkgBase, 'ce.ts')
      const hasApp = fs.existsSync(appFile)
      const hasPkg = fs.existsSync(pkgFile)
      if (hasApp || hasPkg) {
        const importName = `CE_${toVar(modId)}_${importId++}`
        const importPath = hasApp ? `${imps.appBase}/ce` : `${imps.pkgBase}/ce`
        imports.push(`import * as ${importName} from '${importPath}'`)
        customEntitiesImportName = importName
      }
    }

    // Vector search configuration: module root vector.ts
    {
      const appFile = path.join(roots.appBase, 'vector.ts')
      const pkgFile = path.join(roots.pkgBase, 'vector.ts')
      const hasApp = fs.existsSync(appFile)
      const hasPkg = fs.existsSync(pkgFile)
      if (hasApp || hasPkg) {
        const importName = `VECTOR_${toVar(modId)}_${importId++}`
        const importPath = hasApp ? `${imps.appBase}/vector` : `${imps.pkgBase}/vector`
        const importStmt = `import * as ${importName} from '${importPath}'`
        imports.push(importStmt)
        vectorImports.push(importStmt)
        vectorImportName = importName
      }
    }

    // Custom field declarations: src/modules/<module>/data/fields.ts
    {
      const appFile = path.join(roots.appBase, 'data', 'fields.ts')
      const pkgFile = path.join(roots.pkgBase, 'data', 'fields.ts')
      const hasApp = fs.existsSync(appFile)
      const hasPkg = fs.existsSync(pkgFile)
      if (hasApp || hasPkg) {
        const importName = `F_${toVar(modId)}_${importId++}`
        const importPath = hasApp ? `${imps.appBase}/data/fields` : `${imps.pkgBase}/data/fields`
        imports.push(`import * as ${importName} from '${importPath}'`)
        fieldsImportName = importName
      }
    }

    // Pages: backend
    const beApp = path.join(roots.appBase, 'backend')
    const bePkg = path.join(roots.pkgBase, 'backend')
    if (fs.existsSync(beApp) || fs.existsSync(bePkg)) {
      const found: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) {
            if (e.name === '__tests__' || e.name === '__mocks__') continue
            walk(path.join(dir, e.name), [...rel, e.name])
          }
          else if (e.isFile() && e.name.endsWith('.tsx')) found.push([...rel, e.name].join('/'))
        }
      }
      if (fs.existsSync(bePkg)) walk(bePkg)
      if (fs.existsSync(beApp)) walk(beApp)
      let files = Array.from(new Set(found))
      const isDynamic = (p: string) => /\/(\[|\[\[\.\.\.)/.test(p) || /^\[/.test(p)
      files.sort((a, b) => {
        const ad = isDynamic(a) ? 1 : 0
        const bd = isDynamic(b) ? 1 : 0
        if (ad !== bd) return ad - bd
        return a.localeCompare(b)
      })
      // Next-style
      for (const rel of files.filter(f => f.endsWith('/page.tsx') || f === 'page.tsx')) {
        const segs = rel.split('/')
        segs.pop()
        const importName = `B${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const pageModName = `BM${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const appFile = path.join(beApp, ...segs, 'page.tsx')
        const fromApp = fs.existsSync(appFile)
        const sub = segs.length ? `${segs.join('/')}/page` : 'page'
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/backend/${sub}`
        const basePath = segs.join('/') || modId
        const routePath = '/backend/' + basePath
        const metaCandidates = [
          path.join(fromApp ? beApp : bePkg, ...segs, 'page.meta.ts'),
          path.join(fromApp ? beApp : bePkg, ...segs, 'meta.ts')
        ]
        const metaPath = metaCandidates.find(p => fs.existsSync(p))
        let metaExpr = 'undefined'
        if (metaPath) {
          const metaImportName = `BM${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
          const metaImportPath = `${fromApp ? imps.appBase : imps.pkgBase}/backend/${[...segs, path.basename(metaPath).replace(/\.ts$/, '')].join('/')}`
          imports.push(`import * as ${metaImportName} from '${metaImportPath}'`)
          metaExpr = `(${metaImportName}.metadata as any)`
          // Only import default page when meta file exists
          imports.push(`import ${importName} from '${importPath}'`)
        } else {
          // Fallback: metadata exported from the page module itself
          metaExpr = `(${pageModName} as any).metadata`
          imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
        }
        backendRoutes.push(`{ pattern: '${routePath}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, requireFeatures: (${metaExpr})?.requireFeatures, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, titleKey: (${metaExpr})?.pageTitleKey ?? (${metaExpr})?.titleKey, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, groupKey: (${metaExpr})?.pageGroupKey ?? (${metaExpr})?.groupKey, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, priority: (${metaExpr})?.pagePriority ?? (${metaExpr})?.priority, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb, Component: ${importName} }`)
      }
      // Direct files
      for (const rel of files.filter(f => !f.endsWith('/page.tsx') && f !== 'page.tsx')) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.tsx$/, '')
        const importName = `B${importId++}_${toVar(modId)}_${toVar([...segs, name].join('_')||'index')}`
        const pageModName = `BM${importId++}_${toVar(modId)}_${toVar([...segs, name].join('_')||'index')}`
        const appFile = path.join(beApp, ...segs, `${name}.tsx`)
        const fromApp = fs.existsSync(appFile)
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/backend/${[...segs, name].join('/')}`
        const routePath = '/backend/' + ([modId, ...segs, name].filter(Boolean).join('/'))
        const metaCandidates = [
          path.join(fromApp ? beApp : bePkg, ...segs, name + '.meta.ts'),
          path.join(fromApp ? beApp : bePkg, ...segs, 'meta.ts')
        ]
        const metaPath = metaCandidates.find(p => fs.existsSync(p))
        let metaExpr = 'undefined'
        if (metaPath) {
          const metaImportName = `BM${importId++}_${toVar(modId)}_${toVar([...segs, name].join('_')||'index')}`
          const metaBase = path.basename(metaPath)
          const metaImportSub = metaBase === 'meta.ts' ? 'meta' : name + '.meta'
          const metaImportPath = `${fromApp ? imps.appBase : imps.pkgBase}/backend/${[...segs, metaImportSub].join('/')}`
          imports.push(`import * as ${metaImportName} from '${metaImportPath}'`)
          metaExpr = `${metaImportName}.metadata`
          // Only import default page when meta file exists
          imports.push(`import ${importName} from '${importPath}'`)
        } else {
          // Fallback: metadata exported from the page module itself
          metaExpr = `(${pageModName} as any).metadata`
          imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
        }
        backendRoutes.push(`{ pattern: '${routePath}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, requireFeatures: (${metaExpr})?.requireFeatures, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, titleKey: (${metaExpr})?.pageTitleKey ?? (${metaExpr})?.titleKey, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, groupKey: (${metaExpr})?.pageGroupKey ?? (${metaExpr})?.groupKey, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, priority: (${metaExpr})?.pagePriority ?? (${metaExpr})?.priority, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb, Component: ${importName} }`)
      }
    }

    // APIs
    const apiApp = path.join(roots.appBase, 'api')
    const apiPkg = path.join(roots.pkgBase, 'api')
    if (fs.existsSync(apiApp) || fs.existsSync(apiPkg)) {
      // route.ts aggregations
      const routeFiles: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) {
            if (e.name === '__tests__' || e.name === '__mocks__') continue
            walk(path.join(dir, e.name), [...rel, e.name])
          }
          else if (e.isFile() && e.name === 'route.ts') routeFiles.push([...rel, e.name].join('/'))
        }
      }
      if (fs.existsSync(apiPkg)) walk(apiPkg)
      if (fs.existsSync(apiApp)) walk(apiApp)
      const routeList = Array.from(new Set(routeFiles))
      const isDynamicRoute = (p: string) => p.split('/').some((seg) => /\[|\[\[\.\.\./.test(seg))
      routeList.sort((a, b) => {
        const ad = isDynamicRoute(a) ? 1 : 0
        const bd = isDynamicRoute(b) ? 1 : 0
        if (ad !== bd) return ad - bd
        return a.localeCompare(b)
      })
      for (const rel of routeList) {
        const segs = rel.split('/')
        segs.pop()
        const reqSegs = [modId, ...segs]
        const importName = `R${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const appFile = path.join(apiApp, ...segs, 'route.ts')
        const fromApp = fs.existsSync(appFile)
        const apiSegPath = segs.join('/')
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/api${apiSegPath ? `/${apiSegPath}` : ''}/route`
        const routePath = '/' + reqSegs.filter(Boolean).join('/')
        const sourceFile = fromApp ? appFile : path.join(apiPkg, ...segs, 'route.ts')
        const docsPart = moduleHasExport(sourceFile, 'openApi') ? `, docs: ${importName}.openApi` : ''
        imports.push(`import * as ${importName} from '${importPath}'`)
        apis.push(`{ path: '${routePath}', metadata: (${importName} as any).metadata, handlers: ${importName} as any${docsPart} }`)
      }

      // Single files
      const plainFiles: string[] = []
      const methodNames = new Set(['get','post','put','patch','delete'])
      const walkPlain = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) {
            if (methodNames.has(e.name.toLowerCase())) continue
            if (e.name === '__tests__' || e.name === '__mocks__') continue
            walkPlain(path.join(dir, e.name), [...rel, e.name])
          } else if (e.isFile() && e.name.endsWith('.ts') && e.name !== 'route.ts') {
            if (/\.(test|spec)\.ts$/.test(e.name)) continue
            plainFiles.push([...rel, e.name].join('/'))
          }
        }
      }
      if (fs.existsSync(apiPkg)) walkPlain(apiPkg)
      if (fs.existsSync(apiApp)) walkPlain(apiApp)
      const plainList = Array.from(new Set(plainFiles))
      for (const rel of plainList) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const pathWithoutExt = file.replace(/\.ts$/, '')
        const fullSegs = [...segs, pathWithoutExt]
        const routePath = '/' + [modId, ...fullSegs].filter(Boolean).join('/')
        const importName = `R${importId++}_${toVar(modId)}_${toVar(fullSegs.join('_')||'index')}`
        const appFile = path.join(apiApp, ...fullSegs) + '.ts'
        const fromApp = fs.existsSync(appFile)
        const plainSegPath = fullSegs.join('/')
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/api${plainSegPath ? `/${plainSegPath}` : ''}`
        const pkgFile = path.join(apiPkg, ...fullSegs) + '.ts'
        const sourceFile = fromApp ? appFile : pkgFile
        const docsPart = moduleHasExport(sourceFile, 'openApi') ? `, docs: ${importName}.openApi` : ''
        imports.push(`import * as ${importName} from '${importPath}'`)
        apis.push(`{ path: '${routePath}', metadata: (${importName} as any).metadata, handlers: ${importName} as any${docsPart} }`)
      }
      // Legacy per-method
      const methods: HttpMethod[] = ['GET','POST','PUT','PATCH','DELETE']
      for (const method of methods) {
        const coreMethodDir = path.join(apiPkg, method.toLowerCase())
        const appMethodDir = path.join(apiApp, method.toLowerCase())
        const methodDir = fs.existsSync(appMethodDir) ? appMethodDir : coreMethodDir
        if (!fs.existsSync(methodDir)) continue
        const apiFiles: string[] = []
        const walk2 = (dir: string, rel: string[] = []) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) {
              if (e.name === '__tests__' || e.name === '__mocks__') continue
              walk2(path.join(dir, e.name), [...rel, e.name])
            }
            else if (e.isFile() && e.name.endsWith('.ts')) {
              if (/\.(test|spec)\.ts$/.test(e.name)) continue
              apiFiles.push([...rel, e.name].join('/'))
            }
          }
        }
        walk2(methodDir)
        const methodList = Array.from(new Set(apiFiles))
        for (const rel of methodList) {
          const segs = rel.split('/')
          const file = segs.pop()!
          const pathWithoutExt = file.replace(/\.ts$/, '')
          const fullSegs = [...segs, pathWithoutExt]
          const routePath = '/' + [modId, ...fullSegs].filter(Boolean).join('/')
          const importName = `H${importId++}_${toVar(modId)}_${toVar(method)}_${toVar(fullSegs.join('_'))}`
          const fromApp = methodDir === appMethodDir
          const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/api/${method.toLowerCase()}/${fullSegs.join('/')}`
          const metaName = `RM${importId++}_${toVar(modId)}_${toVar(method)}_${toVar(fullSegs.join('_'))}`
          const sourceFile = path.join(methodDir, ...segs, file)
          const docsPart = moduleHasExport(sourceFile, 'openApi') ? `, docs: ${metaName}.openApi` : ''
          imports.push(`import ${importName}, * as ${metaName} from '${importPath}'`)
          apis.push(`{ method: '${method}', path: '${routePath}', handler: ${importName}, metadata: ${metaName}.metadata${docsPart} }`)
        }
      }
    }

    // CLI
    const cliApp = path.join(roots.appBase, 'cli.ts')
    const cliPkg = path.join(roots.pkgBase, 'cli.ts')
    const cliPath = fs.existsSync(cliApp) ? cliApp : (fs.existsSync(cliPkg) ? cliPkg : null)
    if (cliPath) {
      const importName = `CLI_${toVar(modId)}`
      const importPath = cliPath.startsWith(roots.appBase) ? `${imps.appBase}/cli` : `${imps.pkgBase}/cli`
      imports.push(`import ${importName} from '${importPath}'`)
      cliImportName = importName
    }

    // Translations: merge core + app with app overriding
    const i18nApp = path.join(roots.appBase, 'i18n')
    const i18nCore = path.join(roots.pkgBase, 'i18n')
    const locales = new Set<string>()
    if (fs.existsSync(i18nCore)) for (const e of fs.readdirSync(i18nCore, { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.json')) locales.add(e.name.replace(/\.json$/, ''))
    if (fs.existsSync(i18nApp)) for (const e of fs.readdirSync(i18nApp, { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.json')) locales.add(e.name.replace(/\.json$/, ''))
    for (const locale of locales) {
      const coreHas = fs.existsSync(path.join(i18nCore, `${locale}.json`))
      const appHas = fs.existsSync(path.join(i18nApp, `${locale}.json`))
      if (coreHas && appHas) {
        const cName = `T_${toVar(modId)}_${toVar(locale)}_C`
        const aName = `T_${toVar(modId)}_${toVar(locale)}_A`
        imports.push(`import ${cName} from '${imps.pkgBase}/i18n/${locale}.json'`)
        imports.push(`import ${aName} from '${imps.appBase}/i18n/${locale}.json'`)
        translations.push(`'${locale}': { ...( ${cName} as unknown as Record<string,string> ), ...( ${aName} as unknown as Record<string,string> ) }`)
      } else if (appHas) {
        const aName = `T_${toVar(modId)}_${toVar(locale)}_A`
        imports.push(`import ${aName} from '${imps.appBase}/i18n/${locale}.json'`)
        translations.push(`'${locale}': ${aName} as unknown as Record<string,string>`)
      } else if (coreHas) {
        const cName = `T_${toVar(modId)}_${toVar(locale)}_C`
        imports.push(`import ${cName} from '${imps.pkgBase}/i18n/${locale}.json'`)
        translations.push(`'${locale}': ${cName} as unknown as Record<string,string>`)
      }
    }

    // Subscribers: src/modules/<module>/subscribers/*.ts
    const subApp = path.join(roots.appBase, 'subscribers')
    const subPkg = path.join(roots.pkgBase, 'subscribers')
    if (fs.existsSync(subApp) || fs.existsSync(subPkg)) {
      const found: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) {
            if (e.name === '__tests__' || e.name === '__mocks__') continue
            walk(path.join(dir, e.name), [...rel, e.name])
          } else if (e.isFile() && e.name.endsWith('.ts')) {
            if (/\.(test|spec)\.ts$/.test(e.name)) continue
            found.push([...rel, e.name].join('/'))
          }
        }
      }
      if (fs.existsSync(subPkg)) walk(subPkg)
      if (fs.existsSync(subApp)) walk(subApp)
      const files = Array.from(new Set(found))
      for (const rel of files) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.ts$/, '')
        const importName = `Subscriber${importId++}_${toVar(modId)}_${toVar([...segs, name].join('_')||'index')}`
        const metaName = `SubscriberMeta${importId++}_${toVar(modId)}_${toVar([...segs, name].join('_')||'index')}`
        const appFile = path.join(subApp, ...segs, `${name}.ts`)
        const fromApp = fs.existsSync(appFile)
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/subscribers/${[...segs, name].join('/')}`
        imports.push(`import ${importName}, * as ${metaName} from '${importPath}'`)
        const sid = [modId, ...segs, name].filter(Boolean).join(':')
        subscribers.push(`{ id: (((${metaName}.metadata) as any)?.id || '${sid}'), event: ((${metaName}.metadata) as any)?.event, persistent: ((${metaName}.metadata) as any)?.persistent, handler: ${importName} }`)
      }
    }

    // Build combined customFieldSets expression from data/fields.ts and ce.ts (entities[].fields)
    {
      const parts: string[] = []
      if (fieldsImportName) parts.push(`(( ${fieldsImportName}.default ?? ${fieldsImportName}.fieldSets) as any) || []`)
      if (customEntitiesImportName) parts.push(`((( ${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || []).filter((e: any) => Array.isArray(e.fields) && e.fields.length).map((e: any) => ({ entity: e.id, fields: e.fields, source: '${modId}' }))`)
      customFieldSetsExpr = parts.length ? `[...${parts.join(', ...')}]` : '[]'
    }

    // Dashboard widgets: src/modules/<module>/widgets/dashboard/**/widget.ts(x)
    {
      const widgetApp = path.join(roots.appBase, 'widgets', 'dashboard')
      const widgetPkg = path.join(roots.pkgBase, 'widgets', 'dashboard')
      if (fs.existsSync(widgetApp) || fs.existsSync(widgetPkg)) {
        const found: string[] = []
        const walk = (dir: string, rel: string[] = []) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) {
              if (e.name === '__tests__' || e.name === '__mocks__') continue
              walk(path.join(dir, e.name), [...rel, e.name])
            } else if (e.isFile() && /^widget\.(t|j)sx?$/.test(e.name)) {
              found.push([...rel, e.name].join('/'))
            }
          }
        }
        if (fs.existsSync(widgetPkg)) walk(widgetPkg)
        if (fs.existsSync(widgetApp)) walk(widgetApp)
        const files = Array.from(new Set(found)).sort()
        for (const rel of files) {
          const appFile = path.join(widgetApp, ...rel.split('/'))
          const fromApp = fs.existsSync(appFile)
          const segs = rel.split('/')
          const file = segs.pop()!
          const base = file.replace(/\.(t|j)sx?$/, '')
          const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/widgets/dashboard/${[...segs, base].join('/')}`
          const key = [modId, ...segs, base].filter(Boolean).join(':')
          const source = fromApp ? 'app' : 'package'
          dashboardWidgets.push(`{ moduleId: '${modId}', key: '${key}', source: '${source}', loader: () => import('${importPath}').then((mod) => mod.default ?? mod) }`)
          const existing = allDashboardWidgets.get(key)
          if (!existing || (existing.source !== 'app' && source === 'app')) {
            allDashboardWidgets.set(key, { moduleId: modId, source, importPath })
          }
        }
      }
    }

    // Injection widgets: src/modules/<module>/widgets/injection/**/widget.ts(x)
    {
      const widgetApp = path.join(roots.appBase, 'widgets', 'injection')
      const widgetPkg = path.join(roots.pkgBase, 'widgets', 'injection')
      if (fs.existsSync(widgetApp) || fs.existsSync(widgetPkg)) {
        const found: string[] = []
        const walk = (dir: string, rel: string[] = []) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) {
              if (e.name === '__tests__' || e.name === '__mocks__') continue
              walk(path.join(dir, e.name), [...rel, e.name])
            } else if (e.isFile() && /^widget\.(t|j)sx?$/.test(e.name)) {
              found.push([...rel, e.name].join('/'))
            }
          }
        }
        if (fs.existsSync(widgetPkg)) walk(widgetPkg)
        if (fs.existsSync(widgetApp)) walk(widgetApp)
        const files = Array.from(new Set(found)).sort()
        for (const rel of files) {
          const appFile = path.join(widgetApp, ...rel.split('/'))
          const fromApp = fs.existsSync(appFile)
          const segs = rel.split('/')
          const file = segs.pop()!
          const base = file.replace(/\.(t|j)sx?$/, '')
          const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/widgets/injection/${[...segs, base].join('/')}`
          const key = [modId, ...segs, base].filter(Boolean).join(':')
          const source = fromApp ? 'app' : 'package'
          injectionWidgets.push(`{ moduleId: '${modId}', key: '${key}', source: '${source}', loader: () => import('${importPath}').then((mod) => mod.default ?? mod) }`)
          const existing = allInjectionWidgets.get(key)
          if (!existing || (existing.source !== 'app' && source === 'app')) {
            allInjectionWidgets.set(key, { moduleId: modId, source, importPath })
          }
        }
      }
    }

    // Injection table: src/modules/<module>/widgets/injection-table.ts
    {
      const appFile = path.join(roots.appBase, 'widgets', 'injection-table.ts')
      const pkgFile = path.join(roots.pkgBase, 'widgets', 'injection-table.ts')
      const hasApp = fs.existsSync(appFile)
      const hasPkg = fs.existsSync(pkgFile)
      if (hasApp || hasPkg) {
        const importName = `InjTable_${toVar(modId)}_${importId++}`
        const importPath = hasApp ? `${imps.appBase}/widgets/injection-table` : `${imps.pkgBase}/widgets/injection-table`
        imports.push(`import * as ${importName} from '${importPath}'`)
        injectionTableImportName = importName
      }
    }

    if (vectorImportName) {
      vectorConfigs.push(`{ moduleId: '${modId}', config: (${vectorImportName}.default ?? ${vectorImportName}.vectorConfig ?? ${vectorImportName}.config ?? null) }`)
    }

    moduleDecls.push(`{
      id: '${modId}',
      ${infoImportName ? `info: ${infoImportName}.metadata,` : ''}
      ${frontendRoutes.length ? `frontendRoutes: [${frontendRoutes.join(', ')}],` : ''}
      ${backendRoutes.length ? `backendRoutes: [${backendRoutes.join(', ')}],` : ''}
      ${apis.length ? `apis: [${apis.join(', ')}],` : ''}
      ${cliImportName ? `cli: ${cliImportName},` : ''}
      ${translations.length ? `translations: { ${translations.join(', ')} },` : ''}
      ${subscribers.length ? `subscribers: [${subscribers.join(', ')}],` : ''}
      ${extensionsImportName ? `entityExtensions: ((${extensionsImportName}.default ?? ${extensionsImportName}.extensions) as any) || [],` : ''}
      customFieldSets: ${customFieldSetsExpr},
      ${featuresImportName ? `features: ((${featuresImportName}.default ?? ${featuresImportName}.features) as any) || [],` : ''}
      ${customEntitiesImportName ? `customEntities: ((${customEntitiesImportName}.default ?? ${customEntitiesImportName}.entities) as any) || [],` : ''}
      ${vectorImportName ? `vector: (${vectorImportName}.default ?? ${vectorImportName}.vectorConfig ?? ${vectorImportName}.config ?? undefined),` : ''}
      ${dashboardWidgets.length ? `dashboardWidgets: [${dashboardWidgets.join(', ')}],` : ''}
      ${injectionWidgets.length ? `injectionWidgets: [${injectionWidgets.join(', ')}],` : ''}
      ${injectionTableImportName ? `injectionTable: ((${injectionTableImportName}.default ?? ${injectionTableImportName}.injectionTable) as any) || {},` : ''}
    }`)
  }

  const output = `// AUTO-GENERATED by scripts/generate-module-registry.ts
import type { Module } from '@open-mercato/shared/modules/registry'
${imports.join('\n')}

export const modules: Module[] = [
  ${moduleDecls.join(',\n  ')}
]
export const modulesInfo = modules.map(m => ({ id: m.id, ...(m.info || {}) }))
`
  const widgetEntriesList = Array.from(allDashboardWidgets.entries()).sort(([a], [b]) => a.localeCompare(b))
  const widgetDecls = widgetEntriesList.map(
    ([key, data]) =>
      `  { moduleId: '${data.moduleId}', key: '${key}', source: '${data.source}', loader: () => import('${data.importPath}').then((mod) => mod.default ?? mod) }`
  )
  const widgetsOutput = `// AUTO-GENERATED by scripts/generate-module-registry.ts
import type { ModuleDashboardWidgetEntry } from '@open-mercato/shared/modules/registry'

export const dashboardWidgetEntries: ModuleDashboardWidgetEntry[] = [
${widgetDecls.join(',\n')}
]
`
  const vectorEntriesLiteral = vectorConfigs.join(',\n  ')
  const vectorImportSection = vectorImports.join('\n')
  const vectorOutput = `// AUTO-GENERATED by scripts/generate-module-registry.ts
import type { VectorModuleConfig } from '@open-mercato/shared/modules/vector'
${vectorImportSection ? `\n${vectorImportSection}\n` : '\n'}type VectorConfigEntry = { moduleId: string; config: VectorModuleConfig | null }

const entriesRaw: VectorConfigEntry[] = [
${vectorEntriesLiteral ? `  ${vectorEntriesLiteral}\n` : ''}]
const entries = entriesRaw.filter((entry): entry is { moduleId: string; config: VectorModuleConfig } => entry.config != null)

export const vectorModuleConfigEntries = entries
export const vectorModuleConfigs: VectorModuleConfig[] = entries.map((entry) => entry.config)
`
  // Validate module dependencies declared via ModuleInfo.requires
  {
    const enabledIds = new Set(enabled.map(e => e.id))
    const problems: string[] = []
    for (const [modId, reqs] of requiresByModule.entries()) {
      const missing = reqs.filter(r => !enabledIds.has(r))
      if (missing.length) {
        problems.push(`- Module "${modId}" requires: ${missing.join(', ')}`)
      }
    }
    if (problems.length) {
      console.error('\nModule dependency check failed:')
      for (const p of problems) console.error(p)
      console.error('\nFix: Enable required module(s) in src/modules.ts. Example:')
      console.error('  export const enabledModules = [ { id: \'' + Array.from(new Set(requiresByModule.values()).values()).join('\' }, { id: \'') + '\' } ]')
      process.exit(1)
    }
  }

  const structureChecksum = calculateStructureChecksum(Array.from(trackedRoots))

  const modulesChecksum = { content: calculateChecksum(output), structure: structureChecksum }
  const existingModulesChecksum = readChecksum(checksumFile)
  const shouldWriteModules = !existingModulesChecksum
    || existingModulesChecksum.content !== modulesChecksum.content
    || existingModulesChecksum.structure !== modulesChecksum.structure
  if (shouldWriteModules) {
    fs.writeFileSync(outFile, output)
    writeChecksum(checksumFile, modulesChecksum)
  }
  logGenerationResult(path.relative(process.cwd(), outFile), shouldWriteModules)

  const widgetsChecksum = { content: calculateChecksum(widgetsOutput), structure: structureChecksum }
  const existingWidgetsChecksum = readChecksum(widgetsChecksumFile)
  const shouldWriteWidgets = !existingWidgetsChecksum
    || existingWidgetsChecksum.content !== widgetsChecksum.content
    || existingWidgetsChecksum.structure !== widgetsChecksum.structure
  if (shouldWriteWidgets) {
    fs.writeFileSync(widgetsOutFile, widgetsOutput)
    writeChecksum(widgetsChecksumFile, widgetsChecksum)
  }
  logGenerationResult(path.relative(process.cwd(), widgetsOutFile), shouldWriteWidgets)

  const injectionWidgetEntriesList = Array.from(allInjectionWidgets.entries()).sort(([a], [b]) => a.localeCompare(b))
  const injectionWidgetDecls = injectionWidgetEntriesList.map(
    ([key, data]) =>
      `  { moduleId: '${data.moduleId}', key: '${key}', source: '${data.source}', loader: () => import('${data.importPath}').then((mod) => mod.default ?? mod) }`
  )
  const injectionWidgetsOutput = `// AUTO-GENERATED by scripts/generate-module-registry.ts
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'

export const injectionWidgetEntries: ModuleInjectionWidgetEntry[] = [
${injectionWidgetDecls.join(',\n')}
]
`
  const injectionWidgetsChecksum = { content: calculateChecksum(injectionWidgetsOutput), structure: structureChecksum }
  const existingInjectionWidgetsChecksum = readChecksum(injectionWidgetsChecksumFile)
  const shouldWriteInjectionWidgets = !existingInjectionWidgetsChecksum
    || existingInjectionWidgetsChecksum.content !== injectionWidgetsChecksum.content
    || existingInjectionWidgetsChecksum.structure !== injectionWidgetsChecksum.structure
  if (shouldWriteInjectionWidgets) {
    fs.writeFileSync(injectionWidgetsOutFile, injectionWidgetsOutput)
    writeChecksum(injectionWidgetsChecksumFile, injectionWidgetsChecksum)
  }
  logGenerationResult(path.relative(process.cwd(), injectionWidgetsOutFile), shouldWriteInjectionWidgets)

  const vectorChecksum = { content: calculateChecksum(vectorOutput), structure: structureChecksum }
  const existingVectorChecksum = readChecksum(vectorChecksumFile)
  const shouldWriteVector = !existingVectorChecksum
    || existingVectorChecksum.content !== vectorChecksum.content
    || existingVectorChecksum.structure !== vectorChecksum.structure
  if (shouldWriteVector) {
    fs.writeFileSync(vectorOutFile, vectorOutput)
    writeChecksum(vectorChecksumFile, vectorChecksum)
  }
  logGenerationResult(path.relative(process.cwd(), vectorOutFile), shouldWriteVector)
}

scan()
