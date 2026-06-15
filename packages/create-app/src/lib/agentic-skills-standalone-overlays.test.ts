import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const skillsDir = new URL('../../agentic/shared/ai/skills/', import.meta.url)

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
