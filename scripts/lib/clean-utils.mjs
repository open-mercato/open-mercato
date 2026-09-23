// Shared sweep logic for the cross-platform clean scripts
// (scripts/clean-generated.mjs and scripts/clean-packages.mjs).

import { lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

// Walk the tree like `find` without -L: never follow or match symlinks (on
// Windows that includes the junctions install-skills.mjs writes). Matched
// directories are collected whole and not descended into.
export function collectCleanTargets(rootDir, { dirNames = [], fileSuffixes = [], skipDirNames = [] } = {}) {
  const dirNameSet = new Set(dirNames)
  const skipSet = new Set(skipDirNames)
  const directories = []
  const files = []

  const walk = (directory) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const candidate = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (skipSet.has(entry.name)) continue
        if (dirNameSet.has(entry.name)) {
          directories.push(candidate)
          continue
        }
        walk(candidate)
      } else if (entry.isFile() && fileSuffixes.some((suffix) => entry.name.endsWith(suffix))) {
        files.push(candidate)
      }
    }
  }

  walk(rootDir)
  return { directories, files }
}

export function removePath(path) {
  const entry = lstatSync(path, { throwIfNoEntry: false })
  if (!entry) return
  if (entry.isDirectory() && !entry.isSymbolicLink()) {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } else {
    unlinkSync(path)
  }
}

export function removeCleanTargets(rootDir, options) {
  const { directories, files } = collectCleanTargets(rootDir, options)
  for (const directory of directories) removePath(directory)
  for (const file of files) removePath(file)
  return { directories, files }
}
