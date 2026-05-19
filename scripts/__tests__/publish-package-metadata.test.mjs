import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../..')
const packagesDir = path.join(rootDir, 'packages')
const expectedRepositoryUrl = 'https://github.com/open-mercato/open-mercato'

async function readPackageJson(packageDir) {
  const packageJsonPath = path.join(packagesDir, packageDir, 'package.json')
  const contents = await readFile(packageJsonPath, 'utf8')
  return JSON.parse(contents)
}

test('publishable packages declare repository metadata required by publish-packages.sh', async () => {
  const packageDirs = await readdir(packagesDir, { withFileTypes: true })
  const failures = []

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue

    const packageJson = await readPackageJson(entry.name)
    if (packageJson.private === true) continue

    const packagePath = `packages/${entry.name}`
    if (packageJson.repository?.url !== expectedRepositoryUrl) {
      failures.push(`${packagePath}: repository.url must be ${expectedRepositoryUrl}`)
    }

    if (packageJson.repository?.directory !== packagePath) {
      failures.push(`${packagePath}: repository.directory must be ${packagePath}`)
    }
  }

  assert.deepEqual(failures, [])
})
