#!/usr/bin/env node
// Hybrid infra lifecycle: OpenCode + postgres/redis/meilisearch containers.
// Usage: node starters/lib/infra.mjs up [--no-build] [--profile <name>]
//        node starters/lib/infra.mjs down [--volumes --yes]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { detectDocker, resolveRepoRoot, runCompose } from './compose.mjs'

export function ensureMcpSharedDir(repoRoot) {
  // Pre-create the bind-mount source so dockerd never creates it root-owned
  // on native Linux (which would break host-side key provisioning).
  fs.mkdirSync(path.join(repoRoot, '.mercato', 'mcp-shared'), { recursive: true })
}

export function infraUp(repoRooot, { build = true, profiles = [] } = {}) {
  const repoRoot = repoRooot ?? resolveRepoRoot()
  ensureMcpSharedDir(repoRoot)
  const upArgs = []
  for (const profile of profiles) {
    upArgs.push('--profile', profile)
  }
  // --wait blocks on the postgres/redis/meilisearch healthchecks; opencode has
  // no healthcheck here and counts as started immediately (its entrypoint
  // waits for the host MCP server on its own).
  upArgs.push('up', '-d', ...(build ? ['--build'] : []), '--wait')
  return runCompose(repoRoot, upArgs).status ?? 1
}

export function infraDown(repoRoot, { volumes = false } = {}) {
  return runCompose(repoRoot ?? resolveRepoRoot(), ['down', ...(volumes ? ['--volumes'] : [])]).status ?? 1
}

function main() {
  const args = process.argv.slice(2)
  const action = args[0]
  const repoRoot = resolveRepoRoot()

  const docker = detectDocker()
  if (!docker.ok) {
    console.error(`❌ Docker is not available (${docker.reason}).`)
    console.error('   Install/start Docker Desktop, Rancher Desktop, or a native engine with the compose v2 plugin, then re-run.')
    process.exit(2)
  }

  if (action === 'up') {
    const profiles = []
    for (let index = 1; index < args.length; index++) {
      if (args[index] === '--profile' && args[index + 1]) {
        profiles.push(args[index + 1])
        index++
      }
    }
    const status = infraUp(repoRoot, { build: !args.includes('--no-build'), profiles })
    if (status === 0) {
      console.log('')
      console.log('✅ Infra containers are up (opencode :4096, postgres :5432, redis :6379, meilisearch :7700).')
      console.log('   Next: yarn dev (starts the app and the MCP server on this machine)')
    }
    process.exit(status)
  }

  if (action === 'down') {
    const volumes = args.includes('--volumes')
    if (volumes && !args.includes('--yes')) {
      console.error('❌ --volumes DELETES all database/search data. Re-run with --yes to confirm.')
      process.exit(1)
    }
    process.exit(infraDown(repoRoot, { volumes }))
  }

  console.error('Usage: node starters/lib/infra.mjs <up|down> [--no-build] [--profile <name>] [--volumes --yes]')
  process.exit(1)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) main()
