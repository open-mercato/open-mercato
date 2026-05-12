#!/usr/bin/env node
// `yarn official-modules` — inspect and change which official modules are activated.
//
// Usage:
//   yarn official-modules                 Show status (available / activated) and usage.
//   yarn official-modules list            Same as no args.
//   yarn official-modules add <m...>      Activate one or more modules.
//   yarn official-modules remove <m...>   Deactivate one or more modules.
//   yarn official-modules set <m...>      Replace the activation set (no args clears it).
//   yarn official-modules sync            Re-init the submodule and regenerate, no changes.
//
// Flags:
//   --local   Write to official-modules.local.json (personal, gitignored) instead of
//             official-modules.json (committed team default).
//
// After any mutation it runs scripts/official-modules-setup.mjs to fetch/refresh the
// submodule and regenerate apps/mercato/src/official-modules.generated.ts.

import { execFileSync } from 'node:child_process'
import path from 'node:path'

import {
  repoRoot,
  readConfig,
  scanAvailable,
  writeConfig,
  writeLocalActivated,
  moduleId,
  packageName,
} from './lib/official-modules.mjs'

function out(message = '') {
  process.stdout.write(`${message}\n`)
}

function runSetup() {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'official-modules-setup.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

function printStatus() {
  const config = readConfig()
  const absSubmodule = path.join(repoRoot, config.path)
  const available = config.available.length ? config.available : scanAvailable(absSubmodule)
  out(`Submodule: ${config.repo} (branch ${config.branch}) -> ${config.path}`)
  out('')
  if (available.length === 0) {
    out('Available modules: (submodule not initialized yet — run `yarn official-modules sync`)')
  } else {
    out('Available modules:')
    for (const suffix of available) {
      const mark = config.activated.includes(suffix) ? '*' : ' '
      out(`  [${mark}] ${suffix}  ->  module "${moduleId(suffix)}" from ${packageName(suffix)}`)
    }
  }
  out('')
  out(`Activated (committed):  ${config.activatedBase.join(', ') || '(none)'}`)
  out(`Activated (local):      ${config.activatedLocal.join(', ') || '(none)'}`)
  out('')
  out('Change with: yarn official-modules add <module> [--local]')
  out('             yarn official-modules remove <module> [--local]')
}

function applyChange(kind, modules, useLocal) {
  const config = readConfig()
  const base = useLocal ? config.activatedLocal : config.activatedBase
  let next
  if (kind === 'add') next = [...new Set([...base, ...modules])]
  else if (kind === 'remove') next = base.filter((suffix) => !modules.includes(suffix))
  else next = [...new Set(modules)] // set

  // Validate against available modules when we know them.
  const available = config.available.length ? config.available : scanAvailable(path.join(repoRoot, config.path))
  if (available.length > 0) {
    const unknown = next.filter((suffix) => !available.includes(suffix))
    if (unknown.length > 0) {
      out(`Unknown module(s): ${unknown.join(', ')}`)
      out(`Available: ${available.join(', ') || '(none)'}`)
      process.exit(1)
    }
  }

  if (useLocal) writeLocalActivated(next)
  else writeConfig({ activated: next })

  out(`${useLocal ? 'official-modules.local.json' : 'official-modules.json'} activated -> ${next.join(', ') || '(none)'}`)
  runSetup()
}

const args = process.argv.slice(2)
const useLocal = args.includes('--local')
const positional = args.filter((arg) => arg !== '--local')
const command = positional[0]
const rest = positional.slice(1)

switch (command) {
  case undefined:
  case 'list':
  case 'status':
    printStatus()
    break
  case 'sync':
    runSetup()
    break
  case 'add':
  case 'remove':
  case 'set':
    if (command !== 'set' && rest.length === 0) {
      out(`Specify at least one module: yarn official-modules ${command} <module>`)
      process.exit(1)
    }
    applyChange(command, rest, useLocal)
    break
  default:
    out(`Unknown command: ${command}`)
    out('Run `yarn official-modules` for usage.')
    process.exit(1)
}
