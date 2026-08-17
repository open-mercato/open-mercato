#!/usr/bin/env node

// Republish all packages to the local Verdaccio registry, removing existing
// versions first (cross-platform port of the former publish.sh; the .sh file
// remains as a thin wrapper).
// Usage: yarn registry:publish   (or: node scripts/registry/publish.mjs)

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNodeBundledCli, resolveYarnInvocation, runCli } from '../lib/spawn-cli.mjs'

export function registryAuthKey(registryUrl) {
  const withoutProtocol = registryUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `${withoutProtocol}/`
}

export function listPublishablePackages(rootDir) {
  const packagesDir = join(rootDir, 'packages')
  const packages = []
  for (const name of readdirSync(packagesDir).sort()) {
    const packageDir = join(packagesDir, name)
    const manifestPath = join(packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      continue
    }
    if (manifest.private === true) continue
    packages.push({ dir: packageDir, name: manifest.name, version: manifest.version })
  }
  return packages
}

function runDocker(args, { cwd, quiet = false, allowFailure = false }) {
  const result = spawnSync('docker', args, {
    cwd,
    stdio: quiet ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'ignore', 'inherit'],
  })
  const ok = !result.error && result.status === 0
  if (!ok && !allowFailure) {
    throw new Error(`registry:publish: 'docker ${args.join(' ')}' failed${result.error ? ` (${result.error.message})` : ''}`)
  }
  return ok
}

async function waitForVerdaccio(registryUrl, maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${registryUrl}/-/ping`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {
      // Not up yet; retry below.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000))
  }
  throw new Error(`registry:publish: Verdaccio did not become ready at ${registryUrl}`)
}

export async function publishToVerdaccio({ rootDir, env = process.env, log = console.log } = {}) {
  const registryUrl = (env.VERDACCIO_URL || 'http://localhost:4873').replace(/\/+$/, '')

  const npm = resolveNodeBundledCli('npm')
  if (!npm) throw new Error('registry:publish: could not resolve the npm CLI next to the Node executable.')
  const yarn = resolveYarnInvocation({ env })
  if (!yarn) throw new Error("registry:publish: could not resolve yarn; run this through 'yarn registry:publish'.")

  // A throwaway userconfig carrying fake auth, so npm publish/unpublish never
  // touch the user's real ~/.npmrc (Verdaccio accepts any credentials).
  const npmrcDir = mkdtempSync(join(tmpdir(), 'open-mercato-verdaccio-'))
  const npmrcPath = join(npmrcDir, '.npmrc')
  writeFileSync(npmrcPath, `//${registryAuthKey(registryUrl)}:_auth=fake-local-verdaccio-auth\n`)
  const childEnv = { ...env, NPM_CONFIG_USERCONFIG: npmrcPath }

  try {
    log(`Bootstrapping Verdaccio at ${registryUrl}...`)
    runDocker(['compose', 'rm', '-sf', 'verdaccio'], { cwd: rootDir, quiet: true, allowFailure: true })
    runDocker(['volume', 'rm', '-f', 'mercato-verdaccio-storage', 'mercato-verdaccio-plugins'], {
      cwd: rootDir,
      quiet: true,
      allowFailure: true,
    })
    runDocker(['compose', 'up', '-d', 'verdaccio'], { cwd: rootDir })
    await waitForVerdaccio(registryUrl)

    const packages = listPublishablePackages(rootDir)

    log('==========================================')
    log('  Republishing to Verdaccio')
    log(`  Registry: ${registryUrl}`)
    log('==========================================')
    log('')

    log('Step 1: Removing existing packages...')
    for (const { name, version } of packages) {
      if (!name || !version) continue
      log(`  Unpublishing ${name}@${version}...`)
      runCli(npm, ['unpublish', `${name}@${version}`, '--registry', registryUrl, '--force'], {
        cwd: rootDir,
        env: childEnv,
        stdio: ['ignore', 'inherit', 'ignore'],
      })
    }
    log('')

    log('Step 2: Building packages...')
    for (const buildArgs of [['build:packages'], ['generate'], ['build:packages']]) {
      if (!runCli(yarn, buildArgs, { cwd: rootDir, env: childEnv })) {
        throw new Error(`registry:publish: 'yarn ${buildArgs.join(' ')}' failed`)
      }
    }
    log('')

    log('Step 3: Publishing packages...')
    for (const { dir, name } of packages) {
      log(`  Publishing ${name}...`)
      for (const stale of readdirSync(dir).filter((entry) => entry.endsWith('.tgz'))) {
        unlinkSync(join(dir, stale))
      }

      // yarn pack resolves workspace:* ranges into concrete versions.
      const tarballPath = join(dir, 'package.tgz')
      if (!runCli(yarn, ['pack', '--out', 'package.tgz'], { cwd: dir, env: childEnv })) {
        throw new Error(`registry:publish: 'yarn pack' failed for ${name}`)
      }
      if (!existsSync(tarballPath)) {
        log(`    ✗ Failed to create tarball`)
        continue
      }
      if (!runCli(npm, ['publish', 'package.tgz', '--registry', registryUrl, '--access', 'public'], {
        cwd: dir,
        env: childEnv,
      })) {
        unlinkSync(tarballPath)
        throw new Error(`registry:publish: publishing ${name} failed`)
      }
      unlinkSync(tarballPath)
      log('    ✓ Published')
    }

    log('')
    log('==========================================')
    log(`  Done! View packages at: ${registryUrl}`)
    log('==========================================')
  } finally {
    rmSync(npmrcDir, { recursive: true, force: true })
  }
}

const isEntryPoint = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isEntryPoint) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  publishToVerdaccio({ rootDir }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
