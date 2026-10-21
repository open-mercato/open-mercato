import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'
import { changelogSection } from '../lib/release-line.mjs'

const workflowPath = (name) => path.resolve('.github/workflows', name)
const releasePath = workflowPath('release.yml')
const cutPath = workflowPath('release-cut.yml')
const backportPath = workflowPath('backport.yml')
const ciPath = workflowPath('ci.yml')
const changelogPath = path.resolve('CHANGELOG.md')

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

function readWorkflow(file) {
  const source = fs.readFileSync(file, 'utf8')
  return { source, parsed: parse(source) }
}

test('release runs only from a release line, never from main or a push', () => {
  const { parsed } = readWorkflow(releasePath)

  assert.deepEqual(Object.keys(parsed.on), ['workflow_dispatch'], 'Release must have exactly one trigger: a human')
  assert.equal(parsed.jobs.release.if, "startsWith(github.ref, 'refs/heads/release/v')")
  assert.equal(parsed.jobs.release.environment, 'production', 'Publishing stays behind the production environment')
})

test('release bumps the line before building and builds exactly the bump commit', () => {
  const { source } = readWorkflow(releasePath)

  assert.ok(stepIndex(source, 'Bump the release line') < stepIndex(source, 'Check out the bump commit'))
  assert.ok(stepIndex(source, 'Check out the bump commit') < stepIndex(source, 'Build packages'))
  assert.ok(stepIndex(source, 'Verify version alignment') < stepIndex(source, 'Build packages'))
  assert.match(source, /node scripts\/release-line\.mjs prepare/)
  assert.doesNotMatch(source, /git push/, 'Release writes to GitHub only through scripts/release-line.mjs')
})

test('release publishes under the dist-tag the line resolved, then tags', () => {
  const { source } = readWorkflow(releasePath)

  assert.match(
    source,
    /publish-packages\.sh --tag "\$DIST_TAG"/,
    'A patch to an older line must not move `latest`: publish under the resolved dist-tag',
  )
  assert.match(source, /DIST_TAG: \$\{\{ steps\.prepare\.outputs\.distTag \}\}/)
  assert.ok(
    stepIndex(source, 'Publish packages to npm') < stepIndex(source, 'Tag, GitHub Release and changelog PR'),
    'An untagged version is what lets a re-run finish a half-published release, so tag after publishing',
  )
})

test('release dry runs never publish', () => {
  const { parsed } = readWorkflow(releasePath)
  const publish = parsed.jobs.release.steps.find((step) => step.name === 'Publish packages to npm')

  assert.equal(publish.if, '${{ !inputs.dry_run }}')
})

test('release workflow keeps its log out of the working tree', () => {
  const { source } = readWorkflow(releasePath)

  assert.doesNotMatch(
    source,
    /tee -?a? ?"?release-output\.txt/,
    'The release log must be written outside the repository so it can never be committed',
  )
  assert.match(source, /\$RUNNER_TEMP\/release-output\.txt/)
})

test('release workflow pipes through a pipefail shell', () => {
  const { source } = readWorkflow(releasePath)

  for (const [, block] of source.matchAll(/- name: [^\n]+\n((?:\s{8}[^\n]*\n)+)/g)) {
    if (!block.includes('| tee')) continue
    assert.match(block, /shell: bash/, 'Steps piping into tee must opt into pipefail via `shell: bash`')
  }
})

test('release cut runs only from main and only by hand', () => {
  const { parsed, source } = readWorkflow(cutPath)

  assert.deepEqual(Object.keys(parsed.on), ['workflow_dispatch'])
  assert.equal(parsed.jobs.cut.if, "github.ref == 'refs/heads/main'")
  assert.match(source, /node scripts\/release-line\.mjs cut/)
  assert.doesNotMatch(source, /publish-packages|npm publish/, 'Cutting a line never releases anything')
})

test('workflows that open PRs use RELEASE_TOKEN so CI runs on them', () => {
  for (const file of [releasePath, cutPath, backportPath]) {
    const { source } = readWorkflow(file)
    assert.match(source, /secrets\.RELEASE_TOKEN/, `${path.basename(file)} must use RELEASE_TOKEN`)
  }
})

test('backport never runs with secrets on a fork event and pins its action', () => {
  const { parsed, source } = readWorkflow(backportPath)

  assert.ok(parsed.on.pull_request, 'Backport must use pull_request')
  assert.equal(parsed.on.pull_request_target, undefined, 'pull_request_target would hand secrets to fork events')
  assert.match(parsed.jobs.backport.if, /head\.repo\.full_name == github\.repository/)
  assert.match(source, /korthout\/backport-action@[0-9a-f]{40} /, 'A third-party action given a write token is pinned by SHA')
  assert.match(source, /label_pattern: '\^backport \(main\|release\/v\\d\+\\\.\\d\+\\\.x\)\$'/)
  const copied = new RegExp(parsed.jobs.backport.steps.find((step) => step.with?.copy_labels_pattern).with.copy_labels_pattern)
  assert.ok(copied.test('bug') && copied.test('priority-high') && copied.test('risk-low'))
  assert.ok(!copied.test('qa-approved'), 'QA approval vouched for main, not the line; it must not be copied')
})

test('CI runs on release lines so backports never merge untested', () => {
  const { parsed } = readWorkflow(ciPath)

  assert.ok(parsed.on.push.branches.includes('release/v*'))
  assert.ok(parsed.on.pull_request.branches.includes('release/v*'))
  assert.ok(!parsed.on.push.branches.includes('develop'), 'develop is retired; main is the trunk')
})

test('release lines own the release/ namespace', () => {
  const offenders = fs
    .readdirSync(path.resolve('.github/workflows'))
    .filter((name) => name.endsWith('.yml'))
    .filter((name) => /release\/v\$|release\/v\$\{/.test(fs.readFileSync(workflowPath(name), 'utf8')))

  assert.deepEqual(offenders, [], 'Bookkeeping branches belong under chore/, never inside release/v*')
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
    `Duplicate version heading(s): ${duplicates.join(', ')}. The release tooling reads the first "# <version>" section and stops at the next "# " line, so a second heading for the same version silently truncates the release notes (#5014, #5017). Reconcile the two sections into one.`,
  )
})

test('the release tooling reads the newest CHANGELOG.md section whole', () => {
  const changelog = fs.readFileSync(changelogPath, 'utf8')
  const lines = changelog.split('\n')

  const startIndex = lines.findIndex((line) => VERSION_HEADING.test(line))
  assert.notEqual(startIndex, -1, 'CHANGELOG.md must hold a `# <version> (<date>)` section')

  const version = lines[startIndex].match(VERSION_HEADING)[1]
  const nextHeadingIndex = lines.findIndex((line, index) => index > startIndex && line.startsWith('# '))
  const body = lines
    .slice(startIndex + 1, nextHeadingIndex === -1 ? undefined : nextHeadingIndex)
    .join('\n')
    .trim()
    .replace(/\n+---$/, '')
    .trim()

  const section = changelogSection(changelog, version)
  assert.equal(section?.heading, lines[startIndex])
  assert.equal(
    section?.body,
    body,
    `changelogSection(${version}) must return every line up to the next "# " heading — anything shorter publishes half a release's notes (#5017).`,
  )
})

test('generated release notes config parses and groups by category label', () => {
  const config = parse(fs.readFileSync(path.resolve('.github/release.yml'), 'utf8'))

  assert.ok(config.changelog.exclude.labels.includes('skip-changelog'))
  assert.ok(config.changelog.exclude.authors.includes('dependabot[bot]'))
  const grouped = config.changelog.categories.flatMap((category) => category.labels)
  for (const label of ['feature', 'security', 'bug', 'enterprise', 'refactor', 'dependencies', 'documentation', '*']) {
    assert.ok(grouped.includes(label), `${label} must have a section`)
  }
})
