#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const requestedRoot = process.argv[2]
const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: requestedRoot ? path.resolve(requestedRoot) : packageRoot,
  encoding: 'utf8',
}).trim()
const isShallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim() === 'true'

if (isShallow) {
  execFileSync('git', ['fetch', '--no-tags', '--unshallow', 'origin'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
}
