#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadEnabledModules, moduleFsRoots, moduleImportBase } from './shared/modules-config'

type HttpMethod = 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'

const outFile = path.resolve('generated/modules.generated.ts')
const checksumFile = path.resolve('generated/modules.generated.checksum')

function calculateChecksum(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}

function toVar(s: string) { return s.replace(/[^a-zA-Z0-9_]/g, '_') }

function scan() {
  const enabled = loadEnabledModules()
  const imports: string[] = []
  const moduleDecls: string[] = []
  let importId = 0

  for (const entry of enabled) {
    const modId = entry.id
    const roots = moduleFsRoots(entry)
    const imps = moduleImportBase(entry)

    const frontendRoutes: string[] = []
    const backendRoutes: string[] = []
    const apis: string[] = []
    let cliImportName: string | null = null
    const translations: string[] = []
    const subscribers: string[] = []
    let infoImportName: string | null = null
    let extensionsImportName: string | null = null
    let fieldsImportName: string | null = null

    // Module metadata: index.ts (overrideable)
    const appIndex = path.join(roots.appBase, 'index.ts')
    const pkgIndex = path.join(roots.pkgBase, 'index.ts')
    const indexTs = fs.existsSync(appIndex) ? appIndex : (fs.existsSync(pkgIndex) ? pkgIndex : null)
    if (indexTs) {
      infoImportName = `I${importId++}_${toVar(modId)}`
      const importPath = indexTs.startsWith(roots.appBase) ? `${imps.appBase}/index` : `${imps.pkgBase}/index`
      imports.push(`import * as ${infoImportName} from '${importPath}'`)
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
          metaExpr = `${metaImportName}.metadata`
          // Only import default page when meta file exists
          imports.push(`import ${importName} from '${importPath}'`)
        } else {
          // Fallback: metadata exported from the page module itself
          metaExpr = `${pageModName}['metadata']`
          imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
        }
        frontendRoutes.push(`{ pattern: '${routePath||'/'}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb, Component: ${importName} }`)
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
          metaExpr = `${metaImportName}.metadata`
          // Only import default page when meta file exists
          imports.push(`import ${importName} from '${importPath}'`)
        } else {
          // Fallback: metadata exported from the page module itself
          metaExpr = `${pageModName}['metadata']`
          imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
        }
        frontendRoutes.push(`{ pattern: '${routePath||'/'}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, Component: ${importName} }`)
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
          metaExpr = `${metaImportName}.metadata`
          // Only import default page when meta file exists
          imports.push(`import ${importName} from '${importPath}'`)
        } else {
          // Fallback: metadata exported from the page module itself
          metaExpr = `${pageModName}['metadata']`
          imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
        }
        backendRoutes.push(`{ pattern: '${routePath}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb, Component: ${importName} }`)
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
          metaExpr = `${pageModName}['metadata']`
          imports.push(`import ${importName}, * as ${pageModName} from '${importPath}'`)
        }
        backendRoutes.push(`{ pattern: '${routePath}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, icon: (${metaExpr})?.icon, order: (${metaExpr})?.pageOrder ?? (${metaExpr})?.order, navHidden: (${metaExpr})?.navHidden, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, breadcrumb: (${metaExpr})?.breadcrumb, Component: ${importName} }`)
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
      for (const rel of routeList) {
        const segs = rel.split('/')
        segs.pop()
        const reqSegs = [modId, ...segs]
        const importName = `R${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const appFile = path.join(apiApp, ...segs, 'route.ts')
        const fromApp = fs.existsSync(appFile)
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/api/${segs.join('/')}/route`
        const routePath = '/' + reqSegs.filter(Boolean).join('/')
        imports.push(`import * as ${importName} from '${importPath}'`)
        apis.push(`{ path: '${routePath}', metadata: ${importName}.metadata, handlers: ${importName} }`)
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
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/api/${fullSegs.join('/')}`
        imports.push(`import * as ${importName} from '${importPath}'`)
        apis.push(`{ path: '${routePath}', metadata: ${importName}.metadata, handlers: ${importName} }`)
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
          imports.push(`import ${importName}, * as ${metaName} from '${importPath}'`)
          apis.push(`{ method: '${method}', path: '${routePath}', handler: ${importName}, metadata: ${metaName}.metadata }`)
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
        translations.push(`'${locale}': { ...( ${cName} as Record<string,string> ), ...( ${aName} as Record<string,string> ) }`)
      } else if (appHas) {
        const aName = `T_${toVar(modId)}_${toVar(locale)}_A`
        imports.push(`import ${aName} from '${imps.appBase}/i18n/${locale}.json'`)
        translations.push(`'${locale}': ${aName} as Record<string,string>`)
      } else if (coreHas) {
        const cName = `T_${toVar(modId)}_${toVar(locale)}_C`
        imports.push(`import ${cName} from '${imps.pkgBase}/i18n/${locale}.json'`)
        translations.push(`'${locale}': ${cName} as Record<string,string>`)
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
        subscribers.push(`{ id: (${metaName}.metadata?.id || '${sid}'), event: ${metaName}.metadata?.event, persistent: ${metaName}.metadata?.persistent, handler: ${importName} }`)
      }
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
      ${fieldsImportName ? `customFieldSets: ((${fieldsImportName}.default ?? ${fieldsImportName}.fieldSets) as any) || [],` : ''}
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
  
  // Check if content has changed
  const newChecksum = calculateChecksum(output)
  let shouldWrite = true
  
  if (fs.existsSync(checksumFile)) {
    const existingChecksum = fs.readFileSync(checksumFile, 'utf8').trim()
    if (existingChecksum === newChecksum) {
      shouldWrite = false
    }
  }
  
  if (shouldWrite) {
    fs.writeFileSync(outFile, output)
    fs.writeFileSync(checksumFile, newChecksum)
    console.log('Generated', path.relative(process.cwd(), outFile))
  }
}

scan()
