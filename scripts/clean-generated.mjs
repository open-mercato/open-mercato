#!/usr/bin/env node

// Clean all generated files and directories (cross-platform port of the
// former clean-generated.sh; the .sh file remains as a thin wrapper):
// - .mercato folder in Next.js apps
// - generated/ folders in packages
// - .turbo cache folders
// - .next build folders
// - dist build folders
//
// Anything under node_modules/ is left alone (clean:packages owns it).

import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeCleanTargets } from './lib/clean-utils.mjs'

export function cleanGenerated(rootDir, log = console.log) {
  log('Cleaning generated files...')
  removeCleanTargets(rootDir, {
    dirNames: ['.mercato', 'generated', '.turbo', '.next', 'dist'],
    skipDirNames: ['node_modules', '.git'],
  })
  log('Done! Cleaned: .mercato, generated/, .turbo, .next, dist/')
}

const isEntryPoint = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  cleanGenerated(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
}
