import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The repository installer retains its own monorepo-only validation contract.
// The standalone Node installer has a dedicated cross-platform test below; this
// legacy harness remains focused on the repository shell entry point.
//
//   - local tier skills live ONCE, in the canonical .agents/skills/
//   - per-agent symlinks exist only for agents that cannot read that directory
//     (Claude Code); Codex and Cursor read it natively and get no directory
//   - --legacy-links restores the historical .claude + .codex per-skill layout
//   - agents.ignore / --ignore-agents suppress an agent's directory entirely
//   - a repo-local override of an external skill is never symlinked anywhere
//   - external skills reach every agent that cannot read the canonical directory
const monorepoScript = fileURLToPath(new URL('../../../../scripts/install-skills.sh', import.meta.url))
const monorepoValidator = fileURLToPath(new URL('../../../../scripts/validate-skills-tiers.sh', import.meta.url))

const LOCAL_SKILLS = ['om-alpha', 'om-beta']
const EXTERNAL_SKILL = 'om-code-review'
// The shape `npx skills add` leaves behind: a real directory in the canonical
// dir, not a symlink into .ai/skills/ the way a local tier skill is.
const INSTALLED_EXTERNAL_SKILL = 'om-auto-review-pr'

const jqMissing = spawnSync('jq', ['--version']).status !== 0
const skip = jqMissing ? 'jq is required by install-skills.sh but is not installed' : false

type Variant = 'monorepo'

function createFixture(variant: Variant, manifestExtras: Record<string, unknown> = {}): string {
  // realpath so macOS /tmp -> /private/tmp does not break path comparisons.
  const appDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-install-skills-')))

  for (const skill of [...LOCAL_SKILLS, EXTERNAL_SKILL]) {
    const skillDir = path.join(appDir, '.ai', 'skills', skill)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${skill}\n`)
  }

  const manifest = {
    default: ['core'],
    external: {
      source: 'open-mercato/skills',
      // Present on disk as a repo-local override; must never be symlinked.
      skills: [EXTERNAL_SKILL],
    },
    tiers: {
      core: { description: 'Test tier.', skills: LOCAL_SKILLS },
    },
    ...manifestExtras,
  }
  fs.writeFileSync(
    path.join(appDir, '.ai', 'skills', 'tiers.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  fs.mkdirSync(path.join(appDir, 'scripts'), { recursive: true })
  fs.copyFileSync(monorepoScript, path.join(appDir, 'scripts', 'install-skills.sh'))

  if (variant === 'monorepo') {
    // The monorepo script resolves its root via git and runs the tier validator.
    fs.copyFileSync(monorepoValidator, path.join(appDir, 'scripts', 'validate-skills-tiers.sh'))
    const init = spawnSync('git', ['init', '-q'], { cwd: appDir })
    assert.equal(init.status, 0, 'git init failed for the monorepo fixture')
  }

  return appDir
}

function runInstall(appDir: string, args: string[] = []): ReturnType<typeof spawnSync> {
  return spawnSync('sh', [path.join(appDir, 'scripts', 'install-skills.sh'), '--no-external', ...args], {
    cwd: appDir,
    encoding: 'utf8',
  })
}

// Stand in for the external collection without going to the network: the tests
// run with --no-external, so seeding the directory the skills CLI would have
// written lets the link layer be asserted offline.
function seedInstalledExternalSkill(appDir: string, name = INSTALLED_EXTERNAL_SKILL): void {
  const skillDir = path.join(appDir, '.agents', 'skills', name)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${name}\n`)
}

function readLink(appDir: string, ...segments: string[]): string {
  return fs.readlinkSync(path.join(appDir, ...segments)).split(path.sep).join('/')
}

function exists(appDir: string, ...segments: string[]): boolean {
  return fs.existsSync(path.join(appDir, ...segments))
}

for (const variant of ['monorepo'] as const) {
  test(`[${variant}] default layout installs local skills once, into .agents/skills/`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      const result = runInstall(appDir)
      assert.equal(result.status, 0, result.stderr)

      for (const skill of LOCAL_SKILLS) {
        assert.equal(readLink(appDir, '.agents', 'skills', skill), `../../.ai/skills/${skill}`)
        // Claude Code cannot read .agents/skills/, so it keeps a link layer that
        // points at the canonical copy rather than duplicating it.
        assert.equal(readLink(appDir, '.claude', 'skills', skill), `../../.agents/skills/${skill}`)
      }

      // Codex and Cursor read the canonical directory natively — no duplication.
      assert.equal(exists(appDir, '.codex', 'skills'), false)
      assert.equal(exists(appDir, '.cursor', 'skills'), false)

      // A repo-local override of an external skill is read in place, never linked.
      assert.equal(exists(appDir, '.agents', 'skills', EXTERNAL_SKILL), false)
      assert.equal(exists(appDir, '.claude', 'skills', EXTERNAL_SKILL), false)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] external skills are linked for agents that cannot read the canonical dir`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      seedInstalledExternalSkill(appDir)

      const result = runInstall(appDir)
      assert.equal(result.status, 0, result.stderr)

      // The skills CLI does not reliably write this link (vercel-labs/skills#744),
      // so the installer owns it: without it Claude Code loses every shared skill.
      assert.equal(
        readLink(appDir, '.claude', 'skills', INSTALLED_EXTERNAL_SKILL),
        `../../.agents/skills/${INSTALLED_EXTERNAL_SKILL}`,
      )
      // The canonical copy stays a real directory — it is never replaced by a link.
      assert.equal(fs.lstatSync(path.join(appDir, '.agents', 'skills', INSTALLED_EXTERNAL_SKILL)).isSymbolicLink(), false)
      // Codex and Cursor read the canonical directory, so they still get nothing.
      assert.equal(exists(appDir, '.codex', 'skills'), false)
      assert.equal(exists(appDir, '.cursor', 'skills'), false)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] --ignore-agents suppresses external links too`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      seedInstalledExternalSkill(appDir)

      const result = runInstall(appDir, ['--ignore-agents', 'claude-code'])
      assert.equal(result.status, 0, result.stderr)

      assert.equal(exists(appDir, '.claude', 'skills'), false)
      assert.equal(exists(appDir, '.agents', 'skills', INSTALLED_EXTERNAL_SKILL), true)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] a link to a dropped external skill is pruned on re-run`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      seedInstalledExternalSkill(appDir)
      assert.equal(runInstall(appDir).status, 0)
      assert.equal(exists(appDir, '.claude', 'skills', INSTALLED_EXTERNAL_SKILL), true)

      // The collection stops shipping the skill: `skills update` drops it from the
      // canonical dir, leaving the agent link dangling.
      fs.rmSync(path.join(appDir, '.agents', 'skills', INSTALLED_EXTERNAL_SKILL), { recursive: true, force: true })

      const result = runInstall(appDir)
      assert.equal(result.status, 0, result.stderr)
      // lstat, not exists: a dangling symlink is invisible to exists().
      assert.equal(
        fs.lstatSync(path.join(appDir, '.claude', 'skills', INSTALLED_EXTERNAL_SKILL), { throwIfNoEntry: false }),
        undefined,
      )
      // Local tier skills are untouched by the prune.
      for (const skill of LOCAL_SKILLS) {
        assert.equal(readLink(appDir, '.claude', 'skills', skill), `../../.agents/skills/${skill}`)
      }
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] --legacy-links restores the per-agent layout`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      seedInstalledExternalSkill(appDir)

      const result = runInstall(appDir, ['--legacy-links'])
      assert.equal(result.status, 0, result.stderr)

      for (const skill of LOCAL_SKILLS) {
        assert.equal(readLink(appDir, '.claude', 'skills', skill), `../../.ai/skills/${skill}`)
        assert.equal(readLink(appDir, '.codex', 'skills', skill), `../../.ai/skills/${skill}`)
      }
      // External skills only exist in the canonical dir, so both legacy agents
      // link there even when tier skills fall back to the .ai/skills/ layout.
      for (const agentDir of ['.claude', '.codex']) {
        assert.equal(
          readLink(appDir, agentDir, 'skills', INSTALLED_EXTERNAL_SKILL),
          `../../.agents/skills/${INSTALLED_EXTERNAL_SKILL}`,
        )
      }
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] a default re-run sweeps stale legacy links away`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      assert.equal(runInstall(appDir, ['--legacy-links']).status, 0)
      assert.equal(exists(appDir, '.codex', 'skills'), true)

      const result = runInstall(appDir)
      assert.equal(result.status, 0, result.stderr)
      // The upgrade self-heals: no leftover .codex/skills from the old layout.
      assert.equal(exists(appDir, '.codex', 'skills'), false)
      for (const skill of LOCAL_SKILLS) {
        assert.equal(readLink(appDir, '.agents', 'skills', skill), `../../.ai/skills/${skill}`)
      }
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] --ignore-agents suppresses that agent's directory`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      const result = runInstall(appDir, ['--ignore-agents', 'claude-code'])
      assert.equal(result.status, 0, result.stderr)

      assert.equal(exists(appDir, '.claude', 'skills'), false)
      for (const skill of LOCAL_SKILLS) {
        assert.equal(readLink(appDir, '.agents', 'skills', skill), `../../.ai/skills/${skill}`)
      }
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] agents.ignore in tiers.json is honored without a flag`, { skip }, () => {
    const appDir = createFixture(variant, { agents: { ignore: ['claude-code'] } })
    try {
      const result = runInstall(appDir)
      assert.equal(result.status, 0, result.stderr)

      assert.equal(exists(appDir, '.claude', 'skills'), false)
      assert.equal(exists(appDir, '.agents', 'skills', LOCAL_SKILLS[0]), true)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] an unknown agent id fails fast`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      const result = runInstall(appDir, ['--ignore-agents', 'bogus-agent'])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /unknown agent/)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test(`[${variant}] --clean removes both the canonical and the legacy layout`, { skip }, () => {
    const appDir = createFixture(variant)
    try {
      assert.equal(runInstall(appDir, ['--legacy-links']).status, 0)

      const result = spawnSync('sh', [path.join(appDir, 'scripts', 'install-skills.sh'), '--clean'], {
        cwd: appDir,
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)

      assert.equal(exists(appDir, '.agents', 'skills'), false)
      assert.equal(exists(appDir, '.claude', 'skills'), false)
      assert.equal(exists(appDir, '.codex', 'skills'), false)
      // The skills themselves are untouched — only the generated links are swept.
      assert.equal(exists(appDir, '.ai', 'skills', LOCAL_SKILLS[0], 'SKILL.md'), true)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })
}

test('gitignore keeps the canonical skills directory out of version control', () => {
  const rootIgnore = fs.readFileSync(new URL('../../../../.gitignore', import.meta.url), 'utf8')
  const templateIgnore = fs.readFileSync(new URL('../../template/gitignore', import.meta.url), 'utf8')

  assert.match(rootIgnore, /^\.agents\/$/m, 'root .gitignore must ignore .agents/')
  assert.match(templateIgnore, /^\.agents\/skills\/$/m, 'template gitignore must ignore .agents/skills/')
})
