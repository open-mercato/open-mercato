import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const prepareScript = path.join(packageRoot, 'scripts/prepare-test-git-history.mjs')

function runGit(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

test('prepares complete Git history before parallel provenance tests start', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-create-app-history-'))
  const originRoot = path.join(fixtureRoot, 'origin.git')
  const authorRoot = path.join(fixtureRoot, 'author')
  const shallowRoot = path.join(fixtureRoot, 'shallow')

  try {
    fs.mkdirSync(authorRoot)
    execFileSync('git', ['init', '--bare', originRoot])
    runGit(authorRoot, ['init', '-b', 'main'])
    runGit(authorRoot, ['config', 'user.email', 'tests@openmercato.com'])
    runGit(authorRoot, ['config', 'user.name', 'Open Mercato Tests'])
    fs.writeFileSync(path.join(authorRoot, 'history.txt'), 'first\n')
    runGit(authorRoot, ['add', 'history.txt'])
    runGit(authorRoot, ['commit', '-m', 'first'])
    const ancestorSha = runGit(authorRoot, ['rev-parse', 'HEAD'])
    fs.writeFileSync(path.join(authorRoot, 'history.txt'), 'second\n')
    runGit(authorRoot, ['commit', '-am', 'second'])
    runGit(authorRoot, ['remote', 'add', 'origin', originRoot])
    runGit(authorRoot, ['push', '-u', 'origin', 'main'])

    execFileSync('git', ['clone', '--depth=1', '--branch', 'main', pathToFileURL(originRoot).href, shallowRoot])
    assert.equal(runGit(shallowRoot, ['rev-parse', '--is-shallow-repository']), 'true')

    const prepared = spawnSync(process.execPath, [prepareScript, shallowRoot], { encoding: 'utf8' })
    assert.equal(prepared.status, 0, prepared.stderr)
    assert.equal(runGit(shallowRoot, ['rev-parse', '--is-shallow-repository']), 'false')
    assert.doesNotThrow(() => runGit(shallowRoot, ['cat-file', '-e', `${ancestorSha}^{commit}`]))
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
