#!/usr/bin/env node
// Hybrid stop: stop the infra containers (data is preserved in named volumes).
// `yarn dev` is a foreground process — stop it with Ctrl+C in its terminal.
//
// Usage: node starters/lib/stop.mjs [--volumes --yes]
import { detectDocker, resolveRepoRoot } from './compose.mjs'
import { infraDown } from './infra.mjs'

const args = process.argv.slice(2)
const volumes = args.includes('--volumes')

if (volumes && !args.includes('--yes')) {
  console.error('❌ --volumes DELETES all database/search data. Re-run with --yes to confirm.')
  process.exit(1)
}

const docker = detectDocker()
if (!docker.ok) {
  console.error(`❌ Docker is not available (${docker.reason}) — nothing to stop.`)
  process.exit(2)
}

const status = infraDown(resolveRepoRoot(), { volumes })
if (status === 0) {
  console.log(volumes
    ? '✅ Infra containers stopped and volumes deleted.'
    : '✅ Infra containers stopped (data preserved in volumes). Start again with: yarn infra:up')
}
process.exit(status)
