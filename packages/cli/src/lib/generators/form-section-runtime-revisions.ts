import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import { MODULE_CODE_EXTENSIONS, stripModuleCodeExtension } from './scanner'

const ledgerFileName = 'form-sections.runtime-revisions.json'
const revisionPattern = /^(.+)@v([1-9][0-9]*)$/

type Revision = { roundTripId: string; sourceHash: string }
type Entry = Revision & { id: string }

function normalize(node: ts.Node, source: ts.SourceFile): unknown {
  const children = node.getChildren(source).filter((child) => !ts.isJSDoc(child))
  const last = children.at(-1)
  if (last?.kind === ts.SyntaxKind.SemicolonToken && (ts.isStatement(node) || ts.isTypeElement(node))
      && !ts.isEmptyStatement(node)) children.pop()
  if (last?.kind === ts.SyntaxKind.CommaToken && node.kind === ts.SyntaxKind.SyntaxList) children.pop()
  if (children.length) return [node.kind, children.map((child) => normalize(child, source))]
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isJsxText(node)) {
    return [node.kind, node.text]
  }
  return [node.kind, node.getText(source)]
}

function readLocalDependency(specifier: string, file: string, sourceRoot: string): string | null {
  const logical = specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier)
    : specifier.startsWith('@/') ? path.resolve(sourceRoot, specifier.slice(2)) : null
  if (!logical) return null
  const target = stripModuleCodeExtension(logical)
  const candidates = [
    ...MODULE_CODE_EXTENSIONS.map((extension) => target + extension),
    ...MODULE_CODE_EXTENSIONS.map((extension) => path.join(target, 'index' + extension)),
    ...(path.extname(logical) === '.json' ? [logical] : []),
  ]
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue
    const absolute = fs.realpathSync(candidate)
    const relative = path.relative(sourceRoot, absolute)
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.split(path.sep).includes('node_modules')) continue
    return absolute
  }
  return null
}

function fingerprintRuntime(source: ts.SourceFile, sourceRoot: string, visited: Set<string>): unknown {
  const filename = fs.realpathSync(source.fileName)
  if (visited.has(filename)) return null
  visited.add(filename)
  if (path.extname(filename) === '.json') return JSON.parse(source.text)
  const specifiers = new Set<string>()
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly)
      || (ts.isExportDeclaration(node) && !node.isTypeOnly)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.add(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const [argument] = node.arguments
      if (argument && ts.isStringLiteralLike(argument)) specifiers.add(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const dependencies = [...specifiers].sort().flatMap((specifier) => {
    const dependency = readLocalDependency(specifier, filename, sourceRoot)
    if (!dependency || visited.has(dependency)) return []
    const contents = ts.createSourceFile(dependency, fs.readFileSync(dependency, 'utf8'), ts.ScriptTarget.Latest, true)
    return [[specifier, fingerprintRuntime(contents, sourceRoot, visited)]]
  })
  const jsxPragmas = (ts.getLeadingCommentRanges(source.text, 0) ?? []).flatMap(({ pos, end }) =>
    [...source.text.slice(pos, end).matchAll(/@(jsx(?:Frag|ImportSource|Runtime)?)\s+([^\s*]+)/g)].map((match) => match.slice(1)))
  return [path.relative(sourceRoot, filename).split(path.sep).join('/'), jsxPragmas, normalize(source, source), dependencies]
}

export function hashHandwrittenSectionRuntime(runtime: ts.SourceFile, fact: ts.Expression, moduleBase: string): string {
  const sourceRoot = fs.realpathSync(path.resolve(moduleBase, '../..'))
  return createHash('sha256').update(JSON.stringify([
    normalize(fact, fact.getSourceFile()), fingerprintRuntime(runtime, sourceRoot, new Set()),
  ])).digest('hex')
}

function readLedger(filename: string, invalid: (reason: string) => never): Map<string, Revision> {
  const stats = fs.lstatSync(filename, { throwIfNoEntry: false })
  if (!stats) return new Map()
  if (!stats.isFile()) return invalid(ledgerFileName + ' must be a regular file')
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch {
    return invalid('invalid ' + ledgerFileName)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid('invalid ' + ledgerFileName)
  const entries = new Map<string, Revision>()
  for (const [id, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).length !== 2
        || typeof entry.roundTripId !== 'string' || revisionPattern.exec(entry.roundTripId)?.[1] !== id
        || typeof entry.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sourceHash)) {
      return invalid('invalid ' + ledgerFileName)
    }
    entries.set(id, { roundTripId: entry.roundTripId, sourceHash: entry.sourceHash })
  }
  return entries
}

export function planHandwrittenSectionRevisionWrite(
  moduleBase: string, entries: readonly Entry[], invalid: (reason: string) => never,
): { filename: string; content: string } | null {
  if (!entries.length) return null
  const filename = path.join(moduleBase, ledgerFileName)
  const ledger = readLedger(filename, invalid)
  let changed = false
  for (const { id, roundTripId, sourceHash } of entries) {
    const previous = ledger.get(id)
    if (previous?.roundTripId === roundTripId && previous.sourceHash === sourceHash) continue
    const version = (revision: string) => BigInt(revisionPattern.exec(revision)![2])
    if (previous && version(roundTripId) <= version(previous.roundTripId)) {
      return invalid(`semantic runtime drift for "${id}" requires advancing roundTripId beyond "${previous.roundTripId}"`)
    }
    ledger.set(id, { roundTripId, sourceHash })
    changed = true
  }
  if (!changed) return null
  return {
    filename,
    content: JSON.stringify(Object.fromEntries([...ledger.keys()].sort().map((id) => [id, ledger.get(id)])), null, 2) + '\n',
  }
}
