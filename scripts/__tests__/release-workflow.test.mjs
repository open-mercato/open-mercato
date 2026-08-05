import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const releasePath = path.resolve('.github/workflows/release.yml')
const preparePath = path.resolve('.github/workflows/release-prepare.yml')
const changelogPath = path.resolve('CHANGELOG.md')
const changelogSectionPath = path.resolve('scripts/changelog-section.sh')

const VERSION_HEADING = /^# (\d+\.\d+\.\d+) \(/

function readChangelogLines() {
  return fs.readFileSync(changelogPath, 'utf8').split('\n')
}

function listVersionHeadings(lines) {
  return lines.map((line) => line.match(VERSION_HEADING)?.[1]).filter((version) => version !== undefined)
}

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

test('CHANGELOG.md never repeats a version heading', () => {
  const versions = listVersionHeadings(readChangelogLines())

  assert.ok(
    versions.length > 0,
    'No `# <version> (` headings matched CHANGELOG.md — the heading format drifted and this guard would pass vacuously',
  )

  const duplicates = [...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))]

  assert.deepEqual(
    duplicates,
    [],
    `Duplicate version heading(s): ${duplicates.join(', ')}. scripts/changelog-section.sh scans for the first "# <version> (" and exits at the next "# " line, so a second heading for the same version silently truncates the release notes — and still exits 0, so nothing downstream can tell half the notes from all of them. This collides when a release is cut from main while develop holds an in-progress draft for the same version (#5014, #5017); reconcile the two sections into one instead of letting the merge keep both.`,
  )
})

test('changelog-section.sh round-trips the section it extracts', () => {
  const lines = readChangelogLines()

  const startIndex = lines.findIndex((line) => VERSION_HEADING.test(line))
  assert.notEqual(startIndex, -1, 'CHANGELOG.md must open with a `# <version> (<date>)` section')

  const version = lines[startIndex].match(VERSION_HEADING)[1]
  const nextHeadingIndex = lines.findIndex((line, index) => index > startIndex && line.startsWith('# '))
  const body = lines.slice(startIndex + 1, nextHeadingIndex === -1 ? undefined : nextHeadingIndex)

  const trimTrailingBlanks = () => {
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()
  }
  while (body.length > 0 && body[0].trim() === '') body.shift()
  trimTrailingBlanks()
  if (body[body.length - 1] === '---') {
    body.pop()
    trimTrailingBlanks()
  }

  const result = spawnSync('bash', [changelogSectionPath, version, '--changelog', changelogPath], { encoding: 'utf8' })

  assert.equal(
    result.status,
    0,
    `changelog-section.sh ${version} exited ${result.status}; release.yml feeds this straight into the GitHub Release body. stderr: ${result.stderr}`,
  )
  assert.equal(
    result.stdout,
    `${body.join('\n')}\n`,
    `changelog-section.sh ${version} did not return the section CHANGELOG.md actually holds for that version. It must emit every line up to the next "# " heading, with the trailing "---" separator and surrounding blank lines stripped — anything shorter is the silent truncation that publishes half a release's notes (#5017).`,
  )
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
