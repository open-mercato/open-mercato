#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { loadEnabledModules, moduleFsRoots, moduleImportBase } from './shared/modules-config'

type HttpMethod = 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'

const outFile = path.resolve('generated/modules.generated.ts')

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
    let infoImportName: string | null = null

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
          if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
          else if (e.isFile() && e.name.endsWith('.tsx')) found.push([...rel, e.name].join('/'))
        }
      }
      if (fs.existsSync(fePkg)) walk(fePkg)
      if (fs.existsSync(feApp)) walk(feApp)
      // Next-style page.tsx
      for (const rel of found.filter(f => f.endsWith('/page.tsx') || f === 'page.tsx')) {
        const segs = rel.split('/')
        segs.pop()
        const importName = `C${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const appFile = path.join(feApp, ...segs, 'page.tsx')
        const fromApp = fs.existsSync(appFile)
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/frontend/${[...segs].join('/')}/page`
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
        }
        imports.push(`import ${importName} from '${importPath}'`)
        frontendRoutes.push(`{ pattern: '${routePath||'/'}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, Component: ${importName} }`)
      }
      // Back-compat direct files
      for (const rel of found.filter(f => !f.endsWith('/page.tsx') && f !== 'page.tsx')) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.tsx$/, '')
        const routeSegs = [...segs, name].filter(Boolean)
        const importName = `C${importId++}_${toVar(modId)}_${toVar(routeSegs.join('_')||'index')}`
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
        }
        imports.push(`import ${importName} from '${importPath}'`)
        frontendRoutes.push(`{ pattern: '${routePath||'/'}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, Component: ${importName} }`)
      }
    }

    // Pages: backend
    const beApp = path.join(roots.appBase, 'backend')
    const bePkg = path.join(roots.pkgBase, 'backend')
    if (fs.existsSync(beApp) || fs.existsSync(bePkg)) {
      const found: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
          else if (e.isFile() && e.name.endsWith('.tsx')) found.push([...rel, e.name].join('/'))
        }
      }
      if (fs.existsSync(bePkg)) walk(bePkg)
      if (fs.existsSync(beApp)) walk(beApp)
      // Next-style
      for (const rel of found.filter(f => f.endsWith('/page.tsx') || f === 'page.tsx')) {
        const segs = rel.split('/')
        segs.pop()
        const importName = `B${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const appFile = path.join(beApp, ...segs, 'page.tsx')
        const fromApp = fs.existsSync(appFile)
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/backend/${[...segs].join('/')}/page`
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
        }
        imports.push(`import ${importName} from '${importPath}'`)
        backendRoutes.push(`{ pattern: '${routePath}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, Component: ${importName} }`)
      }
      // Direct files
      for (const rel of found.filter(f => !f.endsWith('/page.tsx') && f !== 'page.tsx')) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.tsx$/, '')
        const importName = `B${importId++}_${toVar(modId)}_${toVar([...segs, name].join('_')||'index')}`
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
        }
        imports.push(`import ${importName} from '${importPath}'`)
        backendRoutes.push(`{ pattern: '${routePath}', requireAuth: (${metaExpr})?.requireAuth, requireRoles: (${metaExpr})?.requireRoles, title: (${metaExpr})?.pageTitle ?? (${metaExpr})?.title, group: (${metaExpr})?.pageGroup ?? (${metaExpr})?.group, visible: (${metaExpr})?.visible, enabled: (${metaExpr})?.enabled, Component: ${importName} }`)
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
          if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
          else if (e.isFile() && e.name === 'route.ts') routeFiles.push([...rel, e.name].join('/'))
        }
      }
      if (fs.existsSync(apiPkg)) walk(apiPkg)
      if (fs.existsSync(apiApp)) walk(apiApp)
      for (const rel of routeFiles) {
        const segs = rel.split('/')
        segs.pop()
        const reqSegs = [modId, ...segs]
        const importName = `R${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const appFile = path.join(apiApp, ...segs, 'route.ts')
        const fromApp = fs.existsSync(appFile)
        const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/api/${segs.join('/')}/route`
        const routePath = '/' + reqSegs.filter(Boolean).join('/')
        imports.push(`import * as ${importName} from '${importPath}'`)
        apis.push(`{ path: '${routePath}', requireAuth: ${importName}.metadata?.requireAuth, requireRoles: ${importName}.metadata?.requireRoles, handlers: ${importName} }`)
      }

      // Single files
      const plainFiles: string[] = []
      const methodNames = new Set(['get','post','put','patch','delete'])
      const walkPlain = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) {
            if (methodNames.has(e.name.toLowerCase())) continue
            walkPlain(path.join(dir, e.name), [...rel, e.name])
          } else if (e.isFile() && e.name.endsWith('.ts') && e.name !== 'route.ts') {
            plainFiles.push([...rel, e.name].join('/'))
          }
        }
      }
      if (fs.existsSync(apiPkg)) walkPlain(apiPkg)
      if (fs.existsSync(apiApp)) walkPlain(apiApp)
      for (const rel of plainFiles) {
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
        apis.push(`{ path: '${routePath}', requireAuth: ${importName}.metadata?.requireAuth, requireRoles: ${importName}.metadata?.requireRoles, handlers: ${importName} }`)
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
            if (e.isDirectory()) walk2(path.join(dir, e.name), [...rel, e.name])
            else if (e.isFile() && e.name.endsWith('.ts')) apiFiles.push([...rel, e.name].join('/'))
          }
        }
        walk2(methodDir)
        for (const rel of apiFiles) {
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
          apis.push(`{ method: '${method}', path: '${routePath}', handler: ${importName}, requireAuth: ${metaName}.metadata?.requireAuth, requireRoles: ${metaName}.metadata?.requireRoles }`)
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
        imports.push(`import ${cName} from '${imps.coreBase}/i18n/${locale}.json'`)
        imports.push(`import ${aName} from '${imps.appBase}/i18n/${locale}.json'`)
        translations.push(`'${locale}': { ...( ${cName} as Record<string,string> ), ...( ${aName} as Record<string,string> ) }`)
      } else if (appHas) {
        const aName = `T_${toVar(modId)}_${toVar(locale)}_A`
        imports.push(`import ${aName} from '${imps.appBase}/i18n/${locale}.json'`)
        translations.push(`'${locale}': ${aName} as Record<string,string>`)
      } else if (coreHas) {
        const cName = `T_${toVar(modId)}_${toVar(locale)}_C`
        imports.push(`import ${cName} from '${imps.coreBase}/i18n/${locale}.json'`)
        translations.push(`'${locale}': ${cName} as Record<string,string>`)
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
    }`)
  }

  const output = `// AUTO-GENERATED by scripts/generate-module-registry.ts
import type { Module } from '@mercato-shared/modules/registry'
${imports.join('\n')}

export const modules: Module[] = [
  ${moduleDecls.join(',\n  ')}
]
export const modulesInfo = modules.map(m => ({ id: m.id, ...(m.info || {}) }))
`
  fs.writeFileSync(outFile, output)
}

scan()
console.log('Generated', path.relative(process.cwd(), outFile))
