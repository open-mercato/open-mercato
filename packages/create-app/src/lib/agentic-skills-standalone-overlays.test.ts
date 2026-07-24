import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const skillsDir = new URL('../../agentic/shared/ai/skills/', import.meta.url)
const scaffolderSource = fs.readFileSync(
  new URL('../setup/tools/shared.ts', import.meta.url),
  'utf8',
)

// The auto-* PR family + the single autofix skill now live in the external
// open-mercato/skills collection (installed via `yarn install-skills`). The
// scaffold ships a slim repo-local OVERRIDE folder per skill — SKILL.md only,
// no STANDALONE.md — that the external skill reads on top of its built-in
// workflow to adjust for a standalone app (tracker-abstracted base branch, opt-in
// pipeline labels, probe-before-run gate, src/modules/... layout).
const skillsShippingOverrideFolder = [
  'om-auto-create-pr',
  'om-auto-continue-pr',
  'om-auto-review-pr',
  'om-auto-fix-issue',
]

// Knowledge-only override folders: they configure an external skill with repo
// facts (environment commands, probe contracts) rather than tracker behavior,
// so they are exempt from the tracker-abstraction assertions below. The
// om-prepare-test-env override points the skill at the app's own cross-platform
// mercato CLI ephemeral runner — the repo must never ship generated shell
// entrypoints (they are machine-bound and gitignored).
const skillsShippingKnowledgeOverrideFolder = ['om-prepare-test-env']

// The auto-* overrides route everything tracker-facing through the tracker
// abstraction (.ai/trackers/github.md): base branch via the default-branch
// operation (config baseBranch: "auto"), labels via the apply_label/label_exists
// guards. Raw gh commands inside an override bypass the descriptor and break
// non-GitHub trackers, so they are banned.
const skillsOverridingBaseBranch = skillsShippingOverrideFolder

function readOverrideSkill(skill: string): string {
  const url = new URL(`${skill}/SKILL.md`, skillsDir)
  return fs.readFileSync(url, 'utf8')
}

test('every external-owned auto-* skill ships a repo-local override folder with a SKILL.md', () => {
  const missing = [...skillsShippingOverrideFolder, ...skillsShippingKnowledgeOverrideFolder].filter(
    (skill) => {
      const url = new URL(`${skill}/SKILL.md`, skillsDir)
      return !fs.existsSync(url)
    },
  )
  assert.deepEqual(
    missing,
    [],
    `These external skills must ship a repo-local override folder with a SKILL.md: ${missing.join(', ')}`,
  )
})

test('the repo ships no generated test-env shell entrypoints (machine-bound, gitignored)', () => {
  const templateScriptsDir = new URL('../../template/.ai/scripts/', import.meta.url)
  const offenders = ['test-env-up.sh', 'test-env-down.sh'].filter((script) =>
    fs.existsSync(new URL(script, templateScriptsDir)),
  )
  assert.deepEqual(
    offenders,
    [],
    `Generated test-env entrypoints are machine-bound and must not ship with the template (om-prepare-test-env compiles them locally): ${offenders.join(', ')}`,
  )
  const templateGitignore = fs.readFileSync(new URL('../../template/gitignore', import.meta.url), 'utf8')
  assert.ok(
    templateGitignore.includes('.ai/scripts/test-env-'),
    'template gitignore must exclude locally generated .ai/scripts/test-env-* entrypoints',
  )
  const templatePackageJson = fs.readFileSync(
    new URL('../../template/package.json.template', import.meta.url),
    'utf8',
  )
  assert.ok(
    !templatePackageJson.includes('test-env-up.sh') && !templatePackageJson.includes('test-env-down.sh'),
    'template package.json must not wire sh-based test-env scripts (not multiplatform); the mercato CLI commands are the supported interface',
  )
})

test('the template wires the ephemeral runner scripts and the override keeps the ephemeral-first run-mode contract', () => {
  const templatePackageJson = JSON.parse(
    fs.readFileSync(new URL('../../template/package.json.template', import.meta.url), 'utf8'),
  ) as { scripts?: Record<string, string> }
  const scripts = templatePackageJson.scripts ?? {}
  assert.equal(
    scripts['test:integration:ephemeral'],
    'mercato test:integration',
    'test:integration:ephemeral must run the cross-platform mercato CLI suite runner',
  )
  assert.equal(
    scripts['test:integration:ephemeral:start'],
    'mercato test:ephemeral',
    'test:integration:ephemeral:start must boot the app-only ephemeral env via the mercato CLI (reused by iterative filtered runs)',
  )
  const override = readOverrideSkill('om-prepare-test-env')
  assert.ok(
    override.includes('test:integration:ephemeral:start'),
    'the om-prepare-test-env override must document the boot-once start script for iterative reuse',
  )
  assert.ok(
    /prefer(red)? over plain `yarn test:integration`/i.test(override),
    'the om-prepare-test-env override must state that test:integration:ephemeral is preferred over plain test:integration',
  )
  assert.ok(
    /ASK before the first run/.test(override),
    'the om-prepare-test-env override must instruct skills to ask the user which run mode they want',
  )
})

test('override folders do not also ship a stale STANDALONE.md', () => {
  const stale = [...skillsShippingOverrideFolder, ...skillsShippingKnowledgeOverrideFolder].filter((skill) => {
    const url = new URL(`${skill}/STANDALONE.md`, skillsDir)
    return fs.existsSync(url)
  })
  assert.deepEqual(
    stale,
    [],
    `Override folders keep only SKILL.md; these still ship a STANDALONE.md: ${stale.join(', ')}`,
  )
})

test('the deleted duplicate full-copy skill folders are gone', () => {
  // These skills are now installed from the external collection with no
  // standalone-specific behavior, so the scaffold no longer ships a copy.
  const shouldNotExist = [
    'om-auto-fix-github',
    'om-apply-upgrade-notes',
    'om-code-review',
    'om-fix',
    'om-integration-tests',
    'om-open-pr',
    'om-prepare-issue',
    'om-root-cause',
    'om-setup-agent-pipeline',
    'om-spec-writing',
    'om-verify-in-repo',
  ]
  const leftover = shouldNotExist.filter((skill) => fs.existsSync(new URL(`${skill}/`, skillsDir)))
  assert.deepEqual(
    leftover,
    [],
    `These duplicate folders should have been removed (now external): ${leftover.join(', ')}`,
  )
})

test('tiers.json owns a pinned, hashed, dependency-closed external skill set', () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL('tiers.json', skillsDir), 'utf8'),
  ) as {
    external?: {
      ref?: string
      cli?: { package?: string; version?: string }
      skills?: string[]
      dependencies?: Record<string, string[]>
      contentHashes?: Record<string, string>
    }
  }
  const external = manifest.external
  const externalSkills = new Set(external?.skills ?? [])
  assert.equal(external?.ref, 'cf42eaf277a91c3906ffa910a1cdfeb121fe8322')
  assert.deepEqual(external?.cli, { package: 'skills', version: '1.5.20' })
  assert.ok(externalSkills.has('om-setup-agent-pipeline'), 'om-setup-agent-pipeline must be installed')
  const missing: string[] = []
  for (const skill of externalSkills) {
    const deps = external?.dependencies?.[skill]
    if (!deps) {
      missing.push(`${skill} has no dependency graph entry`)
      continue
    }
    for (const dep of deps) {
      if (!externalSkills.has(dep)) missing.push(`${skill} requires ${dep}`)
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(external?.contentHashes?.[skill] ?? '')) {
      missing.push(`${skill} has no pinned content hash`)
    }
  }
  assert.deepEqual(
    missing,
    [],
    `tiers.json external.skills is missing hard dependencies: ${missing.join('; ')}`,
  )
})

test('the scaffolder copies each auto-* override SKILL.md into scaffolded apps', () => {
  assert.ok(
    scaffolderSource.includes("copyTree(join(AGENTIC_DIR, 'ai'), join(targetDir, '.ai'), config)"),
    'generateShared() must recursively copy the shared ai tree so skill references cannot be omitted by a stale file list',
  )
})

test('the scaffolder installs the skills-mixin manifest, tracker, and external installer', () => {
  assert.ok(
    scaffolderSource.includes("copyTree(join(AGENTIC_DIR, 'scripts'), join(targetDir, 'scripts'), config)"),
    'generateShared() must recursively copy installer scripts',
  )
  for (const asset of ['tiers.json', 'tiers.schema.json']) {
    assert.ok(fs.existsSync(new URL(asset, skillsDir)), `the recursive source tree must contain ${asset}`)
  }
})

test('auto-* override SKILL.md routes tracker-facing behavior through the tracker abstraction', () => {
  const missingAbstraction: string[] = []
  const rawTrackerCommands: string[] = []
  for (const skill of skillsOverridingBaseBranch) {
    const overlay = readOverrideSkill(skill)
    if (!overlay.includes('default-branch') || !overlay.includes('.ai/trackers/github.md')) {
      missingAbstraction.push(skill)
    }
    if (/\bgh (pr|issue|label|repo|api)\b/.test(overlay)) {
      rawTrackerCommands.push(skill)
    }
  }
  assert.deepEqual(
    missingAbstraction,
    [],
    `These overrides must defer to the tracker descriptor (default-branch operation, .ai/trackers/github.md): ${missingAbstraction.join(', ')}`,
  )
  assert.deepEqual(
    rawTrackerCommands,
    [],
    `These overrides inline raw gh commands instead of tracker operations: ${rawTrackerCommands.join(', ')}`,
  )
})

// Setup never creates a directory-level link. The installer owns Claude's
// per-skill compatibility layer after the canonical collection exists.
test('setup leaves every per-agent skills directory to install-skills.mjs', () => {
  const generators = [
    ['create-app: claude-code', '../setup/tools/claude-code.ts', []],
    ['create-app: codex', '../setup/tools/codex.ts', []],
    ['create-app: cursor', '../setup/tools/cursor.ts', []],
  ] as const

  const offenders: string[] = []
  for (const [label, relativePath, expectedDirs] of generators) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    for (const harness of ['.claude', '.codex', '.cursor']) {
      const seedsDir = source.includes(`join(targetDir, '${harness}', 'skills')`)
      const shouldSeed = (expectedDirs as readonly string[]).includes(harness)
      if (seedsDir !== shouldSeed) {
        offenders.push(`${label}: ${seedsDir ? 'seeds' : 'does not seed'} ${harness}/skills (expected ${shouldSeed ? 'seeded' : 'none'})`)
      }
    }
  }

  // packages/cli/src/lib/agentic-setup.ts mirrors the generators 1:1.
  const cliMirror = fs.readFileSync(
    new URL('../../../cli/src/lib/agentic-setup.ts', import.meta.url),
    'utf8',
  )
  for (const harness of ['.codex', '.cursor']) {
    if (cliMirror.includes(`join(targetDir, '${harness}', 'skills')`)) {
      offenders.push(`cli agentic-setup.ts: seeds ${harness}/skills (expected none)`)
    }
  }
  if (cliMirror.includes("join(targetDir, '.claude', 'skills')")) {
    offenders.push('cli agentic-setup.ts: seeds .claude/skills (expected none)')
  }

  assert.deepEqual(
    offenders,
    [],
    `install-skills.mjs owns all compatibility links; setup must not seed skills directories: ${offenders.join(', ')}`,
  )
})

// The agent harness is user-selectable at scaffold time (--agents
// claude-code,codex,cursor). generateShared() writes the same AGENTS.md.template
// for every harness and only substitutes {{PROJECT_NAME}}, so routing an
// external skill through a hard-coded `.claude/skills/…` path misleads a
// Codex/Cursor scaffold (Codex reads .agents/skills/, never .claude/skills). The
// routing tables must reference external skills by name and let each harness
// resolve them from its own directory.
test('AGENTS.md routing tables do not hard-code a harness-specific skills path for external skills', () => {
  const agentsTemplate = fs.readFileSync(
    new URL('../../agentic/shared/AGENTS.md.template', import.meta.url),
    'utf8',
  )
  const readyAppAgents = fs.readFileSync(
    new URL('../../template/AGENTS.md', import.meta.url),
    'utf8',
  )
  const externalSkills = [
    ...skillsShippingOverrideFolder,
    'om-code-review',
    'om-spec-writing',
    'om-integration-tests',
  ]
  const offenders: string[] = []
  for (const [label, content] of [
    ['AGENTS.md.template', agentsTemplate],
    ['template/AGENTS.md', readyAppAgents],
  ] as const) {
    for (const skill of externalSkills) {
      for (const harnessDir of ['.claude/skills', '.codex/skills', '.agents/skills']) {
        if (content.includes(`${harnessDir}/${skill}/SKILL.md`)) {
          offenders.push(`${label}: ${harnessDir}/${skill}/SKILL.md`)
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `External skills must be referenced by name (harness-agnostic), not via a hard-coded harness path: ${offenders.join(', ')}`,
  )
})
