#!/usr/bin/env node
// Hybrid start: bring the infra containers up (idempotent), then run
// `yarn dev` in the foreground — which starts the app runtime, queue workers,
// scheduler, AND the MCP server on this machine. Ctrl+C stops the host
// processes; the infra containers keep running for fast restarts.
//
// Usage: node starters/lib/start.mjs [--no-infra] [-- <extra yarn dev args>]
import { detectDocker, resolveRepoRoot, spawnStreaming } from './compose.mjs'
import { infraUp } from './infra.mjs'

const args = process.argv.slice(2)
const repoRoot = resolveRepoRoot()

if (!args.includes('--no-infra')) {
  const docker = detectDocker()
  if (!docker.ok) {
    console.error(`❌ Docker is not available (${docker.reason}). Start your container runtime and re-run, or pass --no-infra to skip the infra containers.`)
    process.exit(2)
  }
  const status = infraUp(repoRoot, { build: false })
  if (status !== 0) {
    console.error('❌ Infra containers failed to start — see the output above.')
    process.exit(status)
  }
}

const separatorIndex = args.indexOf('--')
const devArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1)

console.log('')
console.log('Starting the dev runtime (app + MCP server). Ctrl+C stops it; the infra containers keep running.')
console.log('Stop the containers later with: yarn infra:down  (or starters/hybrid/stop.sh)')
console.log('')

const child = spawnStreaming('yarn', ['dev', ...devArgs], { cwd: repoRoot })
child.on('close', (code) => process.exit(code ?? 0))
child.on('error', (error) => {
  console.error(`❌ Could not start yarn dev: ${error.message}`)
  process.exit(1)
})
