#!/usr/bin/env node
/**
 * Guard: Awilix CLASSIC-mode `asFunction` registrations must still wire up in
 * BUILT output.
 *
 * Runs over `packages/*&#47;dist`, not over `src`. That is the entire point — the
 * parameter names CLASSIC injection resolves by are rewritten during the build,
 * so source and Jest agree that a registration is fine while the published
 * package throws. See scripts/lib/classic-di-injection.mjs for the mechanism.
 *
 * Requires `yarn build:packages` first; a missing dist is a failure rather than
 * a skip, so the gate cannot report green without having inspected anything.
 *
 * Usage:
 *   node scripts/check-classic-di-injection.mjs
 *
 * Yarn shortcut: `yarn check:classic-di-injection`
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { analyzeFile, collectRegisteredKeys } from './lib/classic-di-injection.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages')

/**
 * DI keys that no `as*()` call registers literally, so the scan cannot see
 * them. Each must name the mechanism that supplies it.
 */
const DYNAMIC_KEYS = new Map([
  // Replayed onto every request container from the bootstrap cache as
  // `asValue`, keyed by a variable rather than a literal.
  ['eventBus', 'bootstrap cache replay in lib/di/container.ts'],
])

function collectDistFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectDistFiles(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function main() {
  if (!fs.existsSync(PACKAGES_DIR)) {
    console.error('[classic-di-injection] packages/ not found')
    process.exit(1)
  }

  const builtPackages = []
  const unbuiltPackages = []
  for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packageDir = path.join(PACKAGES_DIR, entry.name)
    if (!fs.existsSync(path.join(packageDir, 'package.json'))) continue
    const distDir = path.join(packageDir, 'dist')
    if (fs.existsSync(distDir)) builtPackages.push({ name: entry.name, distDir })
    else unbuiltPackages.push(entry.name)
  }

  const files = []
  for (const pkg of builtPackages) {
    for (const file of collectDistFiles(pkg.distDir)) {
      const source = fs.readFileSync(file, 'utf8')
      // Keep every file that registers ANYTHING: a key this scan must know
      // about may be registered with a resolver kind other than asFunction
      // (audit_logs registers `actionLogService` with asClass alone).
      if (!/\b(?:asFunction|asValue|asClass|aliasTo)\s*\(/.test(source)) continue
      files.push({ file, source })
    }
  }

  const knownKeys = new Set(DYNAMIC_KEYS.keys())
  for (const { source } of files) {
    for (const key of collectRegisteredKeys(source)) knownKeys.add(key)
  }

  const inspected = files.filter(({ source }) => source.includes('asFunction('))
  if (inspected.length === 0) {
    console.error(
      '[classic-di-injection] no built asFunction registration found. ' +
        'Run `yarn build:packages` first — this guard reads packages/*/dist, ' +
        'because the defect it looks for exists only after bundling.',
    )
    if (unbuiltPackages.length > 0) {
      console.error(`[classic-di-injection] packages without dist/: ${unbuiltPackages.join(', ')}`)
    }
    process.exit(1)
  }

  const violations = []
  for (const { file, source } of inspected) {
    violations.push(...analyzeFile({ file: path.relative(REPO_ROOT, file), source, knownKeys }))
  }

  if (violations.length > 0) {
    console.error(`[classic-di-injection] ${violations.length} violation(s) in built output:\n`)
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`)
      console.error(`    ${violation.message}\n`)
    }
    process.exit(1)
  }

  console.log(
    `[classic-di-injection] OK — ${inspected.length} built file(s), ` +
      `${knownKeys.size} registered DI key(s), no unresolvable parameter names.`,
  )
}

main()
