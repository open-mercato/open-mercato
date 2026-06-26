#!/usr/bin/env node
// Interactive picker for the dev-mode watch scope.
//
// Lists the discoverable workspace packages and lets the developer choose which
// ones the consolidated watcher should track. The selection is persisted to
// `.mercato/watch-packages.local.json` (gitignored) and consumed by the `env`
// scope (`OM_WATCH_SCOPE=env`). Run it with `yarn dev:watch-select`, then start
// dev with `yarn dev --watch=env`.
//
// The selection-parsing logic is factored into `parseSelectionInput` so it can
// be unit-tested without a TTY.

import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { discoverWatchTargets, writePersistedSelection, persistedSelectionPath } from './watch-scope.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const defaultRepoRoot = join(here, '..')

// Parse a developer's selection answer against the ordered package list.
// Accepts: comma/space-separated 1-based indexes, short labels, `all`, or an
// empty answer (treated as "keep all"). Returns the matched short labels in
// list order, deduped. Unknown tokens are ignored.
export function parseSelectionInput(input, packages) {
  const labels = packages.map((pkg) => pkg.shortLabel)
  const trimmed = String(input ?? '').trim().toLowerCase()
  if (!trimmed || trimmed === 'all' || trimmed === '*') return [...labels]

  const byLabel = new Map(labels.map((label) => [label.toLowerCase(), label]))
  const selected = new Set()
  for (const token of trimmed.split(/[\s,]+/)) {
    if (!token) continue
    const asIndex = Number.parseInt(token, 10)
    if (String(asIndex) === token && asIndex >= 1 && asIndex <= labels.length) {
      selected.add(labels[asIndex - 1])
      continue
    }
    const matched = byLabel.get(token)
    if (matched) selected.add(matched)
  }
  return labels.filter((label) => selected.has(label))
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function main() {
  const root = defaultRepoRoot
  const packages = discoverWatchTargets(root)
  if (packages.length === 0) {
    console.error('[watch-select] no workspace packages with a `watch` script and `src/` directory were found')
    process.exitCode = 1
    return
  }

  if (!process.stdin.isTTY) {
    console.error('[watch-select] interactive selection requires a TTY. Set OM_WATCH_PACKAGES=<list> instead, e.g. OM_WATCH_PACKAGES=core,ui yarn dev --watch=env')
    process.exitCode = 1
    return
  }

  console.log('Select which workspace packages the dev watcher should track:\n')
  packages.forEach((pkg, index) => {
    console.log(`  ${String(index + 1).padStart(2, ' ')}. ${pkg.shortLabel}  (${pkg.name})`)
  })
  console.log('\nEnter numbers and/or names separated by spaces/commas. Press Enter to keep all.')

  const answer = await ask('> ')
  const selectedLabels = parseSelectionInput(answer, packages)

  if (selectedLabels.length === packages.length) {
    console.log('\nKeeping all packages watched. Start dev normally (or with --watch=all).')
  }

  const file = writePersistedSelection(root, selectedLabels)
  console.log(`\nSaved ${selectedLabels.length} package(s) to ${file}`)
  console.log('Watched: ' + selectedLabels.join(', '))
  console.log('\nNow run:  yarn dev --watch=env')
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[watch-select] failed: ${error?.message ?? error}`)
    process.exitCode = 1
  })
}

export { persistedSelectionPath }
