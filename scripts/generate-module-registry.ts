#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'

type HttpMethod = 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'

const modulesRoot = path.resolve('src/modules')
const outFile = path.join(modulesRoot, 'generated.ts')

function toVar(s: string) {
  return s.replace(/[^a-zA-Z0-9_]/g, '_')
}

function scan() {
  const entries = fs.readdirSync(modulesRoot, { withFileTypes: true })
  const modules = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))
  const imports: string[] = []
  const moduleDecls: string[] = []
  let importId = 0

  for (const mod of modules) {
    const modId = mod.name
    const modDir = path.join(modulesRoot, modId)

    const frontendRoutes: string[] = []
    const backendRoutes: string[] = []
    const apis: string[] = []
    let cliImportName: string | null = null
    const translations: string[] = []

    function fileHasRequireAuth(absPath: string) {
      try {
        const src = fs.readFileSync(absPath, 'utf8')
        return /export\s+const\s+requireAuth\s*=\s*true\b/.test(src)
      } catch {
        return false
      }
    }
    function fileRequireRoles(absPath: string): string[] | null {
      try {
        const src = fs.readFileSync(absPath, 'utf8')
        const m = src.match(/export\s+const\s+requireRoles\s*=\s*\[([^\]]*)\]/)
        if (!m) return null
        const inner = m[1]
        const roles = Array.from(inner.matchAll(/['\"]([^'\"]+)['\"]/g)).map((x) => x[1]).filter(Boolean)
        return roles.length ? roles : []
      } catch {
        return null
      }
    }

    // Pages: frontend
    const feDir = path.join(modDir, 'frontend')
    if (fs.existsSync(feDir)) {
      const found: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
          else if (e.isFile() && e.name.endsWith('.tsx')) found.push([...rel, e.name].join('/'))
        }
      }
      walk(feDir)
      // Prefer Next-style page.tsx routing
      for (const rel of found.filter(f => f.endsWith('/page.tsx') || f === 'page.tsx')) {
        const segs = rel.split('/')
        segs.pop() // remove page.tsx
        const importName = `C${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const importPath = `@/modules/${modId}/frontend/${[...segs].join('/')}/page`
        const routePath = '/' + (segs.join('/') || '')
        const absPath = path.join(feDir, ...segs, 'page.tsx')
        const ra = fileHasRequireAuth(absPath)
        const rr = fileRequireRoles(absPath)
        imports.push(`import ${importName} from '${importPath}'`)
        frontendRoutes.push(`{ pattern: '${routePath||'/'}', ${ra ? 'requireAuth: true,' : ''} ${rr ? `requireRoles: ${JSON.stringify(rr)},` : ''} Component: ${importName} }`)
      }
      // Back-compat: direct files like login.tsx -> /login
      for (const rel of found.filter(f => !f.endsWith('/page.tsx') && f !== 'page.tsx')) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.tsx$/, '')
        const routeSegs = [...segs, name].filter(Boolean)
        const importName = `C${importId++}_${toVar(modId)}_${toVar(routeSegs.join('_')||'index')}`
        const importPath = `@/modules/${modId}/frontend/${[...segs, name].join('/')}`
        const routePath = '/' + (routeSegs.join('/') || '')
        const absPath = path.join(feDir, ...segs, name + '.tsx')
        const ra = fileHasRequireAuth(absPath)
        const rr = fileRequireRoles(absPath)
        imports.push(`import ${importName} from '${importPath}'`)
        frontendRoutes.push(`{ pattern: '${routePath||'/'}', ${ra ? 'requireAuth: true,' : ''} ${rr ? `requireRoles: ${JSON.stringify(rr)},` : ''} Component: ${importName} }`)
      }
    }

    // Pages: backend
    const beDir = path.join(modDir, 'backend')
    if (fs.existsSync(beDir)) {
      const found: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
          else if (e.isFile() && e.name.endsWith('.tsx')) found.push([...rel, e.name].join('/'))
        }
      }
      walk(beDir)
      for (const rel of found.filter(f => f.endsWith('/page.tsx') || f === 'page.tsx')) {
        const segs = rel.split('/')
        segs.pop() // remove page.tsx
        let routePath: string
        if (segs.length === 0) {
          routePath = '/backend/' + modId
        } else {
          routePath = '/backend/' + segs.join('/')
        }
        const importName = `C${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const importPath = `@/modules/${modId}/backend/${[...segs].join('/')}/page`
        const absPath = path.join(beDir, ...segs, 'page.tsx')
        const ra = fileHasRequireAuth(absPath)
        const rr = fileRequireRoles(absPath)
        imports.push(`import ${importName} from '${importPath}'`)
        backendRoutes.push(`{ pattern: '${routePath}', ${ra ? 'requireAuth: true,' : ''} ${rr ? `requireRoles: ${JSON.stringify(rr)},` : ''} Component: ${importName} }`)
      }
      // Back-compat: direct files like example.tsx -> /backend/example
      for (const rel of found.filter(f => !f.endsWith('/page.tsx') && f !== 'page.tsx')) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.tsx$/, '')
        const routePath = '/backend/' + [...segs, name].join('/')
        const importName = `C${importId++}_${toVar(modId)}_${toVar([...segs, name].join('_')||'index')}`
        const importPath = `@/modules/${modId}/backend/${[...segs, name].join('/')}`
        const absPath = path.join(beDir, ...segs, name + '.tsx')
        const ra = fileHasRequireAuth(absPath)
        const rr = fileRequireRoles(absPath)
        imports.push(`import ${importName} from '${importPath}'`)
        backendRoutes.push(`{ pattern: '${routePath}', ${ra ? 'requireAuth: true,' : ''} ${rr ? `requireRoles: ${JSON.stringify(rr)},` : ''} Component: ${importName} }`)
      }
    }

    // APIs: Next-style route files: api/**/route.ts
    const apiDir = path.join(modDir, 'api')
    if (fs.existsSync(apiDir)) {
      const routeFiles: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
          else if (e.isFile() && e.name === 'route.ts') routeFiles.push([...rel, e.name].join('/'))
        }
      }
      walk(apiDir)
      for (const rel of routeFiles) {
        const segs = rel.split('/')
        segs.pop() // remove route.ts
        const routePath = '/' + segs.join('/')
        const importName = `R${importId++}_${toVar(modId)}_${toVar(segs.join('_')||'index')}`
        const importPath = `@/modules/${modId}/api/${[...segs].join('/')}/route`
        const absPath = path.join(apiDir, ...segs, 'route.ts')
        const ra = fileHasRequireAuth(absPath)
        const rr = fileRequireRoles(absPath)
        imports.push(`import * as ${importName} from '${importPath}'`)
        apis.push(`{ path: '${routePath}', ${ra ? 'requireAuth: true,' : ''} ${rr ? `requireRoles: ${JSON.stringify(rr)},` : ''} handlers: ${importName} }`)
      }
      // Back-compat: legacy per-method structure
      const methods: HttpMethod[] = ['GET','POST','PUT','PATCH','DELETE']
      for (const method of methods) {
        const methodDir = path.join(apiDir, method.toLowerCase())
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
          const routePath = '/' + fullSegs.join('/')
          const importName = `H${importId++}_${toVar(modId)}_${toVar(method)}_${toVar(fullSegs.join('_'))}`
          const importPath = `@/modules/${modId}/api/${method.toLowerCase()}/${fullSegs.join('/')}`
          imports.push(`import ${importName} from '${importPath}'`)
          apis.push(`{ method: '${method}', path: '${routePath}', handler: ${importName} }`)
        }
      }
    }

    // CLI
    const cliPath = path.join(modDir, 'cli.ts')
    if (fs.existsSync(cliPath)) {
      const importName = `CLI_${toVar(modId)}`
      const importPath = `@/modules/${modId}/cli`
      imports.push(`import ${importName} from '${importPath}'`)
      cliImportName = importName
    }

    // Translations: i18n/<locale>.json
    const i18nDir = path.join(modDir, 'i18n')
    if (fs.existsSync(i18nDir)) {
      for (const e of fs.readdirSync(i18nDir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.json')) {
          const locale = e.name.replace(/\.json$/, '')
          const importName = `T_${toVar(modId)}_${toVar(locale)}`
          const importPath = `@/modules/${modId}/i18n/${locale}.json`
          imports.push(`import ${importName} from '${importPath}'`)
          translations.push(`'${locale}': ${importName} as Record<string,string>`) // flat keys expected
        }
      }
    }

    moduleDecls.push(`{
      id: '${modId}',
      ${frontendRoutes.length ? `frontendRoutes: [${frontendRoutes.join(', ')}],` : ''}
      ${backendRoutes.length ? `backendRoutes: [${backendRoutes.join(', ')}],` : ''}
      ${apis.length ? `apis: [${apis.join(', ')}],` : ''}
      ${cliImportName ? `cli: ${cliImportName},` : ''}
      ${translations.length ? `translations: { ${translations.join(', ')} },` : ''}
    }`)
  }

  const output = `// AUTO-GENERATED by scripts/generate-module-registry.ts
import type { ErpModule } from './registry'
${imports.join('\n')}

export const modules: ErpModule[] = [
  ${moduleDecls.join(',\n  ')}
]
`
  fs.writeFileSync(outFile, output)
}

scan()
console.log('Generated', path.relative(process.cwd(), outFile))
