import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const skillsDir = new URL('../../agentic/shared/ai/skills/', import.meta.url)
const scaffolderSource = fs.readFileSync(
  new URL('../setup/tools/shared.ts', import.meta.url),
  'utf8',
)

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

test('the scaffolder copies a STANDALONE.md overlay for every portability-sensitive skill', () => {
  // Shipping the overlay in the bundle is not enough — `generateShared()` in
  // setup/tools/shared.ts must actually copy it into the scaffolded app. The
  // auto-* family is copied via a loop over an array literal; om-integration-builder
  // is copied explicitly. Either form counts as wired.
  const notWired = skillsRequiringStandaloneOverlay.filter((skill) => {
    const explicitCopy = scaffolderSource.includes(`ai/skills/${skill}/STANDALONE.md`)
    const loopCopy =
      scaffolderSource.includes(`'${skill}',`) &&
      scaffolderSource.includes('ai/skills/${autoSkill}/STANDALONE.md')
    return !explicitCopy && !loopCopy
  })
  assert.deepEqual(
    notWired,
    [],
    `These overlays exist in the bundle but generateShared() never copies them into scaffolded apps: ${notWired.join(', ')}`,
  )
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
