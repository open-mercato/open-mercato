import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const readRepoFile = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

const lockfileTemplate = readRepoFile('../../template/yarn.lock.template')
const templatePackageManager = readRepoFile('../../template/package.json.template').match(/"packageManager":\s*"([^"]+)"/)?.[1]
const rootPackageManager = (JSON.parse(readRepoFile('../../../../package.json')) as { packageManager?: string }).packageManager

const lockfileVersion = (lockfile: string) => lockfile.match(/__metadata:\n {2}version: (\d+)/)?.[1]

test('template lockfile uses the lockfile version of the Yarn the monorepo pins when both pins match', (t) => {
  if (templatePackageManager !== rootPackageManager) {
    t.skip('template and monorepo pin different Yarn versions')
    return
  }
  const rootLockfileVersion = lockfileVersion(readRepoFile('../../../../yarn.lock'))
  assert.ok(rootLockfileVersion, 'root yarn.lock must declare __metadata.version')
  assert.equal(lockfileVersion(lockfileTemplate), rootLockfileVersion)
})

test('the scaffolded Yarn version runs a script against the stub lockfile before any install', () => {
  assert.ok(templatePackageManager, 'template package.json.template must pin a packageManager')
  const appName = 'lockfile-fixture'
  const root = mkdtempSync(join(tmpdir(), 'create-mercato-app-lockfile-'))
  try {
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ name: appName, private: true, packageManager: templatePackageManager, scripts: { setup: 'node -e "console.log(\'setup-started\')"' } }, null, 2)}\n`,
    )
    writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
    writeFileSync(join(root, 'yarn.lock'), lockfileTemplate.replace(/\{\{APP_NAME\}\}/g, appName))
    const output = execFileSync(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', ['setup'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    assert.match(output, /setup-started/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
