#!/usr/bin/env node
// Dev-mode watch-scope resolution.
//
// Lets developers narrow which workspace packages the consolidated package
// watcher (`scripts/watch-packages.mjs`) tracks, instead of always watching
// every package. Four modes are supported (see `apps/docs/docs/appendix/
// troubleshooting.mdx`):
//
//   - `all`            watch every discovered package (default, unchanged).
//   - `auto-optimized` watch only packages touched recently (git working tree
//                      + current-branch diff), re-checking every 2 minutes and
//                      expanding watchers to newly-touched packages.
//   - `popular`        watch only the most frequently changed packages (ranked
//                      from recent git history; static fallback when no git).
//   - `env`            watch exactly the packages named in `OM_WATCH_PACKAGES`
//                      (or the interactive picker's persisted selection).
//
// Mode is selected via `OM_WATCH_SCOPE` or `--watch=<mode>` CLI flags forwarded
// by `scripts/dev.mjs`. CLI flags win over env. This module is deliberately
// pure: every git call goes through an injectable `runGit` so the logic stays
// unit-testable without a real repository.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

export const WATCH_SCOPE_ALL = 'all'
export const WATCH_SCOPE_AUTO = 'auto-optimized'
export const WATCH_SCOPE_POPULAR = 'popular'
export const WATCH_SCOPE_ENV = 'env'

export const WATCH_SCOPES = [
  WATCH_SCOPE_ALL,
  WATCH_SCOPE_AUTO,
  WATCH_SCOPE_POPULAR,
  WATCH_SCOPE_ENV,
]

// Re-check + expand interval for `auto-optimized`.
export const AUTO_EXPAND_INTERVAL_MS = 120000

// Default popular packages when git history cannot rank anything.
export const DEFAULT_POPULAR_PACKAGES = ['core', 'ui', 'shared']

export const DEFAULT_POPULAR_LIMIT = 6

// Candidate base refs for the current-branch diff, in priority order.
const DEFAULT_BASE_REFS = ['origin/develop', 'develop', 'origin/main', 'main']

const PERSISTED_SELECTION_RELATIVE = join('.mercato', 'watch-packages.local.json')

function normalizeMode(value) {
  if (!value) return null
  const raw = String(value).trim().toLowerCase()
  if (!raw) return null
  // Accept a few friendly aliases.
  if (raw === 'auto' || raw === 'optimized' || raw === 'auto-optimised') return WATCH_SCOPE_AUTO
  if (raw === 'popular' || raw === 'frequent' || raw === 'hot') return WATCH_SCOPE_POPULAR
  if (raw === 'env' || raw === 'list' || raw === 'select' || raw === 'manual') return WATCH_SCOPE_ENV
  if (raw === 'all' || raw === 'full' || raw === 'everything') return WATCH_SCOPE_ALL
  return WATCH_SCOPES.includes(raw) ? raw : null
}

export function parsePackageList(value) {
  if (!value) return []
  const seen = new Set()
  const result = []
  for (const token of String(value).split(/[\s,]+/)) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isDisabledFlag(value) {
  if (value === undefined || value === null) return false
  const raw = String(value).trim().toLowerCase()
  return raw === '0' || raw === 'false' || raw === 'off' || raw === 'no'
}

// Parse the watch-scope-related argv flags. Recognized forms:
//   --watch=<mode>            (mode = all|auto-optimized|popular|env + aliases)
//   --watch-auto              shorthand for --watch=auto-optimized
//   --watch-popular           shorthand for --watch=popular
//   --watch-all               shorthand for --watch=all
//   --watch-env               shorthand for --watch=env
//   --watch-packages=a,b,c    explicit package list (implies env mode)
//   --watch-popular-limit=N   popular cap
export function parseWatchScopeArgs(argv = []) {
  const out = {}
  for (const arg of argv) {
    if (typeof arg !== 'string') continue
    const eq = arg.indexOf('=')
    const key = eq === -1 ? arg : arg.slice(0, eq)
    const value = eq === -1 ? '' : arg.slice(eq + 1)
    switch (key) {
      case '--watch':
      case '--watch-scope': {
        const mode = normalizeMode(value)
        if (mode) out.mode = mode
        break
      }
      case '--watch-auto':
      case '--watch-optimized':
        out.mode = WATCH_SCOPE_AUTO
        break
      case '--watch-popular':
        out.mode = WATCH_SCOPE_POPULAR
        break
      case '--watch-env':
      case '--watch-select':
        out.mode = WATCH_SCOPE_ENV
        break
      case '--watch-all':
        out.mode = WATCH_SCOPE_ALL
        break
      case '--watch-packages': {
        const list = parsePackageList(value)
        if (list.length) {
          out.packages = list
          if (!out.mode) out.mode = WATCH_SCOPE_ENV
        }
        break
      }
      case '--watch-popular-limit': {
        const limit = parsePositiveInt(value, 0)
        if (limit) out.popularLimit = limit
        break
      }
      default:
        break
    }
  }
  return out
}

// Resolve the effective scope config from env + argv. Argv wins over env.
export function resolveWatchScope({ env = {}, argv = [] } = {}) {
  const fromArgs = parseWatchScopeArgs(argv)
  const mode = fromArgs.mode || normalizeMode(env.OM_WATCH_SCOPE) || WATCH_SCOPE_ALL
  const explicitPackages = fromArgs.packages?.length
    ? fromArgs.packages
    : parsePackageList(env.OM_WATCH_PACKAGES)
  const popularLimit = fromArgs.popularLimit
    || parsePositiveInt(env.OM_WATCH_POPULAR_LIMIT, DEFAULT_POPULAR_LIMIT)
  const popularOverride = parsePackageList(env.OM_WATCH_POPULAR)
  return {
    mode,
    explicitPackages,
    popularLimit,
    popularOverride,
    gitStatusEnabled: !isDisabledFlag(env.OM_WATCH_GIT_STATUS),
    gitBranchEnabled: !isDisabledFlag(env.OM_WATCH_GIT_BRANCH),
    baseRef: typeof env.OM_WATCH_BASE_REF === 'string' && env.OM_WATCH_BASE_REF.trim()
      ? env.OM_WATCH_BASE_REF.trim()
      : null,
  }
}

function packageKeySet(pkg) {
  const keys = new Set()
  if (pkg.shortLabel) keys.add(pkg.shortLabel.toLowerCase())
  if (pkg.name) {
    const name = pkg.name.toLowerCase()
    keys.add(name)
    const slash = name.lastIndexOf('/')
    if (slash !== -1) keys.add(name.slice(slash + 1))
  }
  return keys
}

// Resolve label/name tokens against the discovered package list. Matches on
// short label and on package name (with or without the npm scope).
export function matchPackagesByLabels(packages, labels) {
  if (!labels?.length) return []
  const wanted = new Set(labels.map((label) => String(label).trim().toLowerCase()).filter(Boolean))
  return packages.filter((pkg) => {
    for (const key of packageKeySet(pkg)) {
      if (wanted.has(key)) return true
    }
    return false
  })
}

function toRelativeDir(root, dir) {
  const rel = relative(root, dir)
  if (!rel || rel.startsWith('..')) return null
  return rel.split(sep).join('/')
}

// Map repo-relative changed file paths to the packages that own them.
export function mapChangedPathsToPackages(packages, root, changedPaths) {
  if (!changedPaths?.length) return []
  const prefixes = packages
    .map((pkg) => {
      const relDir = toRelativeDir(root, pkg.packageDir)
      return relDir ? { pkg, prefix: `${relDir}/` } : null
    })
    .filter(Boolean)
  const matched = new Map()
  for (const rawPath of changedPaths) {
    const normalized = String(rawPath).trim().replace(/\\/g, '/')
    if (!normalized) continue
    for (const { pkg, prefix } of prefixes) {
      if (normalized.startsWith(prefix)) {
        matched.set(pkg.shortLabel, pkg)
        break
      }
    }
  }
  return [...matched.values()]
}

function defaultRunGit(root, gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  })
}

function safeRunGit(runGit, root, gitArgs) {
  try {
    const output = runGit(root, gitArgs)
    return typeof output === 'string' ? output : ''
  } catch {
    return ''
  }
}

function parseStatusPaths(output) {
  const paths = []
  for (const line of output.split('\n')) {
    if (!line) continue
    // `git status --porcelain` lines look like `XY path` or `XY old -> new`.
    const body = line.slice(3)
    if (!body) continue
    const arrow = body.indexOf(' -> ')
    paths.push(arrow === -1 ? body.trim() : body.slice(arrow + 4).trim())
  }
  return paths
}

function resolveBaseRef(runGit, root, preferredBaseRef) {
  const candidates = preferredBaseRef ? [preferredBaseRef, ...DEFAULT_BASE_REFS] : DEFAULT_BASE_REFS
  for (const ref of candidates) {
    const verified = safeRunGit(runGit, root, ['rev-parse', '--verify', '--quiet', ref]).trim()
    if (verified) return ref
  }
  return null
}

// Discover packages "touched recently" via git: uncommitted working-tree
// changes (status) and the current branch's diff against a base ref.
export function detectTouchedPackages({
  packages,
  root,
  config = {},
  runGit = defaultRunGit,
}) {
  const changedPaths = new Set()

  if (config.gitStatusEnabled !== false) {
    for (const path of parseStatusPaths(safeRunGit(runGit, root, ['status', '--porcelain']))) {
      changedPaths.add(path)
    }
  }

  if (config.gitBranchEnabled !== false) {
    const baseRef = resolveBaseRef(runGit, root, config.baseRef)
    if (baseRef) {
      const diff = safeRunGit(runGit, root, ['diff', '--name-only', `${baseRef}...HEAD`])
      for (const path of diff.split('\n')) {
        const trimmed = path.trim()
        if (trimmed) changedPaths.add(trimmed)
      }
    }
  }

  return mapChangedPathsToPackages(packages, root, [...changedPaths])
}

function parseLogFrequencies(output) {
  const counts = new Map()
  for (const line of output.split('\n')) {
    const path = line.trim()
    if (!path) continue
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  return counts
}

// Rank packages by how often their files changed in recent git history.
export function resolvePopularPackages({
  packages,
  root,
  limit = DEFAULT_POPULAR_LIMIT,
  override = [],
  runGit = defaultRunGit,
}) {
  if (override.length) {
    const matched = matchPackagesByLabels(packages, override)
    if (matched.length) return matched.slice(0, Math.max(limit, matched.length))
  }

  const log = safeRunGit(runGit, root, [
    'log',
    '-n',
    '400',
    '--no-merges',
    '--name-only',
    '--pretty=format:',
  ])
  const counts = parseLogFrequencies(log)

  if (counts.size) {
    const prefixes = packages
      .map((pkg) => {
        const relDir = toRelativeDir(root, pkg.packageDir)
        return relDir ? { pkg, prefix: `${relDir}/` } : null
      })
      .filter(Boolean)
    const score = new Map()
    for (const [path, count] of counts) {
      const normalized = path.replace(/\\/g, '/')
      for (const { pkg, prefix } of prefixes) {
        if (normalized.startsWith(prefix)) {
          score.set(pkg.shortLabel, (score.get(pkg.shortLabel) ?? 0) + count)
          break
        }
      }
    }
    if (score.size) {
      const ranked = packages
        .filter((pkg) => score.has(pkg.shortLabel))
        .sort((a, b) => (score.get(b.shortLabel) ?? 0) - (score.get(a.shortLabel) ?? 0))
      return ranked.slice(0, limit)
    }
  }

  // Fallback: the canonical high-churn packages that actually exist here.
  const fallback = matchPackagesByLabels(packages, DEFAULT_POPULAR_PACKAGES)
  return (fallback.length ? fallback : packages).slice(0, limit)
}

export function persistedSelectionPath(root) {
  return join(root, PERSISTED_SELECTION_RELATIVE)
}

export function readPersistedSelection(root) {
  const file = persistedSelectionPath(root)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) return parsePackageList(parsed.join(','))
    if (parsed && Array.isArray(parsed.packages)) return parsePackageList(parsed.packages.join(','))
    return []
  } catch {
    return []
  }
}

export function writePersistedSelection(root, labels) {
  const file = persistedSelectionPath(root)
  mkdirSync(dirname(file), { recursive: true })
  const payload = { packages: parsePackageList((labels ?? []).join(',')) }
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  return file
}

// Resolve the final set of packages to watch for a given scope config.
// Returns { selected, mode, autoExpand, reason }.
export function selectWatchedPackages({
  packages,
  config,
  root,
  runGit = defaultRunGit,
}) {
  const mode = config?.mode ?? WATCH_SCOPE_ALL

  if (mode === WATCH_SCOPE_ALL || !packages?.length) {
    return { selected: packages ?? [], mode: WATCH_SCOPE_ALL, autoExpand: false, reason: 'watching all packages' }
  }

  if (mode === WATCH_SCOPE_ENV) {
    const labels = config.explicitPackages?.length
      ? config.explicitPackages
      : readPersistedSelection(root)
    const selected = matchPackagesByLabels(packages, labels)
    if (!selected.length) {
      return {
        selected: packages,
        mode: WATCH_SCOPE_ALL,
        autoExpand: false,
        reason: 'env scope requested but no packages matched OM_WATCH_PACKAGES / persisted selection — watching all',
      }
    }
    return { selected, mode, autoExpand: false, reason: `watching ${selected.length} package(s) from explicit selection` }
  }

  if (mode === WATCH_SCOPE_POPULAR) {
    const selected = resolvePopularPackages({
      packages,
      root,
      limit: config.popularLimit ?? DEFAULT_POPULAR_LIMIT,
      override: config.popularOverride ?? [],
      runGit,
    })
    return { selected, mode, autoExpand: false, reason: `watching ${selected.length} most-popular package(s)` }
  }

  // auto-optimized
  const touched = detectTouchedPackages({ packages, root, config, runGit })
  if (touched.length) {
    return { selected: touched, mode, autoExpand: true, reason: `watching ${touched.length} recently-touched package(s), expanding every 2m` }
  }
  // Nothing touched yet — seed with the popular fallback and grow from there.
  const seed = resolvePopularPackages({
    packages,
    root,
    limit: config.popularLimit ?? DEFAULT_POPULAR_LIMIT,
    override: config.popularOverride ?? [],
    runGit,
  })
  return { selected: seed, mode, autoExpand: true, reason: `no recent changes detected — seeding ${seed.length} package(s), expanding every 2m` }
}
