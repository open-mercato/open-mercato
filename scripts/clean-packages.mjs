#!/usr/bin/env node

// Clean all node_modules, dist, and build artifacts from the entire monorepo
// (cross-platform port of the former clean-packages.sh; the .sh file remains
// as a thin wrapper).

import { realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeCleanTargets, removePath } from './lib/clean-utils.mjs'

export function cleanPackages(rootDir, log = console.log) {
  log('Cleaning node_modules, dist, and build artifacts...')
  removeCleanTargets(rootDir, {
    dirNames: ['node_modules', 'dist'],
    fileSuffixes: ['.tsbuildinfo'],
    skipDirNames: ['.git'],
  })
  removePath(join(rootDir, '.yarn', 'cache'))
  removePath(join(rootDir, '.yarn', 'install-state.gz'))
  log('Done! All node_modules, dist, and .tsbuildinfo files removed.')
  log("Run 'yarn install' to reinstall dependencies.")
}

const isEntryPoint = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  cleanPackages(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
}
