/**
 * PR-path guard for the release-time version-alignment gate.
 *
 * `scripts/check-version-alignment.sh` asserts that every public `packages/*` manifest and every
 * `apps/*` manifest carries the monorepo version, and it is load-bearing at release time and
 * nowhere else:
 * `scripts/bump-version.sh:17` and `:37`, `scripts/release-existing.sh:13`, and
 * `.github/workflows/release.yml:78`. No PR-triggered workflow invoked it, so a misaligned
 * workspace passed CI and first failed days later at the release's very first gate, detached
 * from the merge that caused it (#5018).
 *
 * The drift is not a slip but a property of the branching model: a workspace added on `develop`
 * between two releases does not exist on `main` at the release commit, so the release bump never
 * touches it and the next `main` → `develop` sync has nothing to reconcile. That is how
 * `@open-mercato/telemetry` stayed at `0.6.6` while everything else moved to `0.6.7` (#5014),
 * and it will recur the next time a package is introduced mid-cycle. For telemetry the blast
 * radius reached past the gate: `packages/create-app` pins template dependencies to
 * `{{PACKAGE_VERSION}}` (`packages/create-app/AGENTS.md`), so a package out of lockstep makes a
 * fresh scaffold's `yarn install` fail with "No candidates found" — as at `0.6.3` vs `0.6.5`
 * (`.ai/specs/2026-04-29-telemetry-and-otel.md`).
 *
 * This lives in `scripts/__tests__/` rather than in `REPO_WIDE_GUARDS` deliberately. CI runs
 * `yarn test:scripts` unconditionally and unfiltered (`.github/workflows/ci.yml:628`), outside
 * the `--filter=[base]...` scoping that selects packages by dependency graph and would skip a
 * version-only `package.json` edit entirely; `ci.yml:666` already names `yarn test:scripts`
 * among the guards that "already run unfiltered". `scripts/repo-wide-guards.mjs` is a
 * jest-per-workspace runner whose enumeration honesty check only scans `/\.test\.tsx?$/`, so an
 * `.mjs` script test has no place in it.
 *
 * The comparison is reimplemented here in plain Node so the guard needs no `jq` or `bash` on the
 * common PR path. The last test pins the shell script's scope so the two cannot silently desync.
 */

import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')
const packagesDir = path.join(rootDir, 'packages')
const appsDir = path.join(rootDir, 'apps')
const referenceManifest = path.join(packagesDir, 'shared', 'package.json')
const alignmentScript = path.join(rootDir, 'scripts', 'check-version-alignment.sh')

async function readManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function readPublicPackages() {
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const packages = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const manifest = await readManifest(path.join(packagesDir, entry.name, 'package.json'))
    if (!manifest || manifest.private === true) continue

    packages.push({ dir: entry.name, name: manifest.name, version: manifest.version })
  }

  return packages
}

async function readAppWorkspaces() {
  const entries = await readdir(appsDir, { withFileTypes: true })
  const apps = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const manifest = await readManifest(path.join(appsDir, entry.name, 'package.json'))
    if (!manifest) continue

    apps.push({ dir: entry.name, name: manifest.name, version: manifest.version })
  }

  return apps
}

test('every public package is aligned with the monorepo version', async () => {
  const reference = await readManifest(referenceManifest)
  assert.ok(reference, 'packages/shared/package.json is the reference manifest and must exist')

  const publicPackages = await readPublicPackages()
  assert.ok(
    publicPackages.some((pkg) => pkg.name === reference.name),
    `Expected the scan to reach the reference workspace ${reference.name}. A scan that silently ` +
      'stopped finding manifests would report alignment over nothing at all',
  )

  const mismatched = publicPackages
    .filter((pkg) => pkg.version !== reference.version)
    .map((pkg) => `${pkg.name}@${pkg.version} (expected ${reference.version})`)

  assert.deepEqual(
    mismatched,
    [],
    `Not aligned with the monorepo version (${reference.version}) from packages/shared/package.json. ` +
      'Fix their package.json versions — otherwise the next release fails at its first gate.',
  )
})

test('every app workspace is aligned with the monorepo version', async () => {
  const reference = await readManifest(referenceManifest)
  const apps = await readAppWorkspaces()

  assert.ok(
    apps.some((app) => app.dir === 'mercato'),
    'Expected the scan to reach apps/mercato. A scan that silently stopped finding manifests ' +
      'would report alignment over nothing at all',
  )

  const mismatched = apps
    .filter((app) => app.version !== reference.version)
    .map((app) => `${app.name}@${app.version} (expected ${reference.version})`)

  assert.deepEqual(
    mismatched,
    [],
    `Not aligned with the monorepo version (${reference.version}) from packages/shared/package.json. ` +
      'apps/* are private so `yarn workspaces foreach --no-private version` never touches them; ' +
      'scripts/bump-version.sh syncs them explicitly instead.',
  )
})

test('the root manifest carries the monorepo version too', async () => {
  const reference = await readManifest(referenceManifest)
  const root = await readManifest(path.join(rootDir, 'package.json'))
  assert.ok(root, 'The root package.json is the reference for the release-time bump and must exist')

  assert.equal(
    root.version,
    reference.version,
    'scripts/bump-version.sh and scripts/release-existing.sh also check alignment with ' +
      '`--reference package.json`, so the root manifest must move with the packages',
  )
})

test('the release-time gate still declares the scope this guard mirrors', async () => {
  const script = await readFile(alignmentScript, 'utf8')

  assert.match(
    script,
    /REFERENCE_FILE="packages\/shared\/package\.json"/,
    'This guard compares against packages/shared/package.json because that is the script default',
  )
  assert.match(
    script,
    /find packages -maxdepth 2 -name package\.json/,
    'This guard scans the direct children of packages/ because that is the script scope',
  )
  assert.match(
    script,
    /\.private != true/,
    'This guard skips private manifests because the script does — packages/eslint-plugin-ds ' +
      'is versioned independently',
  )
  assert.match(
    script,
    /find apps -maxdepth 2 -name package\.json/,
    'This guard scans the direct children of apps/ because that is the script scope. apps/* are ' +
      'private but ship as the release app shell, so they are checked without the private filter',
  )
})

test('the bump script moves the app workspaces too', async () => {
  const script = await readFile(path.join(rootDir, 'scripts', 'bump-version.sh'), 'utf8')

  assert.match(
    script,
    /find apps -maxdepth 2 -name package\.json/,
    '`yarn workspaces foreach --no-private version` skips apps/* because they are private, so ' +
      'scripts/bump-version.sh must sync them explicitly — otherwise the alignment gate above ' +
      'fails on the very release PR that is supposed to fix it',
  )
})
