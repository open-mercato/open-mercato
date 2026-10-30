import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'yaml'

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

test('npm snapshot credentials are isolated behind the preview environment', () => {
  const workflow = parse(readText(npmSnapshotPreviewWorkflowPath))
  const snapshot = workflow.jobs.snapshot
  const checkoutIndex = snapshot.steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'))
  const approvalIndex = snapshot.steps.findIndex((step) => step.name === 'Verify independent preview approval')

  assert.equal(snapshot.environment, 'npm-preview')
  assert.equal(snapshot.permissions.actions, 'read')
  assert.equal(snapshot.env.YARN_NPM_AUTH_TOKEN, '${{ secrets.NPM_PREVIEW_TOKEN }}')
  assert.ok(approvalIndex >= 0 && approvalIndex < checkoutIndex)
  assert.equal(snapshot.steps[approvalIndex].env.PR_AUTHOR_ID, '${{ needs.resolve-pr.outputs.author_id }}')
  assert.equal(snapshot.steps[approvalIndex].env.TRIGGERING_ACTOR, '${{ github.triggering_actor }}')
  assert.equal(snapshot.steps[approvalIndex].env.RUN_ATTEMPT, '${{ github.run_attempt }}')
  assert.equal(snapshot.steps[checkoutIndex].with.ref, '${{ needs.resolve-pr.outputs.head_sha }}')
  assert.equal(workflow.jobs['resolve-pr'].outputs.author_id, '${{ steps.pr.outputs.author_id }}')
  assert.match(workflow.jobs['resolve-pr'].steps[0].with.script, /core\.setOutput\('author_id', String\(pr\.user\.id\)\)/)

  const authentication = snapshot.steps.find((step) => step.name === 'Configure npm authentication')
  assert.equal(authentication.env.NPM_TOKEN, '${{ secrets.NPM_PREVIEW_TOKEN }}')
  assert.match(authentication.run, /test -n "\$NPM_TOKEN"/)
  assert.deepEqual([...readText(npmSnapshotPreviewWorkflowPath).matchAll(/secrets\.(\w+)/g)].map((match) => match[1]), [
    'NPM_PREVIEW_TOKEN',
    'NPM_PREVIEW_TOKEN',
  ])
  assert.equal(workflow.jobs['resolve-pr'].env, undefined)
  assert.equal(workflow.jobs['standalone-integration'].env, undefined)
})

test('npm snapshot approval rejects self approval and fails closed before PR checkout', async () => {
  const workflow = parse(readText(npmSnapshotPreviewWorkflowPath))
  const script = workflow.jobs.snapshot.steps.find((step) => step.name === 'Verify independent preview approval')?.with.script
  assert.equal(typeof script, 'string')
  const review = (login = 'reviewer', id = 4, environment = 'npm-preview', state = 'approved') => ({
    user: { login, id },
    environments: [{ name: environment }],
    state,
  })
  const scenarios = [
    { name: 'independent reviewer', reviews: [review()], approved: true },
    { name: 'no approval or bypass', reviews: [] },
    { name: 'PR author', reviews: [review('author', 1)] },
    { name: 'dispatcher', reviews: [review('DISPATCHER', 2)] },
    { name: 'rerun actor', reviews: [review('RERUNNER', 3)] },
    { name: 'production approval', reviews: [review('reviewer', 4, 'production')] },
    { name: 'rejected approval', reviews: [review('reviewer', 4, 'npm-preview', 'rejected')] },
    { name: 'old run approval', reviews: [review()], attempt: '2' },
  ]

  for (const scenario of scenarios) {
    const failures = []
    const context = {
      github: { rest: { actions: { getReviewsForRun: async (request) => {
        assert.deepEqual(JSON.parse(JSON.stringify(request)), { owner: 'open-mercato', repo: 'open-mercato', run_id: 123 })
        return { data: scenario.reviews }
      } } } },
      context: { repo: { owner: 'open-mercato', repo: 'open-mercato' }, runId: 123, actor: 'dispatcher' },
      process: { env: { PR_AUTHOR_ID: '1', TRIGGERING_ACTOR: 'rerunner', RUN_ATTEMPT: scenario.attempt ?? '1' } },
      core: { setFailed: (message) => failures.push(message) },
    }

    await vm.runInNewContext(`(async () => {${script}\n})()`, context, { timeout: 1000 })
    assert.equal(failures.length, scenario.approved ? 0 : 1, scenario.name)
  }

  await assert.rejects(vm.runInNewContext(`(async () => {${script}\n})()`, {
    github: { rest: { actions: { getReviewsForRun: async () => { throw new Error('API unavailable') } } } },
    context: { repo: {}, runId: 123, actor: 'dispatcher' },
    process: { env: { PR_AUTHOR_ID: '1', TRIGGERING_ACTOR: 'rerunner', RUN_ATTEMPT: '1' } },
    core: { setFailed: () => assert.fail('API errors must abort the step') },
  }, { timeout: 1000 }), /API unavailable/)
})

test('published standalone lanes verify the disabled baseline before activating TC-EXAMPLE-016', () => {
  for (const workflowPath of [snapshotWorkflowPath, npmSnapshotPreviewWorkflowPath]) {
    assertStandaloneExampleActivationLane(readText(workflowPath))
  }
})

test('develop snapshot standalone initialization replaces the scaffold database URL', () => {
  const workflow = readText(snapshotWorkflowPath)
  const configureStart = stepIndex(workflow, 'Configure standalone app environment')
  const installStart = stepIndex(workflow, 'Install standalone app dependencies')
  const configureStep = workflow.slice(configureStart, installStart)
  const appendedEnvironment = configureStep.slice(configureStep.indexOf("cat >> .env"))

  assert.ok(configureStep.includes(
    "sed -i 's|^DATABASE_URL=.*$|DATABASE_URL=postgres://mercato:secret@localhost:5432/mercato_test|' .env",
  ))
  assert.equal(countOccurrences(appendedEnvironment, 'DATABASE_URL='), 0)
})

test('standalone example activation helper is executable through the workflow CJS entrypoint', () => {
  const activationScript = readText(standaloneExampleActivationScriptPath)
  const result = spawnSync(process.execPath, [tsxCliPath, standaloneExampleActivationScriptPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  assert.equal(result.status, 1)
  assert.match(output, /Usage: yarn tsx scripts\/prepare-standalone-example-integration\.ts <app-directory>/)
  assert.doesNotMatch(output, /Top-level await is currently not supported/)
  assert.match(activationScript, /EXAMPLE_INTEGRATION_ACTIVATION_ENTRY/)
  assert.match(activationScript, /DESIGN_SYSTEM_ACTIVATION_ENTRY/)
  assert.equal(countOccurrences(activationScript, 'enableModuleEntry(configPath,'), 2)
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
