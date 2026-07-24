import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const installerPath = fileURLToPath(new URL('../../agentic/shared/scripts/install-skills.mjs', import.meta.url))
const installer = await import(pathToFileURL(installerPath).href) as {
  externalCliInvocation: (
    external: { cli: { package: string; version: string }; skills: string[] },
    sourceDir: string,
    platform?: string,
  ) => { executable: string; args: string[] }
  runInstaller: (options: Record<string, unknown>) => Promise<number>
}

const HASH = `sha256:${'0'.repeat(64)}`

function fixture(overrides: Record<string, unknown> = {}): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-standalone-skills-')))
  fs.mkdirSync(path.join(root, '.ai', 'skills', 'om-alpha'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ai', 'skills', 'om-alpha', 'SKILL.md'), '# alpha\n')
  fs.mkdirSync(path.join(root, '.ai', 'skills', 'om-beta'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ai', 'skills', 'om-beta', 'SKILL.md'), '# beta\n')
  fs.mkdirSync(path.join(root, '.ai', 'skills', 'om-code-review'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ai', 'skills', 'om-code-review', 'SKILL.md'), '# override\n')
  const manifest = {
    default: ['core'],
    external: {
      source: 'open-mercato/skills',
      ref: 'cf42eaf277a91c3906ffa910a1cdfeb121fe8322',
      cli: { package: 'skills', version: '1.5.20' },
      skills: ['om-code-review'],
      dependencies: { 'om-code-review': [] },
      contentHashes: { 'om-code-review': HASH },
    },
    tiers: {
      core: { description: 'Daily.', skills: ['om-alpha'] },
      automation: { description: 'Optional.', skills: ['om-beta'] },
    },
    ...overrides,
  }
  fs.mkdirSync(path.join(root, '.ai', 'skills'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ai', 'skills', 'tiers.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.copyFileSync(installerPath, path.join(root, 'scripts', 'install-skills.mjs'))
  return root
}

function run(root: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'install-skills.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

function removeFixture(root: string): void {
  fs.rmSync(root, { recursive: true, force: true })
}

test('standalone installer needs only Node and creates the canonical plus Claude layout offline', () => {
  const root = fixture()
  try {
    const result = run(root, '--no-external')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.readlinkSync(path.join(root, '.agents', 'skills', 'om-alpha')), '../../.ai/skills/om-alpha')
    assert.equal(fs.readlinkSync(path.join(root, '.claude', 'skills', 'om-alpha')), '../../.agents/skills/om-alpha')
    assert.equal(fs.existsSync(path.join(root, '.codex', 'skills')), false)
    assert.equal(fs.existsSync(path.join(root, '.cursor', 'skills')), false)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-code-review')), false)
    assert.match(result.stdout, /skipped \(--no-external\)/)
  } finally {
    removeFixture(root)
  }
})

test('legacy directory links migrate safely and clean preserves unknown user paths', () => {
  const root = fixture()
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true })
    fs.symlinkSync(path.join('..', '.ai', 'skills'), path.join(root, '.claude', 'skills'))
    fs.mkdirSync(path.join(root, '.agents', 'skills', 'user-skill'), { recursive: true })
    fs.writeFileSync(path.join(root, '.agents', 'skills', 'user-skill', 'README.md'), 'mine\n')

    assert.equal(run(root, '--no-external').status, 0)
    assert.equal(fs.lstatSync(path.join(root, '.claude', 'skills')).isDirectory(), true)
    assert.equal(run(root, '--clean').status, 0)

    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-alpha')), false)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'user-skill', 'README.md')), true)
  } finally {
    removeFixture(root)
  }
})

test('tier selection, listing, legacy links, and ignored agents retain their flag contracts', () => {
  const root = fixture()
  try {
    const listed = run(root, '--list')
    assert.equal(listed.status, 0, listed.stderr)
    assert.match(listed.stdout, /skills@1\.5\.20/)
    assert.match(listed.stdout, /cf42eaf277a91c3906ffa910a1cdfeb121fe8322/)
    assert.equal(fs.existsSync(path.join(root, '.agents')), false)

    assert.equal(run(root, '--no-external', '--with', 'automation', '--legacy-links').status, 0)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-alpha')), true)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-beta')), true)
    assert.equal(fs.existsSync(path.join(root, '.codex', 'skills', 'om-beta')), true)

    assert.equal(run(root, '--clean').status, 0)
    const exact = run(root, '--no-external', '--tiers=automation', '--ignore-agents', 'claude-code')
    assert.equal(exact.status, 0, exact.stderr)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-alpha')), false)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-beta')), true)
    assert.equal(fs.existsSync(path.join(root, '.claude', 'skills')), false)
    assert.equal(fs.existsSync(path.join(root, '.codex', 'skills')), false)

    const conflicting = run(root, '--no-external', '--all', '--tiers', 'core')
    assert.notEqual(conflicting.status, 0)
    assert.match(conflicting.stderr, /mutually exclusive/)
  } finally {
    removeFixture(root)
  }
})

test('network failure is non-fatal and still installs the selected local skills', async () => {
  const root = fixture()
  try {
    const exitCode = await installer.runInstaller({
      rootDir: root,
      args: [],
      fetchImpl: async () => { throw new Error('offline') },
    })
    assert.equal(exitCode, 0)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-alpha')), true)
  } finally {
    removeFixture(root)
  }
})

test('external CLI invocation is pinned, repeats --skill, and resolves the Windows executable', () => {
  const invocation = installer.externalCliInvocation({
    cli: { package: 'skills', version: '1.5.20' },
    skills: ['om-one', 'om-two'],
  }, 'C:\\Temp\\pinned-skills', 'win32')

  assert.equal(invocation.executable, 'npx.cmd')
  assert.deepEqual(invocation.args.slice(0, 4), ['-y', 'skills@1.5.20', 'add', 'C:\\Temp\\pinned-skills'])
  assert.deepEqual(invocation.args.filter((argument) => argument === '--skill'), ['--skill', '--skill'])
  assert.equal(invocation.args.includes('om-one,om-two'), false)
  assert.deepEqual(invocation.args.slice(-3), ['--agent', 'universal', '-y'])
})

test('manifest dependency closure fails before any links are written', () => {
  const root = fixture({
    external: {
      source: 'open-mercato/skills',
      ref: 'cf42eaf277a91c3906ffa910a1cdfeb121fe8322',
      cli: { package: 'skills', version: '1.5.20' },
      skills: ['om-code-review'],
      dependencies: { 'om-code-review': ['om-setup-agent-pipeline'] },
      contentHashes: { 'om-code-review': HASH },
    },
  })
  try {
    const result = run(root, '--no-external')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /requires missing 'om-setup-agent-pipeline'/)
    assert.equal(fs.existsSync(path.join(root, '.agents')), false)
  } finally {
    removeFixture(root)
  }
})
