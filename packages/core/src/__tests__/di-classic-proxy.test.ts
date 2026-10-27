import fs from 'node:fs'
import path from 'node:path'

// The request container is built in Awilix CLASSIC injection mode
// (packages/shared/src/lib/di/container.ts). CLASSIC resolves dependencies by
// parsing parameter NAMES, so a factory that destructures its first parameter —
// asFunction(({ em }) => ...) — receives the positionally-resolved dependency as
// the object being destructured and every destructured binding comes out
// undefined (or, for renamed bindings, resolution throws). See issue #4201.
// Destructuring factories must therefore opt into PROXY resolution per
// registration by chaining .proxy().

const packagesRoot = path.resolve(__dirname, '..', '..', '..')

function listModuleDiFiles(): string[] {
  const diFiles: string[] = []
  for (const packageName of fs.readdirSync(packagesRoot)) {
    const modulesDir = path.join(packagesRoot, packageName, 'src', 'modules')
    if (!fs.existsSync(modulesDir) || !fs.statSync(modulesDir).isDirectory()) continue
    for (const moduleName of fs.readdirSync(modulesDir)) {
      const diFile = path.join(modulesDir, moduleName, 'di.ts')
      if (fs.existsSync(diFile)) diFiles.push(diFile)
    }
  }
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
    const diFiles = listModuleDiFiles()
    expect(diFiles.length).toBeGreaterThan(0)

    const violations = diFiles.flatMap(findDestructuringWithoutProxy)
    const report = violations
      .map(({ file, snippet }) => `${path.relative(packagesRoot, file)}: ${snippet.replace(/\s+/g, ' ')}`)
      .join('\n')

    expect(report).toBe('')
  })
})
