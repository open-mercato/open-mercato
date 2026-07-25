import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const packagePreviewWorkflowPath = path.resolve('.github/workflows/package-previews.yml')
const npmSnapshotPreviewWorkflowPath = path.resolve('.github/workflows/npm-snapshot-preview.yml')
const autoPublishSkillPath = path.resolve('.ai/skills/om-auto-publish-pr/SKILL.md')
const skillTiersPath = path.resolve('.ai/skills/tiers.json')

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

test('package previews are explicit same-repository workflow dispatches', () => {
  const workflow = readText(packagePreviewWorkflowPath)

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /pr_number:/)
  assert.doesNotMatch(workflow, /^\s+pull_request:/m)
  assert.doesNotMatch(workflow, /github\.event\.label\.name/)
  assert.doesNotMatch(workflow, /publish-pkg-preview/)

  assert.match(workflow, /PR_NUMBER: \$\{\{ github\.event\.inputs\.pr_number \}\}/)
  assert.match(workflow, /const prNumber = Number\(process\.env\.PR_NUMBER\);/)
  assert.match(workflow, /pull_number: prNumber/)
  assert.match(workflow, /pr\.head\.repo\.full_name === expectedRepo/)
  assert.match(workflow, /Package previews are restricted to same-repository PR branches\./)
  assert.match(workflow, /if: needs\.resolve-pr\.outputs\.same_repo == 'true'/)
  assert.match(workflow, /ref: \$\{\{ needs\.resolve-pr\.outputs\.head_sha \}\}/)
  assert.match(workflow, /yarn pkg-pr-new publish --comment=update --no-template --yarn --packageManager=yarn/)
})

test('npm snapshot previews preserve PR canary behavior behind manual dispatch', () => {
  const workflow = readText(npmSnapshotPreviewWorkflowPath)

  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /pr_number:/)
  assert.doesNotMatch(workflow, /^\s+pull_request:/m)
  assert.doesNotMatch(workflow, /github\.event\.label\.name/)
  assert.doesNotMatch(workflow, /publish-npm-snapshot/)

  assert.match(workflow, /PR_NUMBER: \$\{\{ github\.event\.inputs\.pr_number \}\}/)
  assert.match(workflow, /const prNumber = Number\(process\.env\.PR_NUMBER\);/)
  assert.match(workflow, /pull_number: prNumber/)
  assert.match(workflow, /pr\.head\.repo\.full_name === expectedRepo/)
  assert.match(workflow, /NPM snapshot previews are restricted to same-repository PR branches\./)
  assert.match(workflow, /--event-name "pull_request"/)
  assert.equal(countOccurrences(workflow, 'ref: ${{ needs.resolve-pr.outputs.head_sha }}'), 2)
  assert.match(workflow, /const issueNumber = Number\(process\.env\.PR_NUMBER\);/)
  assert.doesNotMatch(workflow, /issue_number: context\.issue\.number/)
})

test('auto publish skill only dispatches pkg.pr.new previews and is tiered as automation', () => {
  const skill = readText(autoPublishSkillPath)
  const tiers = JSON.parse(readText(skillTiersPath))

  assert.match(skill, /^name: om-auto-publish-pr$/m)
  assert.match(skill, /gh workflow run package-previews\.yml/)
  assert.match(skill, /-f "pr_number=\$PR_NUMBER"/)
  assert.doesNotMatch(skill, /gh workflow run npm-snapshot-preview\.yml/)
  assert.doesNotMatch(skill, /workflow run .*npm-snapshot/i)

  assert.ok(
    tiers.tiers.automation.skills.includes('om-auto-publish-pr'),
    'om-auto-publish-pr should be installable through the automation tier',
  )
})
