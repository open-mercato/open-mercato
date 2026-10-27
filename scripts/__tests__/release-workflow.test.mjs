import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'
import { changelogSection } from '../lib/release-line.mts'

const workflowPath = (name) => path.resolve('.github/workflows', name)
const releasePath = workflowPath('release.yml')
const publishPath = workflowPath('release-publish.yml')
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

test('release runs only from a release line, by hand, and publishes nothing itself', () => {
  const { parsed, source } = readWorkflow(releasePath)

  assert.deepEqual(Object.keys(parsed.on), ['workflow_dispatch'], 'Release must have exactly one trigger: a human')
  assert.equal(parsed.jobs.release.if, "startsWith(github.ref, 'refs/heads/release/v')")
  assert.doesNotMatch(source, /publish-packages|npm publish|id-token/, 'Publishing happens only in release-publish.yml, at the tag')
  assert.match(source, /node scripts\/release-line\.mts prepare/)
  assert.doesNotMatch(source, /git push/, 'Release writes to GitHub only through scripts/release-line.mts')
})

test('release starts from the line tip so a re-run picks up an earlier bump commit', () => {
  const { parsed } = readWorkflow(releasePath)
  const checkout = parsed.jobs.release.steps.find((step) => step.name === 'Checkout code')

  assert.equal(
    checkout.with.ref,
    '${{ github.ref_name }}',
    'Re-run jobs replays the dispatch SHA; building from it after a pushed bump commit fails the non-forced branch move',
  )
})

test('a release dry run rehearses the build, and the tagged commit when resuming', () => {
  const { parsed } = readWorkflow(releasePath)
  const steps = parsed.jobs.release.steps
  const tagged = steps.find((step) => step.name === 'Check out the tagged commit')

  assert.equal(tagged.if, "${{ inputs.dry_run && steps.prepare.outputs.resumed == 'true' }}")
  for (const name of ['Install dependencies', 'Rehearse the build', 'Preview the GitHub Release']) {
    assert.equal(steps.find((step) => step.name === name).if, '${{ inputs.dry_run }}', `${name} runs only for a rehearsal`)
  }
})

test('release publish runs at the tag, so npm provenance attests the commit it ships', () => {
  const { parsed, source } = readWorkflow(publishPath)
  const job = parsed.jobs.publish
  const checkout = job.steps.find((step) => step.name === 'Checkout code')

  assert.deepEqual(parsed.on.push, { tags: ['v*'] })
  assert.ok('workflow_dispatch' in parsed.on, 'A failed publish is resumable by dispatching from the same tag')
  assert.equal(job.if, "startsWith(github.ref, 'refs/tags/v')")
  assert.equal(checkout.with?.ref, undefined, 'Checking out anything but the run commit would make provenance attest other code')
  assert.equal(parsed.permissions['id-token'], 'write')
  assert.equal(job.environment, 'production', 'Publishing stays behind the production environment')
  assert.match(source, /--sha "\$GITHUB_SHA"/, 'The GitHub Release targets the commit this run built')
})

test('release publish verifies the tag before building and resolves the dist-tag right before publishing', () => {
  const { source } = readWorkflow(publishPath)

  assert.match(source, /node scripts\/release-line\.mts verify/)
  assert.ok(stepIndex(source, 'Verify the tag and resolve the dist-tag') < stepIndex(source, 'Install dependencies'))
  assert.ok(stepIndex(source, 'Verify version alignment') < stepIndex(source, 'Build packages'))
  assert.match(
    source,
    /publish-packages\.sh --tag "\$DIST_TAG" --reconcile-tag/,
    'A patch to an older line must not move `latest`: publish under the resolved dist-tag, and point it at packages a failed attempt already published',
  )
  assert.match(source, /DIST_TAG: \$\{\{ steps\.verify\.outputs\.distTag \}\}/)
  assert.ok(
    stepIndex(source, 'Publish packages to npm') < stepIndex(source, 'Changelog PR and GitHub Release'),
    'The GitHub Release marks a version done, so it comes only after every package is published',
  )
})

test('release publish runs one version at a time so `latest` never moves backwards', () => {
  const { parsed } = readWorkflow(publishPath)

  assert.equal(parsed.concurrency.group, 'release-publish', 'Two lines published together could both resolve `latest`')
  assert.equal(parsed.concurrency['cancel-in-progress'], false)
})

test('release publish keeps its log out of the working tree', () => {
  const { source } = readWorkflow(publishPath)

  assert.doesNotMatch(
    source,
    /tee -?a? ?"?release-output\.txt/,
    'The release log must be written outside the repository so it can never be committed',
  )
  assert.match(source, /\$RUNNER_TEMP\/release-output\.txt/)
})

test('release workflows pipe through a pipefail shell', () => {
  for (const file of [releasePath, publishPath]) {
    const { source } = readWorkflow(file)
    for (const [, block] of source.matchAll(/- name: [^\n]+\n((?:\s{8}[^\n]*\n)+)/g)) {
      if (!block.includes('| tee')) continue
      assert.match(block, /shell: bash/, 'Steps piping into tee must opt into pipefail via `shell: bash`')
    }
  }
})

test('release cut runs only from main and only by hand', () => {
  const { parsed, source } = readWorkflow(cutPath)

  assert.deepEqual(Object.keys(parsed.on), ['workflow_dispatch'])
  assert.equal(parsed.jobs.cut.if, "github.ref == 'refs/heads/main'")
  assert.match(source, /node scripts\/release-line\.mts cut/)
  assert.doesNotMatch(source, /publish-packages|npm publish/, 'Cutting a line never releases anything')
})

test('workflows that open PRs use a release app token so CI runs on them', () => {
  for (const file of [releasePath, publishPath, cutPath, backportPath]) {
    const { source } = readWorkflow(file)
    assert.match(source, /uses: actions\/create-github-app-token@[0-9a-f]{40} /, `${path.basename(file)} must mint an app token from a SHA-pinned action`)
    assert.match(source, /client-id: \$\{\{ vars\.RELEASE_APP_CLIENT_ID \}\}/)
    assert.match(source, /private-key: \$\{\{ secrets\.RELEASE_APP_PRIVATE_KEY \}\}/)
    assert.doesNotMatch(source, /secrets\.RELEASE_TOKEN|github\.token/, `${path.basename(file)} must not fall back to a PAT or GITHUB_TOKEN`)
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

test('backport runs only for PRs carrying a backport label', () => {
  const { parsed } = readWorkflow(backportPath)
  const condition = parsed.jobs.backport.if

  assert.match(condition, /github\.event\.action == 'closed' && contains\(join\(github\.event\.pull_request\.labels\.\*\.name, '\|'\), 'backport '\)/)
  assert.match(condition, /github\.event\.action == 'labeled' && startsWith\(github\.event\.label\.name, 'backport '\)/)
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
