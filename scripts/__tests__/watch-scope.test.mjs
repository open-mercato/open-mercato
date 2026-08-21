import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  AUTO_EXPAND_INTERVAL_MS,
  DEFAULT_POPULAR_PACKAGES,
  WATCH_SCOPE_ALL,
  WATCH_SCOPE_AUTO,
  WATCH_SCOPE_ENV,
  WATCH_SCOPE_POPULAR,
  WATCH_SCOPE_DESCRIPTIONS,
  WATCH_SCOPES,
  describeWatchMode,
  detectTouchedPackages,
  mapChangedPathsToPackages,
  matchPackagesByLabels,
  parsePackageList,
  parseWatchScopeArgs,
  readPersistedSelection,
  resolvePopularPackages,
  resolveWatchScope,
  selectWatchedPackages,
  writePersistedSelection,
} from '../watch-scope.mjs'

const ROOT = '/repo'

function makePackages(root = ROOT) {
  return [
    { name: '@open-mercato/core', shortLabel: 'core', packageDir: path.join(root, 'packages', 'core'), srcDir: path.join(root, 'packages', 'core', 'src') },
    { name: '@open-mercato/ui', shortLabel: 'ui', packageDir: path.join(root, 'packages', 'ui'), srcDir: path.join(root, 'packages', 'ui', 'src') },
    { name: '@open-mercato/shared', shortLabel: 'shared', packageDir: path.join(root, 'packages', 'shared'), srcDir: path.join(root, 'packages', 'shared', 'src') },
    { name: '@open-mercato/search', shortLabel: 'search', packageDir: path.join(root, 'packages', 'search'), srcDir: path.join(root, 'packages', 'search', 'src') },
  ]
}

test('parsePackageList splits on commas/whitespace and dedupes case-insensitively', () => {
  assert.deepEqual(parsePackageList('core, ui  shared,core'), ['core', 'ui', 'shared'])
  assert.deepEqual(parsePackageList(''), [])
  assert.deepEqual(parsePackageList(undefined), [])
})

test('parseWatchScopeArgs recognizes --watch=<mode>, shorthands and aliases', () => {
  assert.equal(parseWatchScopeArgs(['--watch=auto']).mode, WATCH_SCOPE_AUTO)
  assert.equal(parseWatchScopeArgs(['--watch=auto-optimized']).mode, WATCH_SCOPE_AUTO)
  assert.equal(parseWatchScopeArgs(['--watch-popular']).mode, WATCH_SCOPE_POPULAR)
  assert.equal(parseWatchScopeArgs(['--watch-env']).mode, WATCH_SCOPE_ENV)
  assert.equal(parseWatchScopeArgs(['--watch-all']).mode, WATCH_SCOPE_ALL)
  assert.equal(parseWatchScopeArgs(['--watch=bogus']).mode, undefined)
})

test('parseWatchScopeArgs reads explicit package list and popular limit', () => {
  const parsed = parseWatchScopeArgs(['--watch-packages=core,ui', '--watch-popular-limit=3'])
  assert.deepEqual(parsed.packages, ['core', 'ui'])
  assert.equal(parsed.mode, WATCH_SCOPE_ENV)
  assert.equal(parsed.popularLimit, 3)
})

test('resolveWatchScope: argv mode wins over env, defaults to all', () => {
  assert.equal(resolveWatchScope({ env: {}, argv: [] }).mode, WATCH_SCOPE_ALL)
  assert.equal(resolveWatchScope({ env: { OM_WATCH_SCOPE: 'popular' }, argv: [] }).mode, WATCH_SCOPE_POPULAR)
  assert.equal(
    resolveWatchScope({ env: { OM_WATCH_SCOPE: 'popular' }, argv: ['--watch=auto'] }).mode,
    WATCH_SCOPE_AUTO,
  )
})

test('resolveWatchScope: git toggles and base ref', () => {
  const cfg = resolveWatchScope({ env: { OM_WATCH_GIT_STATUS: 'off', OM_WATCH_BASE_REF: 'origin/main' }, argv: [] })
  assert.equal(cfg.gitStatusEnabled, false)
  assert.equal(cfg.gitBranchEnabled, true)
  assert.equal(cfg.baseRef, 'origin/main')
})

test('matchPackagesByLabels matches short labels and scoped/unscoped names', () => {
  const packages = makePackages()
  assert.deepEqual(matchPackagesByLabels(packages, ['core', 'UI']).map((p) => p.shortLabel), ['core', 'ui'])
  assert.deepEqual(matchPackagesByLabels(packages, ['@open-mercato/shared']).map((p) => p.shortLabel), ['shared'])
  assert.deepEqual(matchPackagesByLabels(packages, ['missing']), [])
})

test('mapChangedPathsToPackages maps repo-relative paths to owning packages', () => {
  const packages = makePackages()
  const changed = [
    'packages/core/src/modules/auth/index.ts',
    'packages/ui/src/backend/CrudForm.tsx',
    'apps/mercato/src/app/page.tsx',
  ]
  assert.deepEqual(
    mapChangedPathsToPackages(packages, ROOT, changed).map((p) => p.shortLabel).sort(),
    ['core', 'ui'],
  )
})

test('detectTouchedPackages merges working-tree status and branch diff', () => {
  const packages = makePackages()
  const runGit = (root, args) => {
    if (args[0] === 'status') return ' M packages/core/src/index.ts\n?? packages/ui/src/new.ts\n'
    if (args[0] === 'rev-parse') return 'origin/develop\n'
    if (args[0] === 'diff') return 'packages/shared/src/lib/util.ts\n'
    return ''
  }
  const touched = detectTouchedPackages({
    packages,
    root: ROOT,
    config: { gitStatusEnabled: true, gitBranchEnabled: true },
    runGit,
  }).map((p) => p.shortLabel).sort()
  assert.deepEqual(touched, ['core', 'shared', 'ui'])
})

test('detectTouchedPackages handles rename arrows and missing base ref', () => {
  const packages = makePackages()
  const runGit = (root, args) => {
    if (args[0] === 'status') return 'R  packages/core/src/old.ts -> packages/ui/src/new.ts\n'
    if (args[0] === 'rev-parse') return ''
    return ''
  }
  const touched = detectTouchedPackages({ packages, root: ROOT, config: {}, runGit })
    .map((p) => p.shortLabel)
  assert.deepEqual(touched, ['ui'])
})

test('resolvePopularPackages ranks by git log frequency', () => {
  const packages = makePackages()
  const runGit = (root, args) => {
    if (args[0] === 'log') {
      return [
        'packages/ui/src/a.ts',
        'packages/ui/src/b.ts',
        'packages/ui/src/c.ts',
        'packages/core/src/a.ts',
        'packages/core/src/b.ts',
        'packages/search/src/a.ts',
      ].join('\n')
    }
    return ''
  }
  const ranked = resolvePopularPackages({ packages, root: ROOT, limit: 2, runGit }).map((p) => p.shortLabel)
  assert.deepEqual(ranked, ['ui', 'core'])
})

test('resolvePopularPackages falls back to default popular set without git history', () => {
  const packages = makePackages()
  const ranked = resolvePopularPackages({ packages, root: ROOT, limit: 6, runGit: () => '' }).map((p) => p.shortLabel)
  assert.deepEqual(ranked.sort(), [...DEFAULT_POPULAR_PACKAGES].sort())
})

test('resolvePopularPackages honors an explicit override list', () => {
  const packages = makePackages()
  const ranked = resolvePopularPackages({ packages, root: ROOT, limit: 6, override: ['search'], runGit: () => '' })
    .map((p) => p.shortLabel)
  assert.deepEqual(ranked, ['search'])
})

test('persisted selection round-trips through .mercato/watch-packages.local.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-scope-'))
  try {
    assert.deepEqual(readPersistedSelection(dir), [])
    writePersistedSelection(dir, ['core', 'ui', 'core'])
    assert.deepEqual(readPersistedSelection(dir), ['core', 'ui'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('selectWatchedPackages: all mode returns everything and never auto-expands', () => {
  const packages = makePackages()
  const result = selectWatchedPackages({ packages, config: { mode: WATCH_SCOPE_ALL }, root: ROOT, runGit: () => '' })
  assert.equal(result.mode, WATCH_SCOPE_ALL)
  assert.equal(result.autoExpand, false)
  assert.equal(result.selected.length, packages.length)
})

test('selectWatchedPackages: env mode uses explicit list', () => {
  const packages = makePackages()
  const result = selectWatchedPackages({
    packages,
    config: { mode: WATCH_SCOPE_ENV, explicitPackages: ['core', 'shared'] },
    root: ROOT,
    runGit: () => '',
  })
  assert.deepEqual(result.selected.map((p) => p.shortLabel).sort(), ['core', 'shared'])
  assert.equal(result.autoExpand, false)
})

test('selectWatchedPackages: env mode with no matches falls back to all', () => {
  const packages = makePackages()
  const result = selectWatchedPackages({
    packages,
    config: { mode: WATCH_SCOPE_ENV, explicitPackages: ['nope'] },
    root: ROOT,
    runGit: () => '',
  })
  assert.equal(result.mode, WATCH_SCOPE_ALL)
  assert.equal(result.selected.length, packages.length)
})

test('selectWatchedPackages: auto mode marks autoExpand and uses touched packages', () => {
  const packages = makePackages()
  const runGit = (root, args) => {
    if (args[0] === 'status') return ' M packages/search/src/index.ts\n'
    if (args[0] === 'rev-parse') return ''
    return ''
  }
  const result = selectWatchedPackages({ packages, config: { mode: WATCH_SCOPE_AUTO }, root: ROOT, runGit })
  assert.equal(result.mode, WATCH_SCOPE_AUTO)
  assert.equal(result.autoExpand, true)
  assert.deepEqual(result.selected.map((p) => p.shortLabel), ['search'])
})

test('selectWatchedPackages: auto mode seeds when nothing is touched', () => {
  const packages = makePackages()
  const result = selectWatchedPackages({ packages, config: { mode: WATCH_SCOPE_AUTO }, root: ROOT, runGit: () => '' })
  assert.equal(result.autoExpand, true)
  assert.ok(result.selected.length > 0)
  assert.ok(result.selected.length <= packages.length)
})

test('AUTO_EXPAND_INTERVAL_MS is two minutes', () => {
  assert.equal(AUTO_EXPAND_INTERVAL_MS, 120000)
})

test('describeWatchMode returns emoji-decorated text for every known scope', () => {
  for (const mode of WATCH_SCOPES) {
    const described = describeWatchMode(mode)
    const { emoji, label } = WATCH_SCOPE_DESCRIPTIONS[mode]
    assert.equal(described.mode, mode)
    assert.equal(described.emoji, emoji)
    assert.equal(described.label, label)
    assert.equal(described.text, `${emoji} ${mode} — ${label}`)
    assert.ok(described.text.startsWith(emoji))
  }
})

test('describeWatchMode falls back to the all description for unknown/empty modes', () => {
  const fallback = describeWatchMode('nonsense')
  assert.equal(fallback.mode, WATCH_SCOPE_ALL)
  assert.equal(fallback.emoji, WATCH_SCOPE_DESCRIPTIONS[WATCH_SCOPE_ALL].emoji)
  assert.deepEqual(describeWatchMode(undefined), fallback)
  assert.deepEqual(describeWatchMode(''), fallback)
})
