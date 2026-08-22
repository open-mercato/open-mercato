#!/usr/bin/env node
/**
 * Published-package peer-dependency checker.
 *
 * A published workspace package must ship every non-optional peer dependency its own
 * runtime dependencies demand, either in `dependencies` or in its own `peerDependencies`.
 * Inside this monorepo an unmet peer is invisible: yarn hoists the package's
 * `devDependencies` into one shared `node_modules`, so `yarn build:app` resolves it and
 * every check stays green. A standalone app scaffolded from npm installs only
 * `dependencies` + `peerDependencies`, so the same import fails there — and because no PR
 * job builds a standalone app, the break only surfaces post-merge in the snapshot
 * workflow's `Standalone App Integration Tests`.
 *
 * That is exactly how `@open-mercato/documents` shipped `@tiptap/html` (which peer-requires
 * `happy-dom`) with `happy-dom` in `devDependencies`, leaving every standalone build after
 * it failing on `Module not found: Can't resolve 'happy-dom'`.
 *
 * Pre-existing unmet peers are pinned in `scripts/package-peer-deps-allowlist.json` so the
 * gate blocks NEW ones without demanding an unrelated cleanup first. Each allowlist entry
 * carries the reason it is accepted.
 *
 * Usage:
 *   node scripts/check-package-peer-deps.mjs            # check (exit 1 on failure)
 *   node scripts/check-package-peer-deps.mjs --json     # machine-readable report
 *   node scripts/check-package-peer-deps.mjs --update-allowlist
 *
 * Yarn shortcut: `yarn packages:check-peer-deps`
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..')
const ALLOWLIST_RELATIVE_PATH = path.join('scripts', 'package-peer-deps-allowlist.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readPackageManifest(dir) {
  const manifestPath = path.join(dir, 'package.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    return readJson(manifestPath)
  } catch {
    return null
  }
}

/**
 * Resolve an installed dependency's manifest. Only the hoisted root `node_modules` and the
 * package's own nested `node_modules` are consulted — a dependency the linker never placed
 * cannot be inspected, and is skipped rather than reported, so this gate never fails for a
 * reason that is really an incomplete install.
 */
function resolveInstalledManifest(root, packageDir, depName) {
  const candidates = [
    path.join(packageDir, 'node_modules', depName),
    path.join(root, 'node_modules', depName),
  ]
  for (const candidate of candidates) {
    const manifest = readPackageManifest(candidate)
    if (manifest) return manifest
  }
  return null
}

function collectViolations(root) {
  const violations = []
  const packagesDir = path.join(root, 'packages')
  if (!fs.existsSync(packagesDir)) return violations
  const packageDirs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name))

  for (const packageDir of packageDirs) {
    const manifest = readPackageManifest(packageDir)
    if (!manifest || manifest.private || !manifest.name) continue

    const shipped = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])

    for (const depName of Object.keys(manifest.dependencies ?? {})) {
      const depManifest = resolveInstalledManifest(root, packageDir, depName)
      if (!depManifest) continue
      const peerMeta = depManifest.peerDependenciesMeta ?? {}
      for (const peerName of Object.keys(depManifest.peerDependencies ?? {})) {
        if (peerMeta[peerName]?.optional) continue
        if (shipped.has(peerName)) continue
        violations.push({
          package: manifest.name,
          dependency: depName,
          peer: peerName,
          declaredAsDevDependency: Boolean(manifest.devDependencies?.[peerName]),
        })
      }
    }
  }

  return violations.sort((left, right) =>
    `${left.package}|${left.dependency}|${left.peer}`.localeCompare(
      `${right.package}|${right.dependency}|${right.peer}`,
    ),
  )
}

function violationKey(violation) {
  return `${violation.package} -> ${violation.dependency} -> ${violation.peer}`
}

function parseRoot(argv) {
  const index = argv.indexOf('--root')
  if (index === -1 || !argv[index + 1]) return DEFAULT_ROOT
  return path.resolve(argv[index + 1])
}

function main() {
  const argv = process.argv.slice(2)
  const asJson = argv.includes('--json')
  const updateAllowlist = argv.includes('--update-allowlist')
  const root = parseRoot(argv)
  const allowlistPath = path.join(root, ALLOWLIST_RELATIVE_PATH)

  const violations = collectViolations(root)
  const allowlist = fs.existsSync(allowlistPath) ? readJson(allowlistPath) : { version: 1, accepted: {} }
  const accepted = allowlist.accepted ?? {}

  if (updateAllowlist) {
    const nextAccepted = {}
    for (const violation of violations) {
      const key = violationKey(violation)
      nextAccepted[key] = accepted[key] ?? 'Pre-existing; provided by the host application at install time'
    }
    fs.writeFileSync(
      allowlistPath,
      `${JSON.stringify({ ...allowlist, accepted: nextAccepted }, null, 2)}\n`,
      'utf8',
    )
    process.stdout.write(`Allowlist updated with ${Object.keys(nextAccepted).length} entries.\n`)
    return
  }

  const unexpected = violations.filter((violation) => !(violationKey(violation) in accepted))
  const stale = Object.keys(accepted).filter(
    (key) => !violations.some((violation) => violationKey(violation) === key),
  )

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ violations, unexpected, stale }, null, 2)}\n`)
  }

  if (unexpected.length > 0) {
    if (!asJson) {
      process.stderr.write('Unmet peer dependencies in published packages:\n\n')
      for (const violation of unexpected) {
        const hint = violation.declaredAsDevDependency
          ? ' (declared as a devDependency — move it to dependencies)'
          : ''
        process.stderr.write(
          `  ${violation.package}: dependency "${violation.dependency}" requires peer "${violation.peer}"${hint}\n`,
        )
      }
      process.stderr.write(
        '\nA standalone app installs only dependencies + peerDependencies, so an unmet peer breaks its build\n'
        + 'while the monorepo stays green. Declare the peer in the package, or record a reason in\n'
        + `${path.relative(root, allowlistPath)}.\n`,
      )
    }
    process.exitCode = 1
    return
  }

  if (stale.length > 0 && !asJson) {
    process.stdout.write(`Allowlist has ${stale.length} entr${stale.length === 1 ? 'y' : 'ies'} that no longer apply:\n`)
    for (const key of stale) process.stdout.write(`  ${key}\n`)
    process.stdout.write('Run `yarn packages:check-peer-deps --update-allowlist` to prune them.\n')
  }

  if (!asJson) {
    process.stdout.write(`Peer dependencies OK (${violations.length} allowlisted).\n`)
  }
}

main()
