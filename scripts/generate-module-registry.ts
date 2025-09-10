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

    // Pages: frontend (files under frontend/**/*.tsx)
    const feDir = path.join(modDir, 'frontend')
    if (fs.existsSync(feDir)) {
      const feFiles: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
          else if (e.isFile() && e.name.endsWith('.tsx')) feFiles.push([...rel, e.name].join('/'))
        }
      }
      walk(feDir)
      for (const rel of feFiles) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.tsx$/, '')
        const routeSegs = [...segs, name].filter(Boolean)
        const routePath = '/' + (routeSegs.join('/') || '')
        const importName = `C${importId++}_${toVar(modId)}_${toVar(routeSegs.join('_')||'index')}`
        const importPath = `@/modules/${modId}/frontend/${[...segs, name].join('/')}`
        imports.push(`import ${importName} from '${importPath}'`)
        frontendRoutes.push(`{ path: '${routePath||'/'}', Component: ${importName} }`)
      }
    }

    // Pages: backend (files under backend/**/*.tsx)
    const beDir = path.join(modDir, 'backend')
    if (fs.existsSync(beDir)) {
      const beFiles: string[] = []
      const walk = (dir: string, rel: string[] = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
          else if (e.isFile() && e.name.endsWith('.tsx')) beFiles.push([...rel, e.name].join('/'))
        }
      }
      walk(beDir)
      for (const rel of beFiles) {
        const segs = rel.split('/')
        const file = segs.pop()!
        const name = file.replace(/\.tsx$/, '')
        let routePath: string
        if (segs.length === 0 && name === 'page') {
          // root backend page -> /backend/<module>
          routePath = '/backend/' + modId
        } else {
          routePath = '/backend/' + [...segs, name].join('/')
        }
        const importName = `C${importId++}_${toVar(modId)}_${toVar([...segs, name].join('_')||'index')}`
        const importPath = `@/modules/${modId}/backend/${[...segs, name].join('/')}`
        imports.push(`import ${importName} from '${importPath}'`)
        backendRoutes.push(`{ path: '${routePath}', Component: ${importName} }`)
      }
    }

    // APIs
    const apiDir = path.join(modDir, 'api')
    if (fs.existsSync(apiDir)) {
      const methods: HttpMethod[] = ['GET','POST','PUT','PATCH','DELETE']
      for (const method of methods) {
        const methodDir = path.join(apiDir, method.toLowerCase())
        if (!fs.existsSync(methodDir)) continue
        const apiFiles: string[] = []
        const walk = (dir: string, rel: string[] = []) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) walk(path.join(dir, e.name), [...rel, e.name])
            else if (e.isFile() && e.name.endsWith('.ts')) apiFiles.push([...rel, e.name].join('/'))
          }
        }
        walk(methodDir)
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
