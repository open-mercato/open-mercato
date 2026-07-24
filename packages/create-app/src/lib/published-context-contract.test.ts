import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packagesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function packedFiles(packageDir: string): string[] {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as Array<{ files?: Array<{ path?: string }> }>
  return (parsed[0]?.files ?? []).flatMap((entry) => typeof entry.path === 'string' ? [entry.path] : [])
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

  for (const [packageName, moduleIds] of byPackage) {
    const packageDir = packageDirs.get(packageName)
    assert.ok(packageDir, `${packageName} must resolve to a workspace package`)
    const files = new Set(packedFiles(packageDir))
    for (const moduleId of moduleIds) {
      assert.ok(
        [...files].some((file) => file.startsWith(`src/modules/${moduleId}/`)),
        `${packageName} package is missing exact source for module ${moduleId}`,
      )
    }
    if (existsSync(join(packageDir, 'AGENTS.md'))) {
      assert.equal(files.has('AGENTS.md'), true, `${packageName} package is missing its root AGENTS.md`)
    }
  }

  const coreFiles = new Set(packedFiles(join(packagesRoot, 'core')))
  assert.equal(coreFiles.has('src/modules/customers/AGENTS.md'), true)
  assert.equal(coreFiles.has('src/modules/customers/data/entities.ts'), true)
})
