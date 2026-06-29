#!/usr/bin/env node
// Postinstall worker for the official-modules submodule.
//
// Behaviour:
//   - No-op when not inside a git work-tree, or when nothing is activated and the
//     submodule is not present (keeps vanilla clones and CI untouched).
//   - When modules are activated: registers the submodule (first run), inits it to the
//     committed pointer, refreshes `available`, validates the activation set, and
//     regenerates apps/mercato/src/official-modules.generated.ts.
//
// This script never throws — any unexpected failure degrades to a logged skip.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  repoRoot,
  readConfig,
  scanAvailable,
  writeConfig,
  writeGenerated,
} from './lib/official-modules.mjs'

const TAG = '[official-modules]'
function log(message) {
  process.stdout.write(`${TAG} ${message}\n`)
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}

function isGitWorkTree() {
  try {
    return git(['rev-parse', '--is-inside-work-tree']) === 'true'
  } catch {
    return false
  }
}

function submoduleRegistered(submodulePath) {
  const gitmodules = path.join(repoRoot, '.gitmodules')
  if (!fs.existsSync(gitmodules)) return false
  return fs.readFileSync(gitmodules, 'utf8').includes(`path = ${submodulePath}`)
}

function run() {
  if (process.env.OM_SKIP_OFFICIAL_MODULES_SETUP === '1') return
  if (!isGitWorkTree()) return

  const config = readConfig()
  const submodulePath = config.path
  const absSubmodule = path.join(repoRoot, submodulePath)
  const activated = config.activated
  const registered = submoduleRegistered(submodulePath)
  const present = fs.existsSync(path.join(absSubmodule, 'packages'))

  // Nothing to do: no activation requested and the submodule isn't checked out.
  if (activated.length === 0 && !registered && !present) {
    writeGenerated([])
    return
  }

  let fetchedNew = false

  if (activated.length > 0) {
    if (!registered) {
      log(`registering submodule ${submodulePath} -> ${config.repo}`)
      try {
        git(['submodule', 'add', '-b', config.branch, config.repo, submodulePath])
        fetchedNew = true
      } catch (error) {
        const first = String((error && error.message) || error).split('\n')[0]
        log(`could not add submodule automatically (${first}).`)
        log(`run manually: git submodule add -b ${config.branch} ${config.repo} ${submodulePath}`)
      }
    } else if (!present) {
      log(`initializing submodule ${submodulePath}`)
      try {
        git(['submodule', 'update', '--init', '--recursive', submodulePath])
        fetchedNew = true
      } catch (error) {
        const first = String((error && error.message) || error).split('\n')[0]
        log(`could not init submodule (${first}). Run: git submodule update --init ${submodulePath}`)
      }
    }
  } else if (registered && !present) {
    // Submodule registered but empty — restore it (cheap, checks out the pinned pointer).
    try {
      git(['submodule', 'update', '--init', '--recursive', submodulePath])
    } catch {
      /* ignore */
    }
  }

  const available = scanAvailable(absSubmodule)
  writeConfig({ available })

  const unknown = activated.filter((suffix) => available.length > 0 && !available.includes(suffix))
  if (unknown.length > 0) {
    log(`WARNING: activated modules not found under ${submodulePath}/packages: ${unknown.join(', ')}`)
  }

  writeGenerated(activated)

  if (activated.length > 0) {
    log(`activated: ${activated.join(', ')}`)
  }
  if (fetchedNew) {
    log('official-module packages were just fetched — run `yarn install` once more so Yarn links them as workspaces.')
  }
  if (activated.length > 0) {
    log('module set changed — run `yarn mercato configs cache structural --all-tenants` (and `yarn dev:reset` if Turbopack serves a stale chunk).')
  }
}

try {
  run()
} catch (error) {
  log(`skipped: ${String((error && error.message) || error)}`)
}
process.exit(0)
