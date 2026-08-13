import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'

const packagePreviewWorkflowPath = path.resolve('.github/workflows/package-previews.yml')
const npmSnapshotPreviewWorkflowPath = path.resolve('.github/workflows/npm-snapshot-preview.yml')
const snapshotWorkflowPath = path.resolve('.github/workflows/snapshot.yml')
const autoPublishSkillPath = path.resolve('.ai/skills/om-auto-publish-pr/SKILL.md')
const skillTiersPath = path.resolve('.ai/skills/tiers.json')
const standaloneExampleActivationScriptPath = path.resolve('scripts/prepare-standalone-example-integration.ts')
const tsxCliPath = createRequire(import.meta.url).resolve('tsx/cli')

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

function stepIndex(workflow, stepName) {
  const index = workflow.indexOf(`- name: ${stepName}`)
  assert.notEqual(index, -1, `Expected workflow to contain step "${stepName}"`)
  return index
}

function assertStandaloneExampleActivationLane(workflow) {
  const baselineIndex = stepIndex(workflow, 'Generate runtime-disabled standalone baseline')
  const activationIndex = stepIndex(workflow, 'Verify disabled baseline and activate example integration fixture')
  const activatedGenerationIndex = stepIndex(workflow, 'Generate activated standalone app modules')
  const buildIndex = stepIndex(workflow, 'Build standalone app')
  const startIndex = stepIndex(workflow, 'Start standalone app')
  const integrationIndex = stepIndex(workflow, 'Run integration tests')

  assert.ok(baselineIndex < activationIndex, 'The published scaffold must generate once while example is disabled')
  assert.ok(activationIndex < activatedGenerationIndex, 'The example fixture must be activated before regeneration')
  assert.ok(activatedGenerationIndex < buildIndex, 'The activated fixture must be generated before the app build')
  assert.ok(buildIndex < startIndex, 'The activated app must be built before it is started')
  assert.ok(startIndex < integrationIndex, 'The activated app must be running before TC-EXAMPLE-016 executes')
  assert.match(workflow, /run: yarn tsx scripts\/prepare-standalone-example-integration\.ts \/tmp\/standalone-app/)
  assert.match(workflow, /OM_TEST_APP_ROOT: \/tmp\/standalone-app/)
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

test('published standalone lanes verify the disabled baseline before activating TC-EXAMPLE-016', () => {
  for (const workflowPath of [snapshotWorkflowPath, npmSnapshotPreviewWorkflowPath]) {
    assertStandaloneExampleActivationLane(readText(workflowPath))
  }
})

test('standalone example activation helper is executable through the workflow CJS entrypoint', () => {
  const result = spawnSync(process.execPath, [tsxCliPath, standaloneExampleActivationScriptPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  assert.equal(result.status, 1)
  assert.match(output, /Usage: yarn tsx scripts\/prepare-standalone-example-integration\.ts <app-directory>/)
  assert.doesNotMatch(output, /Top-level await is currently not supported/)
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
