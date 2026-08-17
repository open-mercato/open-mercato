import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { createInstaller } from '../install-skills.mjs'
import { validateSkillsTiers } from '../validate-skills-tiers.mjs'

const tempRoots = []

function makeFixtureRepo({ manifest, skills = [] } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'om-install-skills-'))
  tempRoots.push(rootDir)
  const skillsDir = join(rootDir, '.ai', 'skills')
  mkdirSync(skillsDir, { recursive: true })
  for (const skill of skills) {
    mkdirSync(join(skillsDir, skill), { recursive: true })
    writeFileSync(join(skillsDir, skill, 'SKILL.md'), `# ${skill}\n`)
  }
  const defaultManifest = {
    default: ['core'],
    external: { source: 'open-mercato/skills', skills: ['om-external-one'] },
    tiers: {
      core: { description: 'core', skills: ['skill-a', 'skill-b'] },
      extra: { description: 'extra', skills: ['skill-c'] },
    },
  }
  writeFileSync(join(skillsDir, 'tiers.json'), JSON.stringify(manifest ?? defaultManifest, null, 2))
  return rootDir
}

function makeInstaller(rootDir, { runNpx } = {}) {
  const logs = []
  const warnings = []
  const installer = createInstaller({
    rootDir,
    log: (message) => logs.push(String(message)),
    warn: (message) => warnings.push(String(message)),
    runNpx: runNpx ?? (() => null),
  })
  return { installer, logs, warnings }
}

function isLink(path) {
  return Boolean(lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
}

after(() => {
  for (const rootDir of tempRoots) rmSync(rootDir, { recursive: true, force: true })
})

describe('validate-skills-tiers', () => {
  it('accepts a consistent manifest', () => {
    const rootDir = makeFixtureRepo({ skills: ['skill-a', 'skill-b', 'skill-c'] })
    const result = validateSkillsTiers(rootDir)
    assert.deepEqual(result.errors, [])
    assert.equal(result.skillCount, 3)
    assert.equal(result.tierCount, 2)
  })

  it('flags unassigned folders, stale tier entries, and external/tier overlap', () => {
    const rootDir = makeFixtureRepo({
      manifest: {
        default: ['core'],
        external: { source: 'open-mercato/skills', skills: ['om-external-one'] },
        tiers: { core: { description: 'core', skills: ['skill-a', 'skill-gone', 'om-external-one'] } },
      },
      skills: ['skill-a', 'skill-orphan', 'om-external-one'],
    })
    const messages = validateSkillsTiers(rootDir).errors.join('\n')
    assert.match(messages, /not assigned to any tier: skill-orphan/)
    assert.match(messages, /do not exist on disk: skill-gone/)
    assert.match(messages, /both in a tier and in 'external.skills': om-external-one/)
  })

  it('ignores external override folders on disk', () => {
    const rootDir = makeFixtureRepo({ skills: ['skill-a', 'skill-b', 'skill-c', 'om-external-one'] })
    assert.deepEqual(validateSkillsTiers(rootDir).errors, [])
  })

  it('flags unknown agents in agents.ignore', () => {
    const rootDir = makeFixtureRepo({
      manifest: {
        default: ['core'],
        agents: { ignore: ['emacs'] },
        tiers: { core: { description: 'core', skills: ['skill-a'] } },
      },
      skills: ['skill-a'],
    })
    assert.match(validateSkillsTiers(rootDir).errors.join('\n'), /unknown agent\(s\): emacs/)
  })
})

describe('install-skills', () => {
  let rootDir

  beforeEach(() => {
    rootDir = makeFixtureRepo({ skills: ['skill-a', 'skill-b', 'skill-c'] })
  })

  it('links default-tier skills into the canonical and claude-code directories', () => {
    const { installer } = makeInstaller(rootDir)
    assert.equal(installer.run(['--no-external']), 0)

    for (const skill of ['skill-a', 'skill-b']) {
      const canonical = join(rootDir, '.agents', 'skills', skill)
      assert.ok(isLink(canonical), `${skill} canonical link exists`)
      assert.equal(realpathSync(canonical), realpathSync(join(rootDir, '.ai', 'skills', skill)))
      const agentLink = join(rootDir, '.claude', 'skills', skill)
      assert.ok(isLink(agentLink), `${skill} claude-code link exists`)
      assert.equal(realpathSync(agentLink), realpathSync(join(rootDir, '.ai', 'skills', skill)))
    }
    assert.ok(!existsSync(join(rootDir, '.agents', 'skills', 'skill-c')), 'opt-in tier skill not installed')
    assert.ok(!existsSync(join(rootDir, '.codex', 'skills')), 'canonical readers get no per-agent links')
  })

  it('installs opt-in tiers with --with and sweeps them on a later default run', () => {
    const { installer } = makeInstaller(rootDir)
    assert.equal(installer.run(['--no-external', '--with', 'extra']), 0)
    assert.ok(isLink(join(rootDir, '.agents', 'skills', 'skill-c')))

    assert.equal(installer.run(['--no-external']), 0)
    assert.ok(!existsSync(join(rootDir, '.agents', 'skills', 'skill-c')), 'stale tier link swept')
    assert.ok(!existsSync(join(rootDir, '.claude', 'skills', 'skill-c')), 'stale agent link swept')
    assert.ok(isLink(join(rootDir, '.agents', 'skills', 'skill-a')))
  })

  it('rejects unknown tiers and mutually exclusive selection flags', () => {
    const { installer } = makeInstaller(rootDir)
    assert.throws(() => installer.run(['--no-external', '--tiers', 'nope']), /unknown tier 'nope'/)
    assert.throws(() => installer.run(['--no-external', '--all', '--with', 'extra']), /mutually exclusive/)
  })

  it('mirrors external real directories into agent link dirs and prunes dangling links', () => {
    const externalDir = join(rootDir, '.agents', 'skills', 'om-external-one')
    mkdirSync(externalDir, { recursive: true })
    writeFileSync(join(externalDir, 'SKILL.md'), '# external\n')

    const { installer } = makeInstaller(rootDir)
    assert.equal(installer.run(['--no-external']), 0)
    const mirrored = join(rootDir, '.claude', 'skills', 'om-external-one')
    assert.ok(isLink(mirrored), 'external skill mirrored into claude-code dir')
    assert.equal(realpathSync(mirrored), realpathSync(externalDir))
    assert.ok(
      lstatSync(externalDir).isDirectory() && !lstatSync(externalDir).isSymbolicLink(),
      'external real directory untouched by sweep',
    )

    rmSync(externalDir, { recursive: true, force: true })
    assert.equal(installer.run(['--no-external']), 0)
    assert.ok(!existsSync(mirrored) && !isLink(mirrored), 'dangling external link pruned')
  })

  it('respects --ignore-agents', () => {
    const { installer } = makeInstaller(rootDir)
    assert.equal(installer.run(['--no-external', '--ignore-agents', 'claude-code']), 0)
    assert.ok(isLink(join(rootDir, '.agents', 'skills', 'skill-a')))
    assert.ok(!existsSync(join(rootDir, '.claude', 'skills')))
  })

  it('removes everything harness-owned with --clean', () => {
    const { installer } = makeInstaller(rootDir)
    assert.equal(installer.run(['--no-external']), 0)
    assert.equal(installer.run(['--clean']), 0)
    assert.ok(!existsSync(join(rootDir, '.agents', 'skills')))
    assert.ok(!existsSync(join(rootDir, '.claude', 'skills')))
  })

  it('replaces a legacy directory-level link with a real directory', () => {
    const skillsDir = join(rootDir, '.ai', 'skills')
    mkdirSync(join(rootDir, '.claude'), { recursive: true })
    symlinkSync(resolve(skillsDir), join(rootDir, '.claude', 'skills'), 'junction')

    const { installer } = makeInstaller(rootDir)
    assert.equal(installer.run(['--no-external']), 0)
    const harness = lstatSync(join(rootDir, '.claude', 'skills'))
    assert.ok(harness.isDirectory() && !harness.isSymbolicLink())
    assert.ok(isLink(join(rootDir, '.claude', 'skills', 'skill-a')))
  })

  it('reports external status from the npx runner without failing the install', () => {
    const calls = []
    const { installer, logs } = makeInstaller(rootDir, {
      runNpx: (args) => {
        calls.push(args)
        return args.includes('add')
      },
    })
    assert.equal(installer.run([]), 0)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].slice(0, 4), ['-y', 'skills', 'add', 'open-mercato/skills'])
    assert.ok(calls[0].includes('claude-code'))
    assert.match(logs.join('\n'), /External skills: installed from open-mercato\/skills\./)
    assert.ok(isLink(join(rootDir, '.agents', 'skills', 'skill-a')), 'local install proceeds after failed update')
  })

  it('skips the external step when npx is unavailable', () => {
    const { installer, logs, warnings } = makeInstaller(rootDir, { runNpx: () => null })
    assert.equal(installer.run([]), 0)
    assert.match(logs.join('\n'), /External skills: skipped \(npx not found\)\./)
    assert.match(warnings.join('\n'), /npx not found/)
  })

  it('prints the catalog and install state with --list', () => {
    const { installer, logs } = makeInstaller(rootDir)
    assert.equal(installer.run(['--no-external']), 0)
    logs.length = 0
    assert.equal(installer.run(['--list']), 0)
    const output = logs.join('\n')
    assert.match(output, /core\s+\(2 skills, default\)/)
    assert.match(output, /extra\s+\(1 skills, opt-in\)/)
    assert.match(output, /external\s+\(1 skills, from open-mercato\/skills\)/)
    assert.match(output, /Currently installed: core \(2 local skills\)/)
  })
})
