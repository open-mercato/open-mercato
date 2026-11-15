import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The request container is built in Awilix CLASSIC injection mode
// (packages/shared/src/lib/di/container.ts). CLASSIC resolves dependencies by
// parsing parameter NAMES, so a factory that destructures its first parameter —
// asFunction(({ em }) => ...) — receives the positionally-resolved dependency as
// the object being destructured and every destructured binding comes out
// undefined (or, for renamed bindings, resolution throws). See issue #4201.
// Destructuring factories must therefore opt into PROXY resolution per
// registration by chaining .proxy().
//
// Scanned roots (#4394, follow-up to #4209): module di.ts files under every
// packages/* package, every apps/* host (its own src/di.ts plus each of its
// local modules), and the create-app template that ships the same shape to
// every scaffolded app. external/official-modules is an optional companion
// checkout, not part of this repo — it is deliberately NOT scanned here, since
// requiring it present would make an optional checkout mandatory for `yarn test`.
// An official module's own CI runs this same guard against its own package.

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
const packagesRoot = path.join(repoRoot, 'packages')

/** `<root>/<name>/di.ts` for each immediate subdirectory of `modulesDir` that has one. */
function listModuleDiFilesUnder(modulesDir: string): string[] {
  if (!fs.existsSync(modulesDir) || !fs.statSync(modulesDir).isDirectory()) return []
  const diFiles: string[] = []
  for (const moduleName of fs.readdirSync(modulesDir)) {
    const diFile = path.join(modulesDir, moduleName, 'di.ts')
    if (fs.existsSync(diFile)) diFiles.push(diFile)
  }
  return diFiles
}

/** A host app's own `src/di.ts` (container-level registrations) plus its local modules' `di.ts`. */
function listHostDiFiles(srcDir: string): string[] {
  const diFiles: string[] = []
  const rootDiFile = path.join(srcDir, 'di.ts')
  if (fs.existsSync(rootDiFile)) diFiles.push(rootDiFile)
  diFiles.push(...listModuleDiFilesUnder(path.join(srcDir, 'modules')))
  return diFiles
}

function listDiFiles(): string[] {
  const diFiles: string[] = []

  // packages/*/src/modules/*/di.ts
  for (const packageName of fs.readdirSync(packagesRoot)) {
    diFiles.push(...listModuleDiFilesUnder(path.join(packagesRoot, packageName, 'src', 'modules')))
  }

  // apps/*/src/di.ts and apps/*/src/modules/*/di.ts — docs-only apps (no src/modules, no
  // src/di.ts) contribute nothing, so this needs no allowlist of which apps are DI hosts.
  const appsRoot = path.join(repoRoot, 'apps')
  if (fs.existsSync(appsRoot)) {
    for (const appName of fs.readdirSync(appsRoot)) {
      const srcDir = path.join(appsRoot, appName, 'src')
      if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
        diFiles.push(...listHostDiFiles(srcDir))
      }
    }
  }

  // The create-app template ships the same host + example-module shape to every
  // scaffolded app, so it needs the same scan rather than only its own package's di.ts.
  diFiles.push(...listHostDiFiles(path.join(packagesRoot, 'create-app', 'template', 'src')))

  return diFiles
}

function findMatchingParen(source: string, openParenIndex: number): number {
  let depth = 0
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

type Violation = { file: string; snippet: string }

function findDestructuringWithoutProxy(file: string): Violation[] {
  const source = fs.readFileSync(file, 'utf8')
  const violations: Violation[] = []
  const destructuredFactory = /asFunction\s*(?=\(\s*(?:async\s*)?\(\s*\{)/g
  let match: RegExpExecArray | null
  while ((match = destructuredFactory.exec(source)) !== null) {
    const openParenIndex = source.indexOf('(', match.index + match[0].length)
    const closeParenIndex = findMatchingParen(source, openParenIndex)
    if (closeParenIndex === -1) {
      violations.push({ file, snippet: source.slice(match.index, match.index + 80) })
      continue
    }
    const modifierChain = source.slice(closeParenIndex + 1).match(/^(?:\s*\.\s*\w+\(\))*/)?.[0] ?? ''
    if (!/\.\s*proxy\(\)/.test(modifierChain)) {
      violations.push({ file, snippet: source.slice(match.index, closeParenIndex + 1).slice(0, 120) })
    }
  }
  return violations
}

describe('module DI registrations vs CLASSIC injection mode', () => {
  it('every asFunction factory with a destructured parameter chains .proxy()', () => {
    const diFiles = listDiFiles()
    expect(diFiles.length).toBeGreaterThan(0)

    const violations = diFiles.flatMap(findDestructuringWithoutProxy)
    const report = violations
      .map(({ file, snippet }) => `${path.relative(repoRoot, file)}: ${snippet.replace(/\s+/g, ' ')}`)
      .join('\n')

    expect(report).toBe('')
  })

  it('scans apps/mercato and the create-app template, not just packages/*', () => {
    const diFiles = listDiFiles()
    const relative = diFiles.map((file) => path.relative(repoRoot, file))

    expect(relative).toContain(path.join('apps', 'mercato', 'src', 'modules', 'example', 'di.ts'))
    expect(relative).toContain(
      path.join('packages', 'create-app', 'template', 'src', 'modules', 'example', 'di.ts'),
    )
  })

  it('catches a destructuring factory without .proxy() in an app-local module (regression fixture)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-classic-proxy-test-'))
    const modulesDir = path.join(tmpDir, 'modules', 'broken_example')
    fs.mkdirSync(modulesDir, { recursive: true })
    fs.writeFileSync(
      path.join(modulesDir, 'di.ts'),
      "import { asFunction } from 'awilix'\n" +
        "export function register(container) {\n" +
        "  container.register({ thing: asFunction(({ em }) => em).scoped() })\n" +
        '}\n',
    )
    try {
      const violations = findDestructuringWithoutProxy(path.join(modulesDir, 'di.ts'))
      expect(violations).toHaveLength(1)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
