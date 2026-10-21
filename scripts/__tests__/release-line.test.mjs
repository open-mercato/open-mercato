import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createGithubClient } from '../lib/github-api.mjs'
import {
  changelogSection,
  dropUnreleased,
  ensureChangelogEntry,
  insertChangelogEntry,
  nextMinorVersion,
  planRelease,
  releaseBranchFor,
  resolveStableDistTag,
  stampManifestVersion,
} from '../lib/release-line.mjs'

const scriptPath = path.resolve('scripts/release-line.mjs')

test('a line is named after its minor and main moves to the next minor', () => {
  assert.equal(releaseBranchFor('0.9.0'), 'release/v0.9.x')
  assert.equal(releaseBranchFor('0.9.0-develop.1'), null)
  assert.equal(nextMinorVersion('0.9.0'), '0.10.0')
  assert.equal(nextMinorVersion('1.2.3'), '1.3.0')
})

test('a fresh line ships its committed x.y.0', () => {
  assert.deepEqual(planRelease({ branch: 'release/v0.10.x', manifestVersion: '0.10.0', tags: ['v0.9.0', 'v0.9.1'] }), {
    ok: true,
    version: '0.10.0',
    bumped: false,
    previousTag: 'v0.9.1',
  })
})

test('a tagged line bumps the patch first', () => {
  assert.deepEqual(planRelease({ branch: 'release/v0.9.x', manifestVersion: '0.9.0', tags: ['v0.8.0', 'v0.9.0'] }), {
    ok: true,
    version: '0.9.1',
    bumped: true,
    previousTag: 'v0.9.0',
  })
})

test('a release skips past tags already taken', () => {
  const plan = planRelease({ branch: 'release/v0.9.x', manifestVersion: '0.9.1', tags: ['v0.9.0', 'v0.9.1', 'v0.9.2'] })
  assert.equal(plan.version, '0.9.3')
  assert.equal(plan.previousTag, 'v0.9.2')
})

test('a run that died after its bump commit ships the same version on re-run', () => {
  const plan = planRelease({ branch: 'release/v0.9.x', manifestVersion: '0.9.2', tags: ['v0.9.0', 'v0.9.1'] })
  assert.equal(plan.version, '0.9.2')
  assert.equal(plan.bumped, false)
})

test('a release refuses branches and manifests that disagree', () => {
  assert.equal(planRelease({ branch: 'main', manifestVersion: '0.9.0', tags: [] }).ok, false)
  assert.equal(planRelease({ branch: 'release/v0.4.8', manifestVersion: '0.4.8', tags: [] }).ok, false)
  assert.match(
    planRelease({ branch: 'release/v0.9.x', manifestVersion: '0.10.0', tags: [] }).error,
    /does not belong to release\/v0\.9\.x/,
  )
})

test('only the newest line moves latest', () => {
  assert.equal(resolveStableDistTag('0.10.0', '0.9.1'), 'latest')
  assert.equal(resolveStableDistTag('0.9.2', '0.10.0'), 'latest-0.9')
  assert.equal(resolveStableDistTag('0.9.1', '0.9.0'), 'latest')
  assert.equal(resolveStableDistTag('0.9.1', null), 'latest')
})

test('stamping changes only the version and keeps the manifest format', () => {
  const source = '{\n  "name": "@open-mercato/x",\n  "version": "0.9.0",\n  "private": false\n}\n'
  assert.equal(stampManifestVersion(source, '0.9.0'), source)
  assert.equal(stampManifestVersion(source, '0.10.0'), source.replace('0.9.0', '0.10.0'))
})

const CHANGELOG = '# 0.9.0 (2026-10-09)\n\n## Highlights\n\nBig.\n\n---\n\n# 0.8.0 (2026-09-01)\n\n- Old.\n'

test('a hand-written entry wins over generated notes', () => {
  assert.deepEqual(ensureChangelogEntry(CHANGELOG, '0.9.0', '2026-10-21', 'generated'), { text: CHANGELOG, source: 'existing' })
  const unreleased = ensureChangelogEntry(`# Unreleased\n\n- Curated.\n\n${CHANGELOG}`, '0.10.0', '2026-10-21', 'generated')
  assert.equal(unreleased.source, 'unreleased')
  assert.match(unreleased.text, /^# 0\.10\.0 \(2026-10-21\)\n\n- Curated\./)
})

test('generated notes fill in when nothing was written by hand', () => {
  const entry = ensureChangelogEntry(CHANGELOG, '0.9.1', '2026-10-21', '## 🐛 Fixes\n* fix it by @dev in #1\n')
  assert.equal(entry.source, 'generated')
  assert.ok(entry.text.startsWith('# 0.9.1 (2026-10-21)\n\n## 🐛 Fixes\n* fix it by @dev in #1\n\n# 0.9.0'))
  assert.match(ensureChangelogEntry(CHANGELOG, '0.9.1', '2026-10-21', '').text, /- Maintenance release\./)
})

test('a cut hands Unreleased to the line', () => {
  assert.equal(dropUnreleased(`# Unreleased\n\n- Curated.\n\n${CHANGELOG}`), CHANGELOG)
  assert.equal(dropUnreleased(CHANGELOG), CHANGELOG)
})

test('a section is read whole, without its separator', () => {
  assert.deepEqual(changelogSection(CHANGELOG, '0.9.0'), { heading: '# 0.9.0 (2026-10-09)', body: '## Highlights\n\nBig.' })
  assert.equal(changelogSection(CHANGELOG, '0.7.0'), null)
})

test('a released entry is carried back in version order', () => {
  const main = `# Unreleased\n\n- Next.\n\n# 0.10.0 (2026-11-01)\n\n- New.\n\n${CHANGELOG}`
  const carried = insertChangelogEntry(main, '0.9.1', '# 0.9.1 (2026-10-21)\n\n- Fix.\n')
  const headings = carried.split('\n').filter((line) => line.startsWith('# '))
  assert.deepEqual(headings, ['# Unreleased', '# 0.10.0 (2026-11-01)', '# 0.9.1 (2026-10-21)', '# 0.9.0 (2026-10-09)', '# 0.8.0 (2026-09-01)'])
  assert.equal(insertChangelogEntry(carried, '0.9.1', '# 0.9.1 (x)\n\n- Again.\n'), carried)
})

function fakeGithub(routes) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const route = `${init.method} ${url.replace('https://api.github.com', '')}`
    calls.push({ route, body: init.body ? JSON.parse(init.body) : undefined })
    const match = routes.find(([pattern]) => pattern === route || (pattern instanceof RegExp && pattern.test(route)))
    const [, status, data] = match ?? [null, 404, { message: 'Not Found' }]
    return { status, text: async () => (data === undefined ? '' : JSON.stringify(data)) }
  }
  return { calls, client: createGithubClient({ token: 't', repository: 'acme/repo', apiUrl: 'https://api.github.com', fetchImpl }) }
}

test('the client reuses an open PR instead of opening a second one', async () => {
  const { calls, client } = fakeGithub([[/^GET \/repos\/acme\/repo\/pulls\?/, 200, [{ number: 7, html_url: 'u' }]]])
  const pr = await client.openPullRequest({ head: 'chore/open-v0.10.0', base: 'main', title: 't', body: 'b' })
  assert.equal(pr.number, 7)
  assert.ok(!calls.some((call) => call.route === 'POST /repos/acme/repo/pulls'))
})

test('the client refreshes an existing release instead of failing', async () => {
  const { calls, client } = fakeGithub([
    ['GET /repos/acme/repo/releases/tags/v0.9.1', 200, { id: 42 }],
    ['PATCH /repos/acme/repo/releases/42', 200, {}],
  ])
  assert.equal(await client.createRelease({ tag: 'v0.9.1', sha: 'abc', name: 'v0.9.1', body: 'b', makeLatest: false }), false)
  assert.deepEqual(calls.at(-1).body, { name: 'v0.9.1', body: 'b', make_latest: 'false' })
})

test('the client treats an existing label as success and surfaces other errors', async () => {
  const { client } = fakeGithub([['POST /repos/acme/repo/labels', 422, { message: 'already_exists' }]])
  await client.ensureLabel('backport main', 'c5def5', 'd')
  const failing = fakeGithub([['POST /repos/acme/repo/git/refs', 403, { message: 'Forbidden' }]])
  await assert.rejects(failing.client.createBranch('release/v0.9.x', 'abc'), /403: Forbidden/)
})

test('the client refuses to run without a token', () => {
  assert.throws(() => createGithubClient({ token: '', repository: 'acme/repo' }), /GH_TOKEN is not set/)
})

function fixtureRepo(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-line-'))
  const writeJson = (rel, value) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, 2)}\n`)
  }
  writeJson('package.json', { name: 'open-mercato', version, private: true })
  writeJson('packages/shared/package.json', { name: '@open-mercato/shared', version })
  writeJson('packages/core/package.json', { name: '@open-mercato/core', version, dependencies: { '@open-mercato/shared': 'workspace:*' } })
  writeJson('packages/eslint-plugin-ds/package.json', { name: '@open-mercato/eslint-plugin-ds', version: '0.1.0', private: true })
  writeJson('apps/mercato/package.json', { name: 'mercato', version, private: true })
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'init', '--allow-empty')
  git('add', '.')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture')
  return { root, git }
}

function runLine(root, args, env = {}) {
  const outputFile = path.join(root, '.github-output')
  fs.writeFileSync(outputFile, '')
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OM_RELEASE_ROOT: root, GITHUB_OUTPUT: outputFile, GH_TOKEN: '', ...env },
  })
  const outputs = Object.fromEntries(
    fs.readFileSync(outputFile, 'utf8').split('\n').filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
  return { ...result, outputs }
}

const readVersion = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')).version

test('cut --dry-run names the line and stamps main to the next minor', () => {
  const { root } = fixtureRepo('0.9.0')
  const result = runLine(root, ['cut', '--dry-run', '--branch', 'main'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.releaseBranch, 'release/v0.9.x')
  assert.equal(result.outputs.nextVersion, '0.10.0')
  for (const rel of ['package.json', 'packages/shared/package.json', 'packages/core/package.json', 'apps/mercato/package.json']) {
    assert.equal(readVersion(root, rel), '0.10.0', rel)
  }
  assert.equal(readVersion(root, 'packages/eslint-plugin-ds/package.json'), '0.1.0', 'private packages version on their own')
})

test('cut refuses to run from anything but main', () => {
  const { root } = fixtureRepo('0.9.0')
  const result = runLine(root, ['cut', '--dry-run', '--branch', 'release/v0.9.x'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /cut from main/)
})

test('prepare --dry-run bumps a tagged line to its next patch under latest-X.Y', () => {
  const { root, git } = fixtureRepo('0.9.0')
  git('tag', 'v0.9.0')
  const result = runLine(root, ['prepare', '--dry-run', '--branch', 'release/v0.9.x', '--latest', '0.10.0', '--date', '2026-10-21'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.version, '0.9.1')
  assert.equal(result.outputs.distTag, 'latest-0.9')
  assert.equal(result.outputs.changelog, 'generated')
  assert.equal(readVersion(root, 'packages/core/package.json'), '0.9.1')
  assert.match(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), /^# 0\.9\.1 \(2026-10-21\)/)
})

test('prepare --dry-run ships a fresh line as committed and moves latest', () => {
  const { root, git } = fixtureRepo('0.10.0')
  git('tag', 'v0.9.0')
  const result = runLine(root, ['prepare', '--dry-run', '--branch', 'release/v0.10.x', '--latest', '0.9.0', '--date', '2026-10-21'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.version, '0.10.0')
  assert.equal(result.outputs.bumped, 'false')
  assert.equal(result.outputs.distTag, 'latest')
})

test('announce --dry-run renders the release body with the package table', () => {
  const { root } = fixtureRepo('0.9.0')
  const result = runLine(root, ['announce', '--dry-run', '--version', '0.9.0', '--sha', 'abcdef1234567890', '--dist-tag', 'latest'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /## Highlights/)
  assert.match(result.stdout, /\| `@open-mercato\/core` \| `0\.9\.0` \|/)
  assert.doesNotMatch(result.stdout, /eslint-plugin-ds/)
})
