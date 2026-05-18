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
//   yarn official-modules promote <id>    Move an in-repo module into the official-modules
//                                         submodule (dry run; add --apply). See
//                                         scripts/promote-to-official-module.mjs.
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

// Prefer a fresh scan of the checked-out submodule (so newly-created packages are
// visible immediately); fall back to the cached `available` list when it isn't present.
function resolveAvailable(config) {
  const scanned = scanAvailable(path.join(repoRoot, config.path))
  return scanned.length ? scanned : config.available
}

function printStatus() {
  const config = readConfig()
  const available = resolveAvailable(config)
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

  // Validate against a fresh scan of the submodule so brand-new packages are accepted.
  const available = resolveAvailable(config)
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

// `promote` is a thin pass-through to scripts/promote-to-official-module.mjs so its
// own flags (--apply, --as=, --keep-source, --committed) reach it untouched.
if (args[0] === 'promote') {
  const promoteArgs = args.slice(1)
  try {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'promote-to-official-module.mjs'), ...promoteArgs], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  } catch (error) {
    process.exit(typeof error?.status === 'number' ? error.status : 1)
  }
  process.exit(0)
}

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
