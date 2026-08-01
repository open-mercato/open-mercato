import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packagesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const repositoryRoot = join(packagesRoot, '..')

function packedFiles(packageDir: string): string[] {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as Array<{ files?: Array<{ path?: string }> }>
  return (parsed[0]?.files ?? []).flatMap((entry) => typeof entry.path === 'string' ? [entry.path] : [])
}

function nearestModuleAgents(packageDir: string, moduleId: string): string | null {
  const modulesRoot = join(packageDir, 'src', 'modules')
  let cursor = join(modulesRoot, moduleId)
  while (cursor === modulesRoot || cursor.startsWith(`${modulesRoot}${sep}`)) {
    const candidate = join(cursor, 'AGENTS.md')
    if (existsSync(candidate)) return relative(packageDir, candidate).split(sep).join('/')
    if (cursor === modulesRoot) break
    cursor = dirname(cursor)
  }
  return null
}

test('every package declared by the standalone template publishes its module source and available AGENTS context', () => {
  const packageDirs = new Map<string, string>()
  for (const directory of readdirSync(packagesRoot)) {
    const manifestPath = join(packagesRoot, directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
    if (typeof manifest.name === 'string') packageDirs.set(manifest.name, join(packagesRoot, directory))
  }

  const modulesSource = readFileSync(join(packagesRoot, 'create-app', 'template', 'src', 'modules.ts'), 'utf8')
  const entries = [...modulesSource.matchAll(/\{\s*id:\s*'([^']+)',\s*from:\s*'(@open-mercato\/[^']+)'\s*\}/g)]
    .map((match) => ({ id: match[1], packageName: match[2] }))
  const byPackage = new Map<string, string[]>()
  for (const entry of entries) {
    const ids = byPackage.get(entry.packageName) ?? []
    ids.push(entry.id)
    byPackage.set(entry.packageName, ids)
  }

  let moduleAgentsAssertions = 0
  for (const [packageName, moduleIds] of byPackage) {
    const packageDir = packageDirs.get(packageName)
    assert.ok(packageDir, `${packageName} must resolve to a workspace package`)
    const files = new Set(packedFiles(packageDir))
    for (const moduleId of moduleIds) {
      assert.ok(
        [...files].some((file) => file.startsWith(`src/modules/${moduleId}/`)),
        `${packageName} package is missing exact source for module ${moduleId}`,
      )
      const nearestAgents = nearestModuleAgents(packageDir, moduleId)
      if (nearestAgents) {
        moduleAgentsAssertions += 1
        assert.equal(
          files.has(nearestAgents),
          true,
          `${packageName} package is missing nearest module instructions ${nearestAgents}`,
        )
      }
    }
    if (existsSync(join(packageDir, 'AGENTS.md'))) {
      assert.equal(files.has('AGENTS.md'), true, `${packageName} package is missing its root AGENTS.md`)
    }
  }

  assert.ok(moduleAgentsAssertions > 1, 'expected multiple declared modules to carry nearest AGENTS context')

  const coreFiles = new Set(packedFiles(join(packagesRoot, 'core')))
  assert.equal(coreFiles.has('src/modules/customers/data/entities.ts'), true)
})

test('Docker package-build stages include release-matched upstream context sources', () => {
  const dockerfile = readFileSync(join(repositoryRoot, 'Dockerfile'), 'utf8')
  const copyInstruction = 'COPY AGENTS.md BACKWARD_COMPATIBILITY.md ./'
  assert.equal(
    dockerfile.split(copyInstruction).length - 1,
    2,
    'builder and dev-build must both copy the upstream context before package builds',
  )

  for (const buildCommand of ['RUN yarn build', 'RUN yarn build:packages && yarn generate && yarn build:packages']) {
    const buildIndex = dockerfile.indexOf(buildCommand)
    assert.notEqual(buildIndex, -1, `missing Docker build command: ${buildCommand}`)
    const stageStart = dockerfile.lastIndexOf('FROM node:', buildIndex)
    const copyIndex = dockerfile.lastIndexOf(copyInstruction, buildIndex)
    assert.ok(copyIndex > stageStart, `${copyInstruction} must occur in the same stage before ${buildCommand}`)
  }
})
