import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { copySkillTree } from '../setup/tools/shared.js'
import type { AgenticConfig } from '../setup/wizard.js'

const skillsDir = new URL('../../agentic/shared/ai/skills/', import.meta.url)
const scaffolderSource = fs.readFileSync(
  new URL('../setup/tools/shared.ts', import.meta.url),
  'utf8',
)

function makeConfig(targetDir: string): AgenticConfig {
  return { projectName: 'sample-app', targetDir, agentTools: ['claude-code'], pr: { baseBranch: 'auto' } }
}

// Skills that hard-code monorepo facts (base branch, pipeline labels, packages/ layout)
// MUST ship a STANDALONE.md overlay so they behave correctly in a scaffolded standalone app.
const skillsRequiringStandaloneOverlay = [
  'om-auto-create-pr',
  'om-auto-continue-pr',
  'om-auto-create-pr-loop',
  'om-auto-continue-pr-loop',
  'om-auto-fix-github',
  'om-auto-review-pr',
  'om-integration-builder',
]

// The auto-* family hard-codes `develop`; their overlay must redirect to the discovered default branch.
const skillsOverridingBaseBranch = skillsRequiringStandaloneOverlay.filter((name) =>
  name.startsWith('om-auto-'),
)

function readOverlay(skill: string): string {
  const url = new URL(`${skill}/STANDALONE.md`, skillsDir)
  return fs.readFileSync(url, 'utf8')
}

test('portability-sensitive skills ship a STANDALONE.md overlay', () => {
  const missing = skillsRequiringStandaloneOverlay.filter((skill) => {
    const url = new URL(`${skill}/STANDALONE.md`, skillsDir)
    return !fs.existsSync(url)
  })
  assert.deepEqual(
    missing,
    [],
    `These skills hard-code monorepo facts and must ship a STANDALONE.md overlay: ${missing.join(', ')}`,
  )
})

test('the scaffolder recursively copies each skill directory (whole tree, not a hard-coded file list)', () => {
  // generateShared() copies skills via a recursive skill-directory walk
  // (`copySkillTree`), not per-file `copyFile` calls. This guards against a
  // regression back to hard-coded per-skill file lists that would silently drop
  // new files (workflow/, subagents/, STANDALONE.md, …) from scaffolded apps.
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

test('copySkillTree copies a whole skill tree — including its STANDALONE.md while it still ships', () => {
  // Functional proof that the recursive copy ships every file in a skill dir
  // (until Phase 2 deletes STANDALONE.md, the recursive copy still carries it).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-copy-'))
  try {
    const srcSkill = path.join(fileURLToPath(skillsDir), 'om-auto-create-pr')
    const destSkill = path.join(tmpDir, 'om-auto-create-pr')
    copySkillTree(srcSkill, destSkill, makeConfig(tmpDir))
    assert.ok(fs.existsSync(path.join(destSkill, 'SKILL.md')), 'SKILL.md must be copied')
    assert.ok(fs.existsSync(path.join(destSkill, 'STANDALONE.md')), 'STANDALONE.md must be copied while it still ships')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('auto-* STANDALONE overlays redirect the hard-coded base branch to the discovered default', () => {
  const offenders: string[] = []
  for (const skill of skillsOverridingBaseBranch) {
    const overlay = readOverlay(skill)
    if (!overlay.includes('defaultBranchRef')) {
      offenders.push(skill)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These overlays must resolve the base branch via gh defaultBranchRef instead of assuming develop: ${offenders.join(', ')}`,
  )
})
