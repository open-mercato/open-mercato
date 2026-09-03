#!/usr/bin/env node
// Hybrid infra lifecycle: OpenCode + postgres/redis/meilisearch containers.
// Preferred entry: `yarn om infra up|down` (or npx @open-mercato/starter).
// Direct usage: node packages/starter/src/infra.mjs up [--profile <name>]
//               node packages/starter/src/infra.mjs down [--volumes --yes]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { detectDocker, resolveRepoRoot, runCompose, runCaptureSync } from './compose.mjs'

export function ensureMcpSharedDir(repoRoot) {
  // Pre-create the bind-mount source so dockerd never creates it root-owned
  // on native Linux (which would break host-side key provisioning).
  fs.mkdirSync(path.join(repoRoot, '.mercato', 'mcp-shared'), { recursive: true })
}

export function infraUp(repoRooot, { profiles = [] } = {}) {
  const repoRoot = repoRooot ?? resolveRepoRoot()
  ensureMcpSharedDir(repoRoot)
  const upArgs = []
  for (const profile of profiles) {
    upArgs.push('--profile', profile)
  }
  // --wait blocks on the postgres/redis/meilisearch healthchecks; opencode has
  // no healthcheck here and counts as started immediately (its entrypoint
  // waits for the host MCP server on its own). The opencode image is obtained
  // beforehand (base pull + thin local build, see steps.mjs
  // ensureOpencodeImage) — this file never builds.
  upArgs.push('up', '-d', '--wait')
  return runCompose(repoRoot, upArgs).status ?? 1
}

export function infraDown(repoRoot, { volumes = false } = {}) {
  return runCompose(repoRoot ?? resolveRepoRoot(), ['down', ...(volumes ? ['--volumes'] : [])]).status ?? 1
}

export function composeResourceNames(repoRoot, { composeFile, runComposeImpl = runCompose } = {}) {
  const config = runComposeImpl(repoRoot, ['config', '--format', 'json'], { composeFile, stdio: 'pipe' })
  if ((config.status ?? 1) !== 0) return { containers: [], volumes: [] }
  try {
    const parsed = JSON.parse(String(config.stdout ?? ''))
    return {
      containers: Object.values(parsed.services ?? {}).map((service) => service?.container_name).filter(Boolean),
      volumes: Object.values(parsed.volumes ?? {}).map((volume) => volume?.name).filter(Boolean),
    }
  } catch {
    return { containers: [], volumes: [] }
  }
}

// `docker compose down --volumes` only removes resources labeled with the
// CURRENT project (named after the checkout directory). The fixed
// container_name/volume names in the compose files mean a second checkout of
// this repo reuses resources created by the first — down skips those
// silently, so a reset would leave the old database volume (and its
// incompatible secrets) alive. Sweep leftovers by their fixed names.
export function removeLeftoverComposeResources(repoRoot, { composeFile, runComposeImpl = runCompose, runCaptureImpl = runCaptureSync, log = console.log, warn = console.warn } = {}) {
  const { containers, volumes } = composeResourceNames(repoRoot, { composeFile, runComposeImpl })
  const listNames = (args) => {
    const run = runCaptureImpl('docker', args)
    if (run.error || (run.status ?? 1) !== 0) return new Set()
    return new Set(String(run.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean))
  }

  const existingContainers = listNames(['ps', '-a', '--format', '{{.Names}}'])
  for (const name of containers) {
    if (!existingContainers.has(name)) continue
    const removed = runCaptureImpl('docker', ['rm', '-f', name])
    if ((removed.status ?? 1) === 0) log(`   removed leftover container ${name} (created by another checkout)`)
    else warn(`   could not remove container ${name}: ${String(removed.stderr ?? '').trim()}`)
  }

  let clean = true
  const existingVolumes = listNames(['volume', 'ls', '--format', '{{.Name}}'])
  for (const name of volumes) {
    if (!existingVolumes.has(name)) continue
    const removed = runCaptureImpl('docker', ['volume', 'rm', name])
    if ((removed.status ?? 1) === 0) {
      log(`   removed leftover volume ${name} (created by another checkout)`)
      continue
    }
    clean = false
    warn(`   could not remove volume ${name}: ${String(removed.stderr ?? '').trim()}`)
    const holders = runCaptureImpl('docker', ['ps', '-a', '--filter', `volume=${name}`, '--format', '{{.Names}}'])
    const holderNames = String(holders.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
    if (holderNames.length > 0) {
      warn(`   still mounted by: ${holderNames.join(', ')} — remove them (docker rm -f ${holderNames.join(' ')}) and re-run reset`)
    }
  }
  return clean
}

function main() {
  const args = process.argv.slice(2)
  const action = args[0]
  const repoRoot = resolveRepoRoot()
  if (!repoRoot) {
    console.error('❌ No Open Mercato checkout found above the current directory.')
    process.exit(2)
  }

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

  console.error('Usage: yarn om infra <up|down> [--profile <name>] [--volumes --yes]')
  process.exit(1)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) main()
