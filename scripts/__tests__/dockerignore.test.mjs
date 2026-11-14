import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const dockerignore = require('@balena/dockerignore')
const contextRoots = new Map([
  ['monorepo', new URL('../../', import.meta.url)],
  ['standalone template', new URL('../../packages/create-app/template/', import.meta.url)],
])
const directories = ['', 'apps/mercato/', 'nested/config/deep/']
const privateNames = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.test',
  '.env.production',
  '.env.production.local',
  '.env.preview',
  '.env.preview.vercel',
  '.env.bak',
  '.env.backup',
  '.env~',
  '.env.example.bak',
  '.env.production.example',
]
const privateFiles = directories.flatMap((directory) => privateNames.map((name) => `${directory}${name}`))
const publicFiles = directories.flatMap((directory) => ['.env.example', 'source.ts'].map((name) => `${directory}${name}`))
const docker = spawnSync('docker', ['info', '--format', '{{.OSType}}'], { encoding: 'utf8', timeout: 5000 })
const dockerSkip = docker.status === 0 && docker.stdout.trim() === 'linux' ? false : 'Linux Docker engine unavailable'

for (const [contextName, contextRoot] of contextRoots) {
  const ignoreUrl = new URL('.dockerignore', contextRoot)
  const ignoreRules = readFileSync(ignoreUrl, 'utf8')

  test(`${contextName} filters private canaries and preserves examples and source`, (context) => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'mercato-dockerignore-'))
    context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

    for (const file of [...privateFiles, ...publicFiles]) {
      const filePath = path.join(fixtureRoot, file)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, 'DOCKER_CONTEXT_CANARY=non-secret\n')
    }

    const filter = dockerignore().add(ignoreRules)
    const includedFiles = [...privateFiles, ...publicFiles].filter((file) => {
      assert.ok(readFileSync(path.join(fixtureRoot, file), 'utf8').includes('non-secret'))
      return !filter.ignores(file)
    })

    assert.deepEqual(includedFiles.sort(), [...publicFiles].sort())
  })

  test(`${contextName} excludes private canaries from a Docker COPY`, { skip: dockerSkip, timeout: 130000 }, (context) => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'mercato-docker-context-'))
    context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }))
    const buildRoot = path.join(fixtureRoot, 'context')
    const outputRoot = path.join(fixtureRoot, 'output')
    mkdirSync(buildRoot)
    writeFileSync(path.join(buildRoot, '.dockerignore'), ignoreRules)

    for (const file of [...privateFiles, ...publicFiles]) {
      const filePath = path.join(buildRoot, file)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, 'DOCKER_CONTEXT_CANARY=non-secret\n')
    }

    const build = spawnSync('docker', [
      'buildx', 'build', '--no-cache', '--network=none', '--progress=plain',
      '--output', `type=local,dest=${outputRoot}`, '--file', '-', buildRoot,
    ], { input: 'FROM scratch\nCOPY . /\n', encoding: 'utf8', timeout: 120000 })

    assert.equal(build.status, 0, build.error?.message ?? build.stderr)
    for (const file of privateFiles) {
      assert.throws(() => readFileSync(path.join(outputRoot, file)), { code: 'ENOENT' }, `${file} must not be copied`)
    }
    for (const file of publicFiles) {
      assert.equal(readFileSync(path.join(outputRoot, file), 'utf8'), 'DOCKER_CONTEXT_CANARY=non-secret\n')
    }
  })
}
