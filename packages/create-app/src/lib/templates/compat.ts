import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
 * `package.json` when the app has no `yarn.lock`.
 */
export function requiresEnterpriseFromLockfile(appDir: string): boolean {
  const lockLines = readLockfileLines(appDir)
  if (lockLines) return lockLines.some((line) => ENTERPRISE_RESOLUTION.test(line))
  const pkg = readPackageJson(appDir)
  return pkg !== null && dependencyRange(pkg, '@open-mercato/enterprise') !== null
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

/** The Enterprise notice (umbrella D5), or null. */
export function enterpriseNotice(requiresEnterprise: boolean): string | null {
  return requiresEnterprise ? ENTERPRISE_NOTICE : null
}
