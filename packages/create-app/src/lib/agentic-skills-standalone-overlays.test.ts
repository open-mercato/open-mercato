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
  'om-auto-create-pr-loop',
  'om-auto-continue-pr-loop',
  'om-auto-review-pr',
  'om-auto-fix-issue',
]

// om-integration-builder stays a repo-local skill (never external) and keeps its
// STANDALONE.md portability overlay describing the standalone provider layout.
const skillsShippingStandaloneOverlay = ['om-integration-builder']

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
  const missing = skillsShippingOverrideFolder.filter((skill) => {
    const url = new URL(`${skill}/SKILL.md`, skillsDir)
    return !fs.existsSync(url)
  })
  assert.deepEqual(
    missing,
    [],
    `These external skills must ship a repo-local override folder with a SKILL.md: ${missing.join(', ')}`,
  )
})

test('override folders do not also ship a stale STANDALONE.md', () => {
  const stale = skillsShippingOverrideFolder.filter((skill) => {
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
    'om-code-review',
    'om-integration-tests',
    'om-prepare-issue',
    'om-spec-writing',
  ]
  const leftover = shouldNotExist.filter((skill) => fs.existsSync(new URL(`${skill}/`, skillsDir)))
  assert.deepEqual(
    leftover,
    [],
    `These duplicate folders should have been removed (now external): ${leftover.join(', ')}`,
  )
})

test('the scaffolder copies each auto-* override SKILL.md into scaffolded apps', () => {
  // The auto-* family is copied via a loop over an array literal of skill names;
  // each entry copies just `ai/skills/${autoSkill}/SKILL.md`.
  const notWired = skillsShippingOverrideFolder.filter((skill) => {
    const listedInLoop = scaffolderSource.includes(`'${skill}',`)
    const copiesSkillMd = scaffolderSource.includes('ai/skills/${autoSkill}/SKILL.md')
    return !(listedInLoop && copiesSkillMd)
  })
  assert.deepEqual(
    notWired,
    [],
    `These override folders exist in the bundle but generateShared() never copies them: ${notWired.join(', ')}`,
  )
})

test('the scaffolder installs the skills-mixin manifest, tracker, and external installer', () => {
  const required = [
    'ai/skills/tiers.json',
    'ai/skills/tiers.schema.json',
    'ai/agentic.config.json',
    'ai/trackers/github.md',
    'scripts/install-skills.sh',
  ]
  const missing = required.filter((asset) => !scaffolderSource.includes(asset))
  assert.deepEqual(
    missing,
    [],
    `generateShared() must copy the skills-mixin assets into scaffolded apps: ${missing.join(', ')}`,
  )
})

test('portability-sensitive local skills still ship a STANDALONE.md overlay the scaffolder copies', () => {
  for (const skill of skillsShippingStandaloneOverlay) {
    const overlayUrl = new URL(`${skill}/STANDALONE.md`, skillsDir)
    assert.ok(
      fs.existsSync(overlayUrl),
      `${skill} hard-codes monorepo facts and must ship a STANDALONE.md overlay`,
    )
    assert.ok(
      scaffolderSource.includes(`ai/skills/${skill}/STANDALONE.md`),
      `generateShared() must copy the ${skill} STANDALONE.md overlay into scaffolded apps`,
    )
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
