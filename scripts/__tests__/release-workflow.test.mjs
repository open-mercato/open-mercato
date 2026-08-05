import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const releasePath = path.resolve('.github/workflows/release.yml')
const preparePath = path.resolve('.github/workflows/release-prepare.yml')

function stepIndex(workflow, stepName) {
  const index = workflow.indexOf(`- name: ${stepName}`)
  assert.notEqual(index, -1, `Expected workflow to contain step "${stepName}"`)
  return index
}

test('release workflow never pushes to the protected main branch', () => {
  const workflow = fs.readFileSync(releasePath, 'utf8')

  assert.doesNotMatch(workflow, /git commit/, 'Release must not create commits on main')
  assert.doesNotMatch(workflow, /^\s+git push\s*$/m, 'Release must not push branches')
  assert.match(workflow, /git push origin "\$TAG"/, 'Release must push only the release tag')
})

test('release workflow tags before publishing to npm', () => {
  const workflow = fs.readFileSync(releasePath, 'utf8')

  assert.ok(
    stepIndex(workflow, 'Create git tag') < stepIndex(workflow, 'Publish packages to npm'),
    'Tagging is reversible and must happen before the irreversible npm publish',
  )
})

test('release workflow guards against republishing an existing version', () => {
  const workflow = fs.readFileSync(releasePath, 'utf8')

  const guardIndex = stepIndex(workflow, 'Verify the version is not published yet')
  assert.ok(
    guardIndex < stepIndex(workflow, 'Build packages'),
    'The npm version guard must run before any build or publish work',
  )
  assert.match(workflow, /check-version-unpublished\.sh/)
})

test('release workflow keeps its log out of the working tree', () => {
  const workflow = fs.readFileSync(releasePath, 'utf8')

  assert.doesNotMatch(
    workflow,
    /tee -?a? ?"?release-output\.txt/,
    'The release log must be written outside the repository so it can never be committed',
  )
  assert.match(workflow, /\$RUNNER_TEMP\/release-output\.txt/)
})

test('release workflow pipes through a pipefail shell', () => {
  const workflow = fs.readFileSync(releasePath, 'utf8')

  for (const [, block] of workflow.matchAll(/- name: [^\n]+\n((?:\s{8}[^\n]*\n)+)/g)) {
    if (!block.includes('| tee')) continue
    assert.match(block, /shell: bash/, 'Steps piping into tee must opt into pipefail via `shell: bash`')
  }
})

test('release workflow gates on a changelog entry before publishing', () => {
  const workflow = fs.readFileSync(releasePath, 'utf8')

  const extractIndex = stepIndex(workflow, 'Extract changelog entry')
  assert.ok(
    extractIndex < stepIndex(workflow, 'Build packages'),
    'A missing changelog entry must fail before anything is built or published',
  )
  assert.match(workflow, /changelog-section\.sh/)
})

test('release notes embed the changelog section from disk', () => {
  const workflow = fs.readFileSync(releasePath, 'utf8')

  assert.match(
    workflow,
    /readFileSync\(\s*\n?\s*path\.join\(process\.env\.RUNNER_TEMP, 'changelog-section\.md'\)/,
    'Changelog prose must be read from disk, never interpolated into the script',
  )
  assert.match(workflow, /BODY_LIMIT = 125000/, 'Release bodies must respect the GitHub size limit')
  assert.match(workflow, /updateRelease/, 'Re-running a release should refresh notes, not fail')
})

test('release prepare workflow opens a PR instead of pushing to main', () => {
  const workflow = fs.readFileSync(preparePath, 'utf8')

  assert.match(workflow, /gh pr create/, 'Version bumps must land through a pull request')
  assert.match(workflow, /git push origin "\$BRANCH"/, 'Prepare must push the release branch only')
  assert.doesNotMatch(workflow, /git push origin main/)
  assert.doesNotMatch(workflow, /git add -A/, 'Staging must stay scoped to tracked manifest changes')
})

test('release prepare targets main explicitly', () => {
  const workflow = fs.readFileSync(preparePath, 'utf8')

  assert.match(workflow, /--base main \\/, 'The PR base must be pinned to main, not the repo default')
  assert.match(workflow, /--head "\$BRANCH"/)
  assert.match(workflow, /compare\/main\.\.\.\$BRANCH/, 'The fallback compare link must also target main')
})

test('both release stages share the same resume escape hatch', () => {
  const release = fs.readFileSync(releasePath, 'utf8')
  const prepare = fs.readFileSync(preparePath, 'utf8')

  for (const [name, workflow] of [['release', release], ['release-prepare', prepare]]) {
    assert.match(workflow, /resume:\n\s+description:/, `${name} must expose a resume input`)
    assert.match(workflow, /if: \$\{\{ !inputs\.resume \}\}/, `${name} must gate a guard on resume`)
  }

  // Recovery means npm is deliberately ahead of git, so neither the npm guard nor the
  // tag guard should block the catch-up bump PR
  const gatedGuards = prepare.match(/if: \$\{\{ !inputs\.resume \}\}/g) ?? []
  assert.equal(gatedGuards.length, 2, 'Prepare must skip both the npm and tag guards when resuming')
})

test('release prepare survives a token that cannot open PRs', () => {
  const workflow = fs.readFileSync(preparePath, 'utf8')

  assert.match(workflow, /if PR_URL=\$\(gh pr create/, 'PR creation must be a conditional, not a hard failure')
  assert.match(workflow, /GITHUB_STEP_SUMMARY/, 'Both branches must report where the release stands')
  assert.match(
    workflow,
    /Allow GitHub Actions to create and approve pull requests/,
    'The fallback must name the setting that unblocks automatic PR creation',
  )
})
