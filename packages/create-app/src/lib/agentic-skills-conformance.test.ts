import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { copySkillTree } from '../setup/tools/shared.js'
import type { AgenticConfig } from '../setup/wizard.js'

const skillsDir = fileURLToPath(new URL('../../agentic/shared/ai/skills/', import.meta.url))
const scaffolderSource = fs.readFileSync(
  new URL('../setup/tools/shared.ts', import.meta.url),
  'utf8',
)

// The skills restructured into the thin-SKILL.md + workflow/ + references/ layout
// (spec 2026-06-27-create-app-agentic-skills-restructure.md, Phase 2). These formerly
// shipped a STANDALONE.md override; that override is now authored natively.
const RESTRUCTURED_SKILLS = [
  'om-auto-create-pr',
  'om-auto-continue-pr',
  'om-auto-create-pr-loop',
  'om-auto-continue-pr-loop',
  'om-auto-review-pr',
  'om-auto-fix-github',
  'om-integration-builder',
]

const SKILL_LINE_BUDGET = 60

function makeConfig(targetDir: string): AgenticConfig {
  return { projectName: 'sample-app', targetDir, agentTools: ['claude-code'], pr: { baseBranch: 'auto' } }
}

function readSkill(skill: string): string {
  return fs.readFileSync(path.join(skillsDir, skill, 'SKILL.md'), 'utf8')
}

function frontmatterDescription(source: string): string | null {
  const match = source.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const line = match[1].split('\n').find((entry) => entry.startsWith('description:'))
  return line ? line.slice('description:'.length).trim() : null
}

function referenceMapLinks(source: string): string[] {
  const links = source.match(/(?:workflow|references|subagents)\/[A-Za-z0-9._-]+\.md/g) ?? []
  return [...new Set(links)]
}

function collectStandaloneFiles(dir: string, found: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) collectStandaloneFiles(entryPath, found)
    else if (entry.name === 'STANDALONE.md') found.push(entryPath)
  }
}

test('no skill ships a STANDALONE.md override anymore', () => {
  const agenticRoot = fileURLToPath(new URL('../../agentic/', import.meta.url))
  const found: string[] = []
  collectStandaloneFiles(agenticRoot, found)
  assert.deepEqual(found, [], `STANDALONE.md overrides were retired; remove: ${found.join(', ')}`)
})

for (const skill of RESTRUCTURED_SKILLS) {
  test(`${skill}: SKILL.md is a thin router (frontmatter description + line budget + resolvable reference map)`, () => {
    const source = readSkill(skill)

    const description = frontmatterDescription(source)
    assert.ok(
      description && description.length > 0,
      `${skill}/SKILL.md must keep a non-empty frontmatter description (load-bearing for auto-discovery)`,
    )

    const lineCount = source.split('\n').length
    assert.ok(
      lineCount <= SKILL_LINE_BUDGET,
      `${skill}/SKILL.md is ${lineCount} lines; the thin-router budget is ${SKILL_LINE_BUDGET}`,
    )

    const links = referenceMapLinks(source)
    assert.ok(links.length > 0, `${skill}/SKILL.md must include a reference map pointing at instruction files`)
    for (const link of links) {
      assert.ok(
        fs.existsSync(path.join(skillsDir, skill, link)),
        `${skill}/SKILL.md reference-map link does not resolve: ${link}`,
      )
    }
  })

  test(`${skill}: SKILL.md holds no inlined procedure (router sections only)`, () => {
    const body = readSkill(skill).replace(/^---\n[\s\S]*?\n---/, '')
    const numberedStepHeading = body.match(/^#{2,3}\s+\d+[.)]/m)
    assert.equal(
      numberedStepHeading,
      null,
      `${skill}/SKILL.md must not inline numbered procedure steps (${numberedStepHeading?.[0]}); move them to workflow/`,
    )
    assert.equal(
      /^##\s+Workflow\s*$/m.test(body),
      false,
      `${skill}/SKILL.md must not carry a "## Workflow" procedure body; it belongs in workflow/`,
    )
  })
}

test('the scaffolder recursively copies each skill directory (not a hard-coded file list)', () => {
  assert.match(
    scaffolderSource,
    /copySkillTree\(/,
    'generateShared() must recursively copy each skill directory via copySkillTree',
  )
  assert.match(
    scaffolderSource,
    /readdirSync\(skillsSrcDir/,
    'generateShared() must iterate every skill directory under ai/skills/',
  )
})

test('copySkillTree recursively copies a restructured skill tree (SKILL.md + nested workflow/)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copy-'))
  try {
    copySkillTree(
      path.join(skillsDir, 'om-auto-create-pr'),
      path.join(tmpDir, 'om-auto-create-pr'),
      makeConfig(tmpDir),
    )
    assert.ok(fs.existsSync(path.join(tmpDir, 'om-auto-create-pr', 'SKILL.md')), 'SKILL.md must be copied')
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'om-auto-create-pr', 'workflow', 'step-1-plan-and-claim.md')),
      'nested workflow/ files must be copied recursively',
    )
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('copySkillTree resolves {{PROJECT_NAME}} — no literal placeholder survives the copy', () => {
  // om-spec-writing ships {{PROJECT_NAME}} in its SKILL.md; prove the recursive copy
  // resolves it in every text file rather than shipping the raw token.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copy-'))
  try {
    copySkillTree(
      path.join(skillsDir, 'om-spec-writing'),
      path.join(tmpDir, 'om-spec-writing'),
      makeConfig(tmpDir),
    )
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(entryPath)
        else if (fs.readFileSync(entryPath, 'utf8').includes('{{PROJECT_NAME}}')) offenders.push(entryPath)
      }
    }
    walk(path.join(tmpDir, 'om-spec-writing'))
    assert.deepEqual(offenders, [], `copied files must not contain a literal {{PROJECT_NAME}}: ${offenders.join(', ')}`)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
