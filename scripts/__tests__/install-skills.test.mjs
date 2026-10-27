import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
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

function writeSkillsLock(rootDir, skills, source = 'open-mercato/skills') {
  const entries = Object.fromEntries(
    skills.map((skill) => [skill, { source, sourceType: 'github', skillPath: `skills/${skill}/SKILL.md` }]),
  )
  writeFileSync(join(rootDir, 'skills-lock.json'), JSON.stringify({ version: 1, skills: entries }, null, 2))
}

// Stands in for `npx skills add` / `skills update`: the skills CLI copies every
// published skill into .agents/skills/ as a real directory, replacing a link
// that sits at the same path without writing through it, and records each one
// in skills-lock.json.
function collectionNpx(rootDir, publishedSkills) {
  return (args) => {
    if (args.includes('add')) {
      for (const skill of publishedSkills) {
        const dir = join(rootDir, '.agents', 'skills', skill)
        const entry = lstatSync(dir, { throwIfNoEntry: false })
        if (entry?.isSymbolicLink()) unlinkSync(dir)
        else if (entry) rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'SKILL.md'), '# external copy\n')
      }
      writeSkillsLock(rootDir, publishedSkills)
    }
    return true
  }
}

function makeUserSkillDir(rootDir, skill) {
  const dir = join(rootDir, '.agents', 'skills', skill)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '# hand-maintained\n')
  writeFileSync(join(dir, 'notes.md'), 'unpublished work\n')
  return dir
}

function assertUserSkillDirKept(dir, warnings, logs, label) {
  assert.ok(lstatSync(dir).isDirectory() && !isLink(dir), `${label}: directory kept, not replaced by a link`)
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), '# hand-maintained\n', `${label}: SKILL.md intact`)
  assert.equal(readFileSync(join(dir, 'notes.md'), 'utf8'), 'unpublished work\n', `${label}: user files intact`)
  assert.match(warnings.join('\n'), /refusing to replace non-link path/, `${label}: warns instead of deleting`)
  assert.doesNotMatch(logs.join('\n'), /replaces the external collection's copy/, `${label}: no replacement logged`)
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

  it('replaces the external collection copy of a selected same-named local tier skill', () => {
    const { installer, logs, warnings } = makeInstaller(rootDir, {
      runNpx: collectionNpx(rootDir, ['skill-a', 'om-external-one']),
    })
    const localSkill = join(rootDir, '.ai', 'skills', 'skill-a')

    for (const pass of ['first run', 're-run']) {
      logs.length = 0
      warnings.length = 0
      assert.equal(installer.run([]), 0)
      const canonical = join(rootDir, '.agents', 'skills', 'skill-a')
      assert.ok(isLink(canonical), `${pass}: canonical entry is the local link, not the collection copy`)
      assert.equal(realpathSync(canonical), realpathSync(localSkill), `${pass}: canonical link targets .ai/skills`)
      const agentLink = join(rootDir, '.claude', 'skills', 'skill-a')
      assert.equal(readFileSync(join(agentLink, 'SKILL.md'), 'utf8'), '# skill-a\n', `${pass}: agents read the local skill`)
      assert.equal(readFileSync(join(localSkill, 'SKILL.md'), 'utf8'), '# skill-a\n', `${pass}: local source untouched`)
      assert.match(logs.join('\n'), /local skill 'skill-a' replaces the external collection's copy/)
      assert.doesNotMatch(warnings.join('\n'), /refusing to replace/)
      const external = join(rootDir, '.agents', 'skills', 'om-external-one')
      assert.ok(lstatSync(external).isDirectory() && !isLink(external), `${pass}: non-colliding external skill kept`)
    }
  })

  it('keeps a hand-maintained directory the lockfile does not attribute to the collection', () => {
    const runners = [
      ['--no-external', ['--no-external'], () => null],
      ['npx not found', [], () => null],
      ['external install failed', [], () => false],
      ['external install succeeded without that skill', [], collectionNpx(rootDir, ['om-external-one'])],
    ]
    for (const [label, args, runNpx] of runners) {
      rmSync(join(rootDir, '.agents'), { recursive: true, force: true })
      rmSync(join(rootDir, 'skills-lock.json'), { force: true })
      const dir = makeUserSkillDir(rootDir, 'skill-a')
      const { installer, logs, warnings } = makeInstaller(rootDir, { runNpx })
      assert.equal(installer.run(args), 0, `${label}: install still succeeds`)
      assertUserSkillDirKept(dir, warnings, logs, label)
    }
  })

  it('keeps the directory when the lockfile is unreadable or names another source', () => {
    const lockVariants = [
      ['malformed lockfile', () => writeFileSync(join(rootDir, 'skills-lock.json'), '{ not json')],
      ['lockfile without skills', () => writeFileSync(join(rootDir, 'skills-lock.json'), '{"version":1}')],
      ['entry from another source', () => writeSkillsLock(rootDir, ['skill-a'], 'someone-else/skills')],
    ]
    for (const [label, writeLock] of lockVariants) {
      rmSync(join(rootDir, '.agents'), { recursive: true, force: true })
      const dir = makeUserSkillDir(rootDir, 'skill-a')
      writeLock()
      const { installer, logs, warnings } = makeInstaller(rootDir)
      assert.equal(installer.run(['--no-external']), 0, `${label}: install still succeeds`)
      assertUserSkillDirKept(dir, warnings, logs, label)
    }
  })

  it('replaces a lockfile-attributed collection copy left by an earlier run under --no-external', () => {
    const { installer: online } = makeInstaller(rootDir, { runNpx: collectionNpx(rootDir, ['skill-c']) })
    assert.equal(online.run([]), 0)
    const canonical = join(rootDir, '.agents', 'skills', 'skill-c')
    assert.ok(!isLink(canonical), 'collection copy installed while skill-c is not selected')

    const { installer, logs } = makeInstaller(rootDir)
    assert.equal(installer.run(['--no-external', '--with', 'extra']), 0)
    assert.ok(isLink(canonical), 'selected local skill replaces the attributed copy offline')
    assert.equal(realpathSync(canonical), realpathSync(join(rootDir, '.ai', 'skills', 'skill-c')))
    assert.match(logs.join('\n'), /local skill 'skill-c' replaces the external collection's copy/)
  })

  it('keeps the external collection copy when the same-named local skill is not selected', () => {
    const { installer, logs } = makeInstaller(rootDir, { runNpx: collectionNpx(rootDir, ['skill-c']) })
    assert.equal(installer.run([]), 0)
    const canonical = join(rootDir, '.agents', 'skills', 'skill-c')
    assert.ok(lstatSync(canonical).isDirectory() && !isLink(canonical), 'collection copy left in place')
    assert.equal(readFileSync(join(canonical, 'SKILL.md'), 'utf8'), '# external copy\n')
    assert.equal(
      readFileSync(join(rootDir, '.claude', 'skills', 'skill-c', 'SKILL.md'), 'utf8'),
      '# external copy\n',
      'claude-code reads the collection copy',
    )
    assert.doesNotMatch(logs.join('\n'), /replaces the external collection's copy/)
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
