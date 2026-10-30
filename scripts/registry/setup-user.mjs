#!/usr/bin/env node

// Create a user for publishing to the local Verdaccio registry
// (cross-platform port of the former setup-user.sh; the .sh file remains as a
// thin wrapper).

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveNodeBundledCli, runCli } from '../lib/spawn-cli.mjs'

export async function setupRegistryUser({ env = process.env } = {}) {
  const registryUrl = (env.VERDACCIO_URL || 'http://localhost:4873').replace(/\/+$/, '')

  let reachable = false
  try {
    reachable = (await fetch(`${registryUrl}/-/ping`, { signal: AbortSignal.timeout(5_000) })).ok
  } catch {
    reachable = false
  }
  if (!reachable) {
    console.error(`Error: Verdaccio registry is not running at ${registryUrl}`)
    console.error("Run 'docker compose up -d verdaccio' first")
    return 1
  }

  const npm = resolveNodeBundledCli('npm')
  if (!npm) {
    console.error('registry:setup-user: could not resolve the npm CLI next to the Node executable.')
    return 1
  }
  return runCli(npm, ['adduser', '--registry', registryUrl]) ? 0 : 1
}

const isEntryPoint = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  setupRegistryUser().then((code) => {
    process.exitCode = code
  })
}
