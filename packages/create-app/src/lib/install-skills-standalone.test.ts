import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const installerPath = fileURLToPath(new URL('../../agentic/shared/scripts/install-skills.mjs', import.meta.url))
const installer = await import(pathToFileURL(installerPath).href) as {
  assertRegularSkillTree: (root: string) => void
  assertExternalDestinationsReplaceable: (root: string, external: Record<string, unknown>) => void
  externalCliInvocation: (
    external: { cli: { package: string; version: string }; skills: string[] },
    sourceDir: string,
    platform?: string,
  ) => { executable: string; args: string[] }
  runInstaller: (options: Record<string, unknown>) => Promise<number>
  hashSkillDirectory: (root: string) => string
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

function setExternalHash(root: string, hash: string): void {
  const manifestPath = path.join(root, '.ai', 'skills', 'tiers.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    external: { contentHashes: Record<string, string> }
  }
  manifest.external.contentHashes['om-code-review'] = hash
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function hashSingleFileSkill(contents = '# verified external\n'): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-skill-hash-')))
  try {
    fs.writeFileSync(path.join(root, 'SKILL.md'), contents)
    return installer.hashSkillDirectory(root)
  } finally {
    removeFixture(root)
  }
}

function regularDownloadSource(): Promise<{ tempRoot: string; sourceDir: string }> {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-skill-source-')))
  const sourceDir = path.join(tempRoot, 'source')
  fs.mkdirSync(sourceDir)
  fs.writeFileSync(path.join(sourceDir, 'README.md'), '# pinned source\n')
  return Promise.resolve({ tempRoot, sourceDir })
}

function verifiedSkillSpawn(contents = '# verified external\n') {
  return (_executable: string, _args: string[], options: { cwd: string }) => {
    const skillDir = path.join(options.cwd, '.agents', 'skills', 'om-code-review')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), contents)
    return { status: 0 }
  }
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

test('ignoring an agent on a re-run removes only its previously managed links', () => {
  const root = fixture()
  try {
    assert.equal(run(root, '--no-external').status, 0)
    assert.equal(fs.existsSync(path.join(root, '.claude', 'skills', 'om-alpha')), true)
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'user-owned.md'), 'keep me\n')

    const ignored = run(root, '--no-external', '--ignore-agents', 'claude-code')
    assert.equal(ignored.status, 0, ignored.stderr)
    assert.equal(fs.existsSync(path.join(root, '.claude', 'skills', 'om-alpha')), false)
    assert.equal(fs.readFileSync(path.join(root, '.claude', 'skills', 'user-owned.md'), 'utf8'), 'keep me\n')
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

test('external installation refuses and preserves an unknown real skill directory', () => {
  const root = fixture()
  const skillDir = path.join(root, '.agents', 'skills', 'om-code-review')
  try {
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# user owned\n')
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.ai', 'skills', 'tiers.json'), 'utf8')) as {
      external: Record<string, unknown>
    }

    assert.throws(
      () => installer.assertExternalDestinationsReplaceable(root, manifest.external),
      /refusing to replace unowned external skill directory/,
    )
    assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# user owned\n')
  } finally {
    removeFixture(root)
  }
})

test('an offline pin change removes stale managed skills from canonical discovery without deleting them', () => {
  const root = fixture()
  const skillDir = path.join(root, '.agents', 'skills', 'om-code-review')
  try {
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# previously installed\n')
    const actual = installer.hashSkillDirectory(skillDir)
    fs.writeFileSync(path.join(root, '.agents', 'skills', '.om-external-ownership.json'), `${JSON.stringify({
      version: 1,
      source: 'open-mercato/skills',
      ref: 'a'.repeat(40),
      skills: { 'om-code-review': actual },
    }, null, 2)}\n`)

    const result = run(root, '--no-external')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(skillDir), false)
    assert.equal(fs.readFileSync(path.join(root, '.agents', 'skills-quarantine', 'om-code-review', 'SKILL.md'), 'utf8'), '# previously installed\n')
    assert.match(result.stderr, /quarantined stale or modified managed skill/)
  } finally {
    removeFixture(root)
  }
})

test('a pre-ledger mismatched external directory is quarantined on the first offline run', () => {
  const root = fixture()
  const skillDir = path.join(root, '.agents', 'skills', 'om-code-review')
  try {
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# old unverified install\n')

    const result = run(root, '--no-external')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(skillDir), false)
    assert.equal(
      fs.readFileSync(path.join(root, '.agents', 'skills-quarantine', 'unowned-om-code-review', 'SKILL.md'), 'utf8'),
      '# old unverified install\n',
    )
    assert.match(result.stderr, /quarantined unverified pre-ledger skill/)
  } finally {
    removeFixture(root)
  }
})

test('skill hashing rejects source symlinks without reading or changing their outside target', { skip: process.platform === 'win32' }, async () => {
  const root = fixture()
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-skill-outside-')))
  const outsideFile = path.join(outsideRoot, 'secret.txt')
  fs.writeFileSync(outsideFile, 'outside sentinel\n')
  let spawnCalled = false
  try {
    const result = await installer.runInstaller({
      rootDir: root,
      args: [],
      downloadSource: async () => {
        const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-skill-source-link-')))
        const sourceDir = path.join(tempRoot, 'source')
        fs.mkdirSync(sourceDir)
        fs.writeFileSync(path.join(sourceDir, 'README.md'), '# source\n')
        fs.symlinkSync(outsideFile, path.join(sourceDir, 'escape'))
        return { tempRoot, sourceDir }
      },
      spawn: () => {
        spawnCalled = true
        return { status: 0 }
      },
    })

    assert.equal(result, 0)
    assert.equal(spawnCalled, false)
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside sentinel\n')
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-code-review')), false)
  } finally {
    removeFixture(root)
    removeFixture(outsideRoot)
  }
})

test('staged external symlinks fail integrity and are never copied into discovery', { skip: process.platform === 'win32' }, async () => {
  const root = fixture()
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-staged-outside-')))
  const outsideFile = path.join(outsideRoot, 'sentinel.txt')
  fs.writeFileSync(outsideFile, 'outside sentinel\n')
  setExternalHash(root, hashSingleFileSkill())
  try {
    const result = await installer.runInstaller({
      rootDir: root,
      args: [],
      downloadSource: regularDownloadSource,
      spawn: (_executable: string, _args: string[], options: { cwd: string }) => {
        const skillDir = path.join(options.cwd, '.agents', 'skills', 'om-code-review')
        fs.mkdirSync(skillDir, { recursive: true })
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# verified external\n')
        fs.symlinkSync(outsideFile, path.join(skillDir, 'escape'))
        return { status: 0 }
      },
    })

    assert.equal(result, 0)
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside sentinel\n')
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-code-review')), false)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-alpha')), true)
  } finally {
    removeFixture(root)
    removeFixture(outsideRoot)
  }
})

test('an installed nested symlink is quarantined and loses ownership attestation', { skip: process.platform === 'win32' }, () => {
  const root = fixture()
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-installed-outside-')))
  const outsideFile = path.join(outsideRoot, 'sentinel.txt')
  const skillDir = path.join(root, '.agents', 'skills', 'om-code-review')
  fs.writeFileSync(outsideFile, 'outside sentinel\n')
  try {
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# verified external\n')
    const pinnedHash = installer.hashSkillDirectory(skillDir)
    setExternalHash(root, pinnedHash)
    fs.writeFileSync(path.join(root, '.agents', 'skills', '.om-external-ownership.json'), `${JSON.stringify({
      version: 1,
      source: 'open-mercato/skills',
      ref: 'cf42eaf277a91c3906ffa910a1cdfeb121fe8322',
      skills: { 'om-code-review': pinnedHash },
    }, null, 2)}\n`)
    fs.symlinkSync(outsideFile, path.join(skillDir, 'escape'))

    const result = run(root, '--no-external')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /quarantined stale or modified managed skill/)
    assert.equal(fs.existsSync(skillDir), false)
    assert.equal(fs.lstatSync(path.join(root, '.agents', 'skills-quarantine', 'om-code-review', 'escape')).isSymbolicLink(), true)
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside sentinel\n')
    const ledger = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'skills', '.om-external-ownership.json'), 'utf8')) as {
      skills: Record<string, string>
    }
    assert.deepEqual(ledger.skills, {})
  } finally {
    removeFixture(root)
    removeFixture(outsideRoot)
  }
})

test('unsupported staged filesystem nodes fail closed when FIFOs are available', { skip: process.platform === 'win32' }, async (context) => {
  const root = fixture()
  setExternalHash(root, hashSingleFileSkill())
  try {
    let fifoCreated = false
    const result = await installer.runInstaller({
      rootDir: root,
      args: [],
      downloadSource: regularDownloadSource,
      spawn: (_executable: string, _args: string[], options: { cwd: string }) => {
        const skillDir = path.join(options.cwd, '.agents', 'skills', 'om-code-review')
        fs.mkdirSync(skillDir, { recursive: true })
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# verified external\n')
        const fifo = spawnSync('mkfifo', [path.join(skillDir, 'unsafe-fifo')], { encoding: 'utf8' })
        fifoCreated = fifo.status === 0
        return { status: fifoCreated ? 0 : 1 }
      },
    })
    if (!fifoCreated) {
      context.skip('mkfifo is unavailable on this platform')
      return
    }

    assert.equal(result, 0)
    assert.equal(fs.existsSync(path.join(root, '.agents', 'skills', 'om-code-review')), false)
  } finally {
    removeFixture(root)
  }
})

test('verified regular external skills reinstall idempotently with matching ownership', async () => {
  const root = fixture()
  const contents = '# verified external\n'
  const pinnedHash = hashSingleFileSkill(contents)
  setExternalHash(root, pinnedHash)
  let spawnCount = 0
  try {
    const options = {
      rootDir: root,
      args: [],
      downloadSource: regularDownloadSource,
      spawn: (...args: Parameters<ReturnType<typeof verifiedSkillSpawn>>) => {
        spawnCount += 1
        return verifiedSkillSpawn(contents)(...args)
      },
    }
    assert.equal(await installer.runInstaller(options), 0)
    assert.equal(await installer.runInstaller(options), 0)

    const installed = path.join(root, '.agents', 'skills', 'om-code-review')
    assert.equal(spawnCount, 2)
    assert.equal(installer.hashSkillDirectory(installed), pinnedHash)
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), false)
    assert.equal(fs.readlinkSync(path.join(root, '.claude', 'skills', 'om-code-review')), '../../.agents/skills/om-code-review')
    const ledger = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'skills', '.om-external-ownership.json'), 'utf8')) as {
      skills: Record<string, string>
    }
    assert.equal(ledger.skills['om-code-review'], pinnedHash)
  } finally {
    removeFixture(root)
  }
})

test('canonical skill paths reject symlinked ancestors before any outside write', { skip: process.platform === 'win32' }, () => {
  for (const escapedPath of [['.agents'], ['.agents', 'skills']]) {
    const root = fixture()
    const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-canonical-escape-')))
    const sentinel = path.join(outsideRoot, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'outside sentinel\n')
    try {
      const linkPath = path.join(root, ...escapedPath)
      fs.mkdirSync(path.dirname(linkPath), { recursive: true })
      fs.symlinkSync(outsideRoot, linkPath, 'dir')

      const result = run(root, '--no-external')
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /installer-owned path contains a symbolic-link component/)
      assert.deepEqual(fs.readdirSync(outsideRoot).sort(), ['sentinel.txt'])
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside sentinel\n')
    } finally {
      removeFixture(root)
      removeFixture(outsideRoot)
    }
  }
})

test('a symlinked quarantine directory cannot move an external skill outside the app', { skip: process.platform === 'win32' }, () => {
  const root = fixture()
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-quarantine-escape-')))
  const sentinel = path.join(outsideRoot, 'sentinel.txt')
  const skillDir = path.join(root, '.agents', 'skills', 'om-code-review')
  fs.writeFileSync(sentinel, 'outside sentinel\n')
  try {
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# unowned external\n')
    fs.symlinkSync(outsideRoot, path.join(root, '.agents', 'skills-quarantine'), 'dir')

    const result = run(root, '--no-external')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /installer-owned path contains a symbolic-link component/)
    assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# unowned external\n')
    assert.deepEqual(fs.readdirSync(outsideRoot).sort(), ['sentinel.txt'])
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside sentinel\n')
  } finally {
    removeFixture(root)
    removeFixture(outsideRoot)
  }
})

test('agent compatibility layouts reject symlinked roots and leaf directories without outside writes', { skip: process.platform === 'win32' }, () => {
  for (const agentRoot of ['.claude', '.codex', '.cursor']) {
    for (const escapedPath of [[agentRoot], [agentRoot, 'skills']]) {
      const root = fixture()
      const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-agent-layout-escape-')))
      const sentinel = path.join(outsideRoot, 'sentinel.txt')
      fs.writeFileSync(sentinel, 'outside sentinel\n')
      try {
        const linkPath = path.join(root, ...escapedPath)
        fs.mkdirSync(path.dirname(linkPath), { recursive: true })
        fs.symlinkSync(outsideRoot, linkPath, 'dir')

        const result = run(root, '--no-external', '--legacy-links')
        assert.notEqual(result.status, 0, `${escapedPath.join('/')} unexpectedly passed`)
        assert.match(result.stderr, /installer-owned path contains a symbolic-link component/)
        assert.deepEqual(fs.readdirSync(outsideRoot).sort(), ['sentinel.txt'])
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside sentinel\n')
      } finally {
        removeFixture(root)
        removeFixture(outsideRoot)
      }
    }
  }
})

test('local skill source ancestors must remain inside the real app tree', { skip: process.platform === 'win32' }, () => {
  for (const escapedPath of [['.ai'], ['.ai', 'skills']]) {
    const root = fixture()
    const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-local-source-escape-')))
    const sentinel = path.join(outsideRoot, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'outside sentinel\n')
    try {
      const source = path.join(root, ...escapedPath)
      const outsideSource = path.join(outsideRoot, 'linked-source')
      fs.renameSync(source, outsideSource)
      fs.symlinkSync(outsideSource, source, 'dir')

      const result = run(root, '--no-external')
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /installer-owned path contains a symbolic-link component/)
      assert.equal(fs.existsSync(path.join(root, '.agents')), false)
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside sentinel\n')
    } finally {
      removeFixture(root)
      removeFixture(outsideRoot)
    }
  }
})

test('selected local skill trees reject nested links before canonical discovery is created', { skip: process.platform === 'win32' }, () => {
  const root = fixture()
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-local-skill-escape-')))
  const sentinel = path.join(outsideRoot, 'sentinel.txt')
  fs.writeFileSync(sentinel, 'outside sentinel\n')
  try {
    fs.symlinkSync(sentinel, path.join(root, '.ai', 'skills', 'om-alpha', 'escape'))

    const result = run(root, '--no-external')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /skill tree contains a symbolic link/)
    assert.equal(fs.existsSync(path.join(root, '.agents')), false)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside sentinel\n')
  } finally {
    removeFixture(root)
    removeFixture(outsideRoot)
  }
})

test('the external ownership ledger cannot be read through a symlink', { skip: process.platform === 'win32' }, () => {
  const root = fixture()
  const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-ledger-escape-')))
  const sentinel = path.join(outsideRoot, 'sentinel.json')
  fs.writeFileSync(sentinel, '{"outside":true}\n')
  try {
    fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true })
    fs.symlinkSync(sentinel, path.join(root, '.agents', 'skills', '.om-external-ownership.json'))

    const result = run(root, '--no-external')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /external skill ownership ledger must be a regular file/)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), '{"outside":true}\n')
    assert.deepEqual(fs.readdirSync(outsideRoot), ['sentinel.json'])
  } finally {
    removeFixture(root)
    removeFixture(outsideRoot)
  }
})

test('traversal and absolute-like skill names fail before installer-owned paths are created', () => {
  const invalidCases = [
    { kind: 'local', name: '../escape' },
    { kind: 'local', name: '/absolute-skill' },
    { kind: 'external', name: '../../escape' },
    { kind: 'external', name: '/absolute-external' },
  ]
  for (const invalid of invalidCases) {
    const root = fixture()
    const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-invalid-skill-name-')))
    const sentinel = path.join(outsideRoot, 'sentinel.txt')
    fs.writeFileSync(sentinel, 'outside sentinel\n')
    try {
      const manifestPath = path.join(root, '.ai', 'skills', 'tiers.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        tiers: { core: { skills: string[] } }
        external: {
          skills: string[]
          dependencies: Record<string, string[]>
          contentHashes: Record<string, string>
        }
      }
      if (invalid.kind === 'local') {
        manifest.tiers.core.skills = [invalid.name]
      } else {
        manifest.external.skills = [invalid.name]
        manifest.external.dependencies = { [invalid.name]: [] }
        manifest.external.contentHashes = { [invalid.name]: HASH }
      }
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

      const result = run(root, '--no-external')
      assert.notEqual(result.status, 0, `${invalid.kind} '${invalid.name}' unexpectedly passed`)
      assert.match(result.stderr, new RegExp(`${invalid.kind} skill name .* is invalid`))
      assert.equal(fs.existsSync(path.join(root, '.agents')), false)
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside sentinel\n')
    } finally {
      removeFixture(root)
      removeFixture(outsideRoot)
    }
  }
})
