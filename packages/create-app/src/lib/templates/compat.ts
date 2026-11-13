import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Node, Project, SyntaxKind } from 'ts-morph'

export const NPM_CORE_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@open-mercato/core/dist-tags'
export const NPM_TIMEOUT_MS = 4000

/** Where the pinned `@open-mercato/core` line was read. */
export type PinnedLineSource = 'catalog' | 'yarn.lock' | 'package.json' | 'mercato-template.json'

export type PinnedLine = { line: string; source: PinnedLineSource }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const CORE_RESOLUTION = /^\s+resolution:\s+"?@open-mercato\/core@npm:([^"\s]+)"?\s*$/
const ENTERPRISE_RESOLUTION = /^\s+resolution:\s+"?@open-mercato\/enterprise@/

/** `major.minor` of a version or a simple range (`0.10.1`, `^0.10.0`, `~0.9.4`, `0.10.x`, `v0.10`), else null. */
export function lineOf(version: string): string | null {
  const match = /^\s*(?:[\^~]|>=?|=)?\s*v?(\d+)\.(\d+)(?=$|[.\s+*x-])/.exec(version)
  if (!match) return null
  return `${Number(match[1])}.${Number(match[2])}`
}

function readRegularFile(path: string): string | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile()) return null
  return readFileSync(path, 'utf8')
}

/** Lines of `yarn.lock`, read with a line scanner (Yarn 4 lockfiles are YAML, but no YAML parser is needed here). */
function readLockfileLines(appDir: string): string[] | null {
  const content = readRegularFile(join(appDir, 'yarn.lock'))
  return content === null ? null : content.split(/\r?\n/)
}

function readPackageJson(appDir: string): Record<string, unknown> | null {
  const content = readRegularFile(join(appDir, 'package.json'))
  if (content === null) return null
  try {
    const parsed: unknown = JSON.parse(content.replace(/^﻿/, ''))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

function dependencyRange(pkg: Record<string, unknown>, name: string): string | null {
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field]
    if (isRecord(deps) && typeof deps[name] === 'string') return deps[name] as string
  }
  return null
}

/**
 * The Open Mercato line a downloaded app pins, in this order: the `@open-mercato/core@npm:` resolution in
 * `yarn.lock`, the `@open-mercato/core` range in `package.json`, then the manifest `openMercato` value.
 */
export function readPinnedCoreVersion(appDir: string, manifestOpenMercato: string | null = null): PinnedLine | null {
  const lockLines = readLockfileLines(appDir)
  if (lockLines) {
    for (const line of lockLines) {
      const match = CORE_RESOLUTION.exec(line)
      const pinned = match ? lineOf(match[1]) : null
      if (pinned) return { line: pinned, source: 'yarn.lock' }
    }
  }

  const pkg = readPackageJson(appDir)
  const range = pkg ? dependencyRange(pkg, '@open-mercato/core') : null
  const fromPackage = range ? lineOf(range) : null
  if (fromPackage) return { line: fromPackage, source: 'package.json' }

  const fromManifest = manifestOpenMercato ? lineOf(manifestOpenMercato) : null
  if (fromManifest) return { line: fromManifest, source: 'mercato-template.json' }

  return null
}

/**
 * Whether a downloaded app depends on `@open-mercato/enterprise`: resolved in `yarn.lock`, or listed in
 * `package.json` when the app has no `yarn.lock`. Recorded only: the dependency alone never means the app needs an
 * Enterprise license (umbrella D5, revision 7).
 */
export function requiresEnterpriseFromLockfile(appDir: string): boolean {
  const lockLines = readLockfileLines(appDir)
  if (lockLines) return lockLines.some((line) => ENTERPRISE_RESOLUTION.test(line))
  const pkg = readPackageJson(appDir)
  return pkg !== null && dependencyRange(pkg, '@open-mercato/enterprise') !== null
}

export const ENTERPRISE_PACKAGE = '@open-mercato/enterprise'

/**
 * The `@open-mercato/enterprise` registrations of `src/modules.ts`. `unconditional` lists modules registered on every
 * start; `conditional` lists modules behind a condition (an `if`, a ternary, `&&`, `||` or `??`), such as the stock
 * scaffold's `OM_ENABLE_ENTERPRISE_MODULES`. `unreadable` means the file is missing or a reference to the package
 * is neither kind, for example inside a function or a loop, or kept in another binding that may be added later.
 */
export type EnterpriseRegistrations =
  | { status: 'read'; unconditional: string[]; conditional: string[] }
  | { status: 'unreadable' }

const CONDITIONAL_OPERATORS = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
])

/**
 * A top-level statement that registers what it holds on every start: the `enabledModules` declaration, or an
 * expression such as `enabledModules.push(...)`. A literal kept in another binding may be added later under a
 * condition, so it is not followed.
 */
function registersUnconditionally(statement: Node): boolean {
  if (Node.isExpressionStatement(statement)) return true
  if (!Node.isVariableStatement(statement)) return false
  const declarations = statement.getDeclarations()
  return declarations.length === 1 && declarations[0].getName() === 'enabledModules'
}

/** Where a registration object sits: on every start, behind a condition, or somewhere this reader does not follow. */
function registrationPlacement(objectLiteral: Node): 'unconditional' | 'conditional' | 'unknown' {
  let child: Node = objectLiteral
  let conditional = false
  for (let parent = child.getParent(); parent; child = parent, parent = parent.getParent()) {
    if (Node.isSourceFile(parent)) {
      if (conditional) return 'conditional'
      return registersUnconditionally(child) ? 'unconditional' : 'unknown'
    }
    if (Node.isIfStatement(parent)) {
      if (child === parent.getExpression()) return 'unknown'
      conditional = true
    } else if (Node.isConditionalExpression(parent)) {
      if (child === parent.getCondition()) return 'unknown'
      conditional = true
    } else if (Node.isBinaryExpression(parent) && CONDITIONAL_OPERATORS.has(parent.getOperatorToken().getKind())) {
      if (child === parent.getLeft()) return 'unknown'
      conditional = true
    } else if (
      Node.isFunctionLikeDeclaration(parent)
      || Node.isIterationStatement(parent)
      || Node.isTryStatement(parent)
      || Node.isCatchClause(parent)
      || Node.isSwitchStatement(parent)
    ) {
      return 'unknown'
    }
  }
  return 'unknown'
}

/**
 * Reads the `@open-mercato/enterprise` registrations of `<appDir>/src/modules.ts` with the TypeScript AST, without
 * running it. Every string equal to the package name must be the `from` of an object literal with a string `id`;
 * anything else makes the file `unreadable`, so a caller never treats an unfollowed registration as absent.
 */
export function readEnterpriseRegistrations(appDir: string): EnterpriseRegistrations {
  const content = readRegularFile(join(appDir, 'src', 'modules.ts'))
  if (content === null) return { status: 'unreadable' }
  try {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile('modules.ts', content)
    const unconditional: string[] = []
    const conditional: string[] = []
    const references = sourceFile
      .getDescendants()
      .filter((node) => (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) && node.getLiteralText() === ENTERPRISE_PACKAGE)
    for (const reference of references) {
      const property = reference.getParent()
      if (!property || !Node.isPropertyAssignment(property) || property.getName() !== 'from' || property.getInitializer() !== reference) {
        return { status: 'unreadable' }
      }
      const objectLiteral = property.getParent()
      if (!objectLiteral || !Node.isObjectLiteralExpression(objectLiteral)) return { status: 'unreadable' }
      const idProperty = objectLiteral.getProperty('id')
      const idValue = idProperty && Node.isPropertyAssignment(idProperty) ? idProperty.getInitializer() : undefined
      if (!idValue || !(Node.isStringLiteral(idValue) || Node.isNoSubstitutionTemplateLiteral(idValue))) {
        return { status: 'unreadable' }
      }
      const placement = registrationPlacement(objectLiteral)
      if (placement === 'unknown') return { status: 'unreadable' }
      const list = placement === 'unconditional' ? unconditional : conditional
      if (!list.includes(idValue.getLiteralText())) list.push(idValue.getLiteralText())
    }
    return { status: 'read', unconditional, conditional }
  } catch {
    return { status: 'unreadable' }
  }
}

type DistTagsResponse = { ok: boolean; json(): Promise<unknown> }
export type DistTagsFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<DistTagsResponse>

/**
 * The latest stable Open Mercato line, from the npm `latest` dist-tag of `@open-mercato/core`. Null when npm cannot
 * be read in time; one attempt only, because the result is a warning and never a stop.
 */
export async function fetchLatestStableLine(options: { fetchImpl?: DistTagsFetch; timeoutMs?: number } = {}): Promise<string | null> {
  const fetchImpl: DistTagsFetch = options.fetchImpl ?? ((url, init) => fetch(url, init))
  try {
    const response = await fetchImpl(NPM_CORE_DIST_TAGS_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? NPM_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body = await response.json()
    return isRecord(body) && typeof body.latest === 'string' ? lineOf(body.latest) : null
  } catch {
    return null
  }
}

const SOURCE_LABELS: Record<PinnedLineSource, string> = {
  catalog: 'from the catalog facts for this commit',
  'yarn.lock': 'from yarn.lock',
  'package.json': 'from package.json',
  'mercato-template.json': 'from mercato-template.json',
}

/**
 * The compatibility warning (umbrella A5), or null when the template is on the latest stable line. With catalog
 * facts and no npm answer, `linesBehind` decides. Never a stop.
 */
export function compatibilityNotice(input: {
  pinned: PinnedLine | null
  latestLine: string | null
  linesBehind: number | null
}): string | null {
  const { pinned, latestLine, linesBehind } = input
  if (pinned && latestLine) {
    if (pinned.line === latestLine) return null
    return `Built on Open Mercato ${pinned.line} (${SOURCE_LABELS[pinned.source]}); the latest stable line is ${latestLine}.`
  }
  if (pinned?.source === 'catalog' && linesBehind !== null) {
    if (linesBehind === 0) return null
    return `Built on Open Mercato ${pinned.line}, ${linesBehind} ${linesBehind === 1 ? 'line' : 'lines'} behind the latest stable line.`
  }
  const detail = pinned
    ? `It is built on ${pinned.line} (${SOURCE_LABELS[pinned.source]}), and the latest stable line could not be read from npm.`
    : 'No @open-mercato/core version was found in yarn.lock, package.json or mercato-template.json.'
  return `Could not check the Open Mercato line of this template. ${detail}`
}

export const ENTERPRISE_NOTICE =
  'This template depends on @open-mercato/enterprise, which needs an Open Mercato Enterprise license.'

/**
 * What decides the Enterprise notice (umbrella D5, revision 7): the catalog's computed mark when the selected sha has
 * facts, else the app's own `src/modules.ts` registrations and its dependency on `@open-mercato/enterprise`.
 */
/** Module ids printed in the notice; an archive is untrusted, so anything else is left out of the terminal. */
const SAFE_MODULE_ID = /^[A-Za-z0-9_-]{1,64}$/u

export type EnterpriseEvidence =
  | { source: 'catalog'; requiresEnterprise: boolean }
  | { source: 'app'; dependency: boolean; registrations: EnterpriseRegistrations }

/**
 * The Enterprise notice, or null. Catalog facts decide alone. Without them, an unconditional enterprise module asserts
 * the license, conditional ones (the stock scaffold's `OM_ENABLE_ENTERPRISE_MODULES`) and a dependency alone do not,
 * and a dependency with registrations this reader cannot follow says the license could not be confirmed.
 */
export function enterpriseNotice(evidence: EnterpriseEvidence): string | null {
  if (evidence.source === 'catalog') return evidence.requiresEnterprise ? ENTERPRISE_NOTICE : null
  const { registrations, dependency } = evidence
  if (registrations.status === 'read') {
    if (registrations.unconditional.length === 0) return null
    const ids = registrations.unconditional.every((id) => SAFE_MODULE_ID.test(id))
      ? ` (${registrations.unconditional.join(', ')})`
      : ''
    return `This template registers Enterprise modules on every start${ids}, which need an Open Mercato Enterprise license.`
  }
  if (!dependency) return null
  return 'This template depends on @open-mercato/enterprise and may need an Open Mercato Enterprise license. That could not be confirmed: src/modules.ts could not be read for unconditional Enterprise modules.'
}
