import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createGithubClient, type FetchLike } from '../lib/github-api.mts'
import {
  batchPullRequest,
  changelogEntryDate,
  changelogSection,
  dropUnreleased,
  ensureChangelogEntry,
  highestLatest,
  entryPullRequest,
  insertChangelogEntry,
  isGreenTag,
  newestLineTag,
  nextMinorVersion,
  planRelease,
  previousMinorRelease,
  pullRequestsInSubjects,
  releaseBranchFor,
  resolveStableDistTag,
  splitUnreleased,
  stampManifestVersion,
  stampUpgradeWindow,
  withUnreleased,
  type CommitPullRequest,
} from '../lib/release-line.mts'

const scriptPath = path.resolve('scripts/release-line.mts')

test('a line is named after its minor and main moves to the next minor', () => {
  assert.equal(releaseBranchFor('0.9.0'), 'release/v0.9.x')
  assert.equal(releaseBranchFor('0.9.0-develop.1'), null)
  assert.equal(nextMinorVersion('0.9.0'), '0.10.0')
  assert.equal(nextMinorVersion('1.2.3'), '1.3.0')
})

const plan = (input: { branch: string; manifestVersion: string; tags: string[]; newestTagReleased?: boolean }) =>
  planRelease({ newestTagReleased: true, ...input })

test('a fresh line ships its committed x.y.0', () => {
  assert.deepEqual(plan({ branch: 'release/v0.10.x', manifestVersion: '0.10.0', tags: ['v0.9.0', 'v0.9.1'] }), {
    ok: true,
    version: '0.10.0',
    bumped: false,
    resumed: false,
    previousTag: 'v0.9.1',
  })
})

test('a released line bumps the patch first', () => {
  assert.deepEqual(plan({ branch: 'release/v0.9.x', manifestVersion: '0.9.0', tags: ['v0.8.0', 'v0.9.0'] }), {
    ok: true,
    version: '0.9.1',
    bumped: true,
    resumed: false,
    previousTag: 'v0.9.0',
  })
})

test('a release skips past tags already taken', () => {
  const result = plan({ branch: 'release/v0.9.x', manifestVersion: '0.9.1', tags: ['v0.9.0', 'v0.9.1', 'v0.9.2'] })
  assert.ok(result.ok)
  assert.equal(result.version, '0.9.3')
  assert.equal(result.previousTag, 'v0.9.2')
})

test('a run that died after its bump commit but before tagging ships the same version', () => {
  const result = plan({ branch: 'release/v0.9.x', manifestVersion: '0.9.2', tags: ['v0.9.0', 'v0.9.1'] })
  assert.ok(result.ok)
  assert.equal(result.version, '0.9.2')
  assert.equal(result.bumped, false)
  assert.equal(result.resumed, false)
})

test('a tagged version without a GitHub Release is resumed, never bumped past', () => {
  const result = plan({
    branch: 'release/v0.9.x',
    manifestVersion: '0.9.2',
    tags: ['v0.9.0', 'v0.9.1', 'v0.9.2', 'v0.10.0'],
    newestTagReleased: false,
  })
  assert.deepEqual(result, { ok: true, version: '0.9.2', bumped: false, resumed: true, previousTag: 'v0.9.1' })
})

test('the newest line tag ignores other lines', () => {
  assert.equal(newestLineTag('release/v0.9.x', ['v0.9.0', 'v0.10.0', 'v0.9.2', 'v0.9.10']), 'v0.9.10')
  assert.equal(newestLineTag('release/v0.11.x', ['v0.9.0', 'v0.10.0']), null)
  assert.equal(newestLineTag('main', ['v0.9.0']), null)
})

test('a release refuses branches and manifests that disagree', () => {
  assert.equal(plan({ branch: 'main', manifestVersion: '0.9.0', tags: [] }).ok, false)
  assert.equal(plan({ branch: 'release/v0.4.8', manifestVersion: '0.4.8', tags: [] }).ok, false)
  const mismatch = plan({ branch: 'release/v0.9.x', manifestVersion: '0.10.0', tags: [] })
  assert.ok(!mismatch.ok)
  assert.match(mismatch.error, /does not belong to release\/v0\.9\.x/)
})

test('only the newest line moves latest', () => {
  assert.equal(resolveStableDistTag('0.10.0', '0.9.1'), 'latest')
  assert.equal(resolveStableDistTag('0.9.2', '0.10.0'), 'latest-0.9')
  assert.equal(resolveStableDistTag('0.9.1', '0.9.0'), 'latest')
  assert.equal(resolveStableDistTag('0.9.1', null), 'latest')
})

test('latest is judged by the highest version any package carries', () => {
  assert.equal(highestLatest(['0.9.1', '0.10.0', null, '0.9.1']), '0.10.0', 'a half-published 0.10.0 still counts')
  assert.equal(highestLatest([null, 'not-a-version']), null)
  assert.equal(resolveStableDistTag('0.9.2', highestLatest(['0.9.1', '0.10.0'])), 'latest-0.9')
})

test('stamping changes only the version and keeps the manifest format', () => {
  const source = '{\n  "name": "@open-mercato/x",\n  "version": "0.9.0",\n  "private": false\n}\n'
  assert.equal(stampManifestVersion(source, '0.9.0'), source)
  assert.equal(stampManifestVersion(source, '0.10.0'), source.replace('0.9.0', '0.10.0'))
})

test('a minor upgrade window starts at the previous minor, never a patch', () => {
  assert.equal(previousMinorRelease('0.10.0', ['v0.8.0', 'v0.9.0', 'v0.9.1', 'v0.9.2']), '0.9.0')
  assert.equal(previousMinorRelease('1.0.0', ['v0.9.0', 'v0.10.0', 'v0.10.3']), '0.10.0')
  assert.equal(previousMinorRelease('0.1.0', []), null)
})

test('the upgrade window is dated with the release date, once', () => {
  const notes = '# Upgrade notes\n\n## 0.9.0 → 0.10.0 (Unreleased)\n\n- Do this.\n\n## 0.8.0 → 0.9.0 (2026-10-09)\n'
  const stamped = stampUpgradeWindow(notes, '0.9.0', '0.10.0', '2026-11-20')
  assert.equal(stamped.matches, 1)
  assert.match(stamped.text, /^## 0\.9\.0 → 0\.10\.0 \(2026-11-20\)$/m)
  assert.match(stamped.text, /^## 0\.8\.0 → 0\.9\.0 \(2026-10-09\)$/m, 'older windows are untouched')
  assert.equal(stampUpgradeWindow(notes, '0.9.1', '0.10.0', 'x').matches, 0)
  assert.equal(changelogEntryDate('# 0.10.0 (2026-11-20)'), '2026-11-20')
  assert.equal(changelogEntryDate('# Unreleased'), null)
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

test('a green tag is green/YYYY-MM-DD with a real date', () => {
  assert.ok(isGreenTag('green/2026-11-20'))
  for (const name of ['green/20261120', 'green/2026-13-01', 'green/2026-02-30', 'green/2026-11-20-2', 'v0.10.0', 'main', 'refs/tags/green/2026-11-20']) {
    assert.ok(!isGreenTag(name), name)
  }
})

const TAGGED = 'a'.repeat(40)
const batchPr = (overrides: Partial<CommitPullRequest> = {}): CommitPullRequest => ({
  number: 50,
  state: 'closed',
  merged_at: '2026-11-20T10:00:00Z',
  head: { ref: 'stabilize/main-2026-11-20', sha: TAGGED },
  base: { ref: 'main' },
  ...overrides,
})

test('a green tag must be in the history of a stabilize/ batch PR merged into main', () => {
  assert.deepEqual(batchPullRequest([batchPr()], TAGGED, 'main'), { ok: true, number: 50, branch: 'stabilize/main-2026-11-20' })

  const movedHead = batchPr({ head: { ref: 'stabilize/main-2026-11-20', sha: 'b'.repeat(40) } })
  assert.deepEqual(
    batchPullRequest([movedHead], TAGGED, 'main', (headSha) => headSha === 'b'.repeat(40)),
    { ok: true, number: 50, branch: 'stabilize/main-2026-11-20' },
    'main merged into the batch after tagging still counts: the tag is in the batch history',
  )

  const open = batchPullRequest([batchPr({ state: 'open', merged_at: null })], TAGGED, 'main')
  assert.ok(!open.ok)
  assert.match(open.error, /#50 \(stabilize\/main-2026-11-20\), which is still open/)

  const closed = batchPullRequest([batchPr({ merged_at: null })], TAGGED, 'main')
  assert.ok(!closed.ok)
  assert.match(closed.error, /closed without merging into main/)

  for (const pulls of [
    [],
    [batchPr({ head: { ref: 'feat/x', sha: TAGGED } })],
    [batchPr({ base: { ref: 'release/v0.9.x' } })],
    [movedHead],
  ]) {
    const verdict = batchPullRequest(pulls, TAGGED, 'main')
    assert.ok(!verdict.ok)
    assert.match(verdict.error, /is not in the history of a stabilize\/ PR merged into main/)
  }
})

test('the PRs a ref contains come from squash and merge commit subjects', () => {
  const numbers = pullRequestsInSubjects([
    'feat(sales): add quotes (#101)',
    'fix(core): decrypt lists (#5430) (#5822)',
    'Merge pull request #77 from acme/branch',
    'chore: no number',
    'docs: mention #9 inside',
  ])
  assert.deepEqual([...numbers].sort((left, right) => left - right), [77, 101, 5822])
})

test('a changelog entry names its PR last, or by its pull link', () => {
  assert.equal(entryPullRequest('- ✨ Add project mode (#6989). (#7001) *(@dev)*'), 7001)
  assert.equal(entryPullRequest('* fix(sso): keep redirects (#9019) by @bot in https://github.com/o/r/pull/10394'), 10394)
  assert.equal(entryPullRequest('Prose with no reference.'), null)
})

const UNRELEASED_SECTION = [
  '# Unreleased',
  '',
  '## Highlights',
  '',
  'A release about quotes.',
  '',
  '## ✨ Features',
  '- ✨ Quotes in the tag. (#101) *(@dev)*',
  '- ✨ Invoices after the tag. (#102) *(@dev)*',
  '',
  '## 🐛 Fixes',
  '- 🐛 Fix in the tag,',
  '  over two lines. (#103) *(@dev)*',
  '',
  '---',
  '',
].join('\n')

test('a green-tag cut splits Unreleased: PRs in the tag go to the line, later PRs stay on main', () => {
  const inTag = new Set([101, 103])
  const split = splitUnreleased(`${UNRELEASED_SECTION}${CHANGELOG}`, (pr) => inTag.has(pr))
  assert.ok(split)
  assert.equal(split.line, '## ✨ Features\n- ✨ Quotes in the tag. (#101) *(@dev)*\n\n## 🐛 Fixes\n- 🐛 Fix in the tag,\n  over two lines. (#103) *(@dev)*')
  assert.equal(split.trunk, '## Highlights\n\nA release about quotes.\n\n## ✨ Features\n- ✨ Invoices after the tag. (#102) *(@dev)*')
  assert.deepEqual(split.untraced, ['A release about quotes.'], 'an entry naming no PR stays on main and is reported')
  assert.equal(splitUnreleased(CHANGELOG, () => true), null)
})

test('the split writes each side back under one Unreleased heading', () => {
  const trunk = withUnreleased(`${UNRELEASED_SECTION}${CHANGELOG}`, '- Later. (#102)')
  assert.equal(trunk, `# Unreleased\n\n- Later. (#102)\n\n---\n\n${CHANGELOG}`)
  assert.equal(withUnreleased(CHANGELOG, '- Carried. (#101)'), `# Unreleased\n\n- Carried. (#101)\n\n${CHANGELOG}`)
  assert.equal(withUnreleased(`${UNRELEASED_SECTION}${CHANGELOG}`, ''), CHANGELOG, 'an empty side drops the section')
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

type Route = [pattern: string | RegExp, status: number, data?: unknown]
type Call = { route: string; body: Record<string, unknown> | undefined }

function fakeGithub(routes: Route[]) {
  const calls: Call[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const route = `${init.method} ${url.replace('https://api.github.com', '')}`
    calls.push({ route, body: init.body ? JSON.parse(init.body) : undefined })
    const match = routes.find(([pattern]) => (typeof pattern === 'string' ? pattern === route : pattern.test(route)))
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
  assert.deepEqual(calls.at(-1)?.body, { name: 'v0.9.1', body: 'b', make_latest: 'false' })
})

test('the client tags once and refuses to move a tag', async () => {
  const fresh = fakeGithub([['POST /repos/acme/repo/git/refs', 201, { object: { sha: 'abc' } }]])
  await fresh.client.ensureTag('v0.9.1', 'abc')
  assert.deepEqual(fresh.calls.at(-1)?.body, { ref: 'refs/tags/v0.9.1', sha: 'abc' })

  const same = fakeGithub([['GET /repos/acme/repo/git/ref/tags/v0.9.1', 200, { object: { sha: 'abc' } }]])
  await same.client.ensureTag('v0.9.1', 'abc')
  assert.equal(same.calls.length, 1)

  const moved = fakeGithub([['GET /repos/acme/repo/git/ref/tags/v0.9.1', 200, { object: { sha: 'abc' } }]])
  await assert.rejects(moved.client.ensureTag('v0.9.1', 'def'), /already points at abc/)
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

function fixtureRepo(version: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-line-'))
  const writeJson = (rel: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, 2)}\n`)
  }
  writeJson('package.json', { name: 'open-mercato', version, private: true })
  writeJson('packages/shared/package.json', { name: '@open-mercato/shared', version })
  writeJson('packages/core/package.json', { name: '@open-mercato/core', version, dependencies: { '@open-mercato/shared': 'workspace:*' } })
  writeJson('packages/eslint-plugin-ds/package.json', { name: '@open-mercato/eslint-plugin-ds', version: '0.1.0', private: true })
  writeJson('apps/mercato/package.json', { name: 'mercato', version, private: true })
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture')
  return { root, git }
}

type ApiRequest = { method: string; url: string; body: Record<string, unknown> | undefined }

async function fakeApi(handler: (request: ApiRequest) => [number, unknown?]) {
  const requests: ApiRequest[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const request = { method: req.method ?? '', url: req.url ?? '', body: raw ? JSON.parse(raw) : undefined }
      requests.push(request)
      const [status, data] = handler(request)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(data === undefined ? '' : JSON.stringify(data))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) }
}

async function runLine(root: string, args: string[], env: Record<string, string> = {}) {
  const outputFile = path.join(root, '.github-output')
  fs.writeFileSync(outputFile, '')
  const result = await new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [scriptPath, ...args],
      { encoding: 'utf8', env: { ...process.env, OM_RELEASE_ROOT: root, GITHUB_OUTPUT: outputFile, GH_TOKEN: '', ...env } },
      (error, stdout, stderr) => resolve({ status: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    )
  })
  const outputs = Object.fromEntries(
    fs
      .readFileSync(outputFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
  return { ...result, outputs }
}

const readVersion = (root: string, rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')).version

test('cut --dry-run names the line and stamps main to the next minor', async () => {
  const { root } = fixtureRepo('0.9.0')
  const result = await runLine(root, ['cut', '--dry-run', '--branch', 'main'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.releaseBranch, 'release/v0.9.x')
  assert.equal(result.outputs.nextVersion, '0.10.0')
  for (const rel of ['package.json', 'packages/shared/package.json', 'packages/core/package.json', 'apps/mercato/package.json']) {
    assert.equal(readVersion(root, rel), '0.10.0', rel)
  }
  assert.equal(readVersion(root, 'packages/eslint-plugin-ds/package.json'), '0.1.0', 'private packages version on their own')
})

test('cut refuses to run from anything but main', async () => {
  const { root } = fixtureRepo('0.9.0')
  const result = await runLine(root, ['cut', '--dry-run', '--branch', 'release/v0.9.x'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /cut from main/)
})

test('a cut re-run after main moved refuses instead of rebuilding the bump PR', async () => {
  const { root } = fixtureRepo('0.9.0')
  const api = await fakeApi(({ method, url }) =>
    method === 'GET' && url.endsWith('/git/ref/heads/release/v0.9.x') ? [200, { object: { sha: 'f'.repeat(40) } }] : [500, { message: 'unexpected' }],
  )
  try {
    const result = await runLine(root, ['cut', '--branch', 'main'], { GH_TOKEN: 't', GITHUB_REPOSITORY: 'acme/repo', GITHUB_API_URL: api.url })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /already exists at ffffffffffff but main is at/)
    assert.equal(readVersion(root, 'package.json'), '0.9.0', 'nothing is stamped before the refusal')
    assert.equal(api.requests.length, 1)
  } finally {
    await api.close()
  }
})

const commitFixture = (git: (...args: string[]) => string, message: string) =>
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', message)

// main at 0.9.0: #101 is inside green/2026-11-20, #102 merged after it, and Unreleased lists both
// plus an untraced prose line.
function greenTagRepo() {
  const fixture = fixtureRepo('0.9.0')
  commitFixture(fixture.git, 'feat(sales): quotes (#101)')
  fixture.git('tag', 'green/2026-11-20')
  const tagged = fixture.git('rev-parse', 'HEAD')
  fs.writeFileSync(
    path.join(fixture.root, 'CHANGELOG.md'),
    `# Unreleased\n\nShort prose.\n\n- Quotes. (#101)\n- Invoices. (#102)\n\n${CHANGELOG}`,
  )
  fixture.git('add', '.')
  commitFixture(fixture.git, 'feat(sales): invoices (#102)')
  return { ...fixture, tagged, head: fixture.git('rev-parse', 'HEAD') }
}

type CutApiOptions = { tagged: string; head: string; existing?: string | null; existingParent?: string; existingChangelog?: string; pulls?: unknown[]; compare?: string }

function cutApi({ tagged, head, existing = null, existingParent, existingChangelog, pulls, compare = 'diverged' }: CutApiOptions) {
  const lineCommit = 'c'.repeat(40)
  const bumpCommit = 'd'.repeat(40)
  return (request: ApiRequest): [number, unknown?] => {
    const { method, url, body } = request
    if (method === 'GET' && url.endsWith(`/commits/${tagged}/pulls?per_page=100`)) {
      return [200, pulls ?? [{ number: 50, state: 'closed', merged_at: '2026-11-20T10:00:00Z', head: { ref: 'stabilize/main-2026-11-20', sha: tagged }, base: { ref: 'main' } }]]
    }
    if (method === 'GET' && url.includes('/compare/')) return [200, { status: compare }]
    if (method === 'GET' && existing && url.endsWith(`/commits/${existing}?per_page=2`)) return [200, { files: [{ filename: 'CHANGELOG.md', status: 'modified' }] }]
    if (method === 'GET' && url.endsWith('/git/ref/heads/release/v0.9.x')) return existing ? [200, { object: { sha: existing } }] : [404, { message: 'Not Found' }]
    if (method === 'GET' && existing && url.endsWith(`/git/commits/${existing}`)) return [200, { sha: existing, tree: { sha: 't' }, parents: [{ sha: existingParent }] }]
    if (method === 'GET' && url.includes('/contents/CHANGELOG.md')) return [200, { sha: 'x', content: Buffer.from(existingChangelog ?? '').toString('base64') }]
    if (method === 'GET' && url.includes('/git/commits/')) return [200, { sha: url.split('/').at(-1), tree: { sha: 't' }, parents: [] }]
    if (method === 'POST' && url.endsWith('/git/trees')) return [201, { sha: 'tree', tree: { sha: 'tree' } }]
    if (method === 'POST' && url.endsWith('/git/commits')) {
      const parents = (body?.parents ?? []) as string[]
      return [201, { sha: parents[0] === head ? bumpCommit : lineCommit, tree: { sha: 'tree' } }]
    }
    if (method === 'GET' && url.endsWith('/git/ref/heads/chore/open-v0.10.0')) return [404, { message: 'Not Found' }]
    if (method === 'POST' && url.endsWith('/git/refs')) return [201, { object: { sha: String(body?.sha) } }]
    if (method === 'PATCH' && url.includes('/git/refs/heads/')) return [200, { object: { sha: String(body?.sha) } }]
    if (method === 'GET' && url.includes('/pulls?')) return [200, []]
    if (method === 'POST' && url.endsWith('/pulls')) return [201, { number: 9, html_url: 'https://example/pr/9' }]
    if (method === 'POST' && url.endsWith('/issues/9/labels')) return [200, []]
    if (method === 'POST' && url.endsWith('/repo/labels')) return [422, { message: 'already_exists' }]
    return [500, { message: `unexpected ${method} ${url}` }]
  }
}

const apiEnv = (url: string) => ({ GH_TOKEN: 't', GITHUB_REPOSITORY: 'acme/repo', GITHUB_API_URL: url })
const treeChangelog = (request: ApiRequest) =>
  ((request.body?.tree ?? []) as { path: string; content: string }[]).find((file) => file.path === 'CHANGELOG.md')?.content

test('cut --at creates the line at the green tag, not main\'s tip, and splits Unreleased', async () => {
  const { root, tagged, head } = greenTagRepo()
  const api = await fakeApi(cutApi({ tagged, head }))
  try {
    const result = await runLine(root, ['cut', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs.sha, tagged)
    assert.equal(result.outputs.cutFrom, 'green/2026-11-20')
    const created = api.requests.find((request) => request.method === 'POST' && request.url.endsWith('/git/refs') && request.body?.ref === 'refs/heads/release/v0.9.x')
    assert.deepEqual(created?.body, { ref: 'refs/heads/release/v0.9.x', sha: tagged })
    assert.notEqual(tagged, head)

    const trees = api.requests.filter((request) => request.method === 'POST' && request.url.endsWith('/git/trees'))
    const commits = api.requests.filter((request) => request.method === 'POST' && request.url.endsWith('/git/commits'))
    const lineIndex = commits.findIndex((request) => (request.body?.parents as string[])[0] === tagged)
    const trunkIndex = commits.findIndex((request) => (request.body?.parents as string[])[0] === head)
    assert.ok(lineIndex >= 0 && trunkIndex >= 0, 'one commit carries the line changelog, one bumps main')
    const lineChangelog = treeChangelog(trees[lineIndex]) ?? ''
    const trunkChangelog = treeChangelog(trees[trunkIndex]) ?? ''
    assert.equal(lineChangelog, `# Unreleased\n\n- Quotes. (#101)\n\n${CHANGELOG}`, 'the tag\'s changelog is kept byte for byte below the carried entries')
    assert.doesNotMatch(lineChangelog, /#102|Short prose/)
    assert.match(trunkChangelog, /^# Unreleased\n\nShort prose\.\n\n- Invoices\. \(#102\)\n\n# 0\.9\.0/)
    assert.doesNotMatch(trunkChangelog, /#101/)
    const moved = api.requests.find((request) => request.method === 'PATCH' && request.url.endsWith('/git/refs/heads/release/v0.9.x'))
    assert.deepEqual(moved?.body, { sha: 'c'.repeat(40), force: false }, 'the changelog commit fast-forwards the line')
    assert.match(result.stdout, /names no PR, kept on main.*Short prose\./)
  } finally {
    await api.close()
  }
})

test('cut --at refuses a ref that is not a green tag', async () => {
  const { root, git } = greenTagRepo()
  git('tag', 'v0.9.0')
  for (const ref of ['main', 'v0.9.0', 'green/20261120', 'green/2026-11-20-rc']) {
    const result = await runLine(root, ['cut', '--dry-run', '--branch', 'main', '--at', ref])
    assert.notEqual(result.status, 0, ref)
    assert.match(result.stderr, /--at takes a green\/YYYY-MM-DD tag/, ref)
  }
})

test('cut --at refuses a green tag that does not exist', async () => {
  const { root } = greenTagRepo()
  const result = await runLine(root, ['cut', '--dry-run', '--branch', 'main', '--at', 'green/2026-11-21'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /tag green\/2026-11-21 does not exist/)
})

test('cut --at refuses a green tag on an unmerged or closed batch PR', async () => {
  const { root, tagged, head } = greenTagRepo()
  const batch = { number: 50, head: { ref: 'stabilize/main-2026-11-20', sha: tagged }, base: { ref: 'main' } }
  for (const [pulls, error] of [
    [[{ ...batch, state: 'open', merged_at: null }], /#50 \(stabilize\/main-2026-11-20\), which is still open/],
    [[{ ...batch, state: 'closed', merged_at: null }], /closed without merging into main/],
    [[], /is not in the history of a stabilize\/ PR merged into main/],
  ] as const) {
    const api = await fakeApi(cutApi({ tagged, head, pulls: [...pulls] }))
    try {
      const result = await runLine(root, ['cut', '--dry-run', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, error)
      assert.ok(!api.requests.some((request) => request.method !== 'GET'), 'a refused tag writes nothing')
    } finally {
      await api.close()
    }
  }
  assert.equal(readVersion(root, 'package.json'), '0.9.0', 'nothing is stamped before the refusal')
})

test('cut --at accepts a green tag below the head of a merged batch, and refuses one off its history', async () => {
  const { root, tagged, head } = greenTagRepo()
  const movedHead = 'b'.repeat(40)
  const pulls = [{ number: 50, state: 'closed', merged_at: '2026-11-20T10:00:00Z', head: { ref: 'stabilize/main-2026-11-20', sha: movedHead }, base: { ref: 'main' } }]
  for (const [compare, accepted] of [['ahead', true], ['diverged', false]] as const) {
    const api = await fakeApi(cutApi({ tagged, head, pulls, compare }))
    try {
      const result = await runLine(root, ['cut', '--dry-run', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
      assert.ok(api.requests.some((request) => request.url.includes(`/compare/${tagged}...${movedHead}`)), 'ancestry is checked against the batch head')
      if (accepted) {
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.outputs.sha, tagged, 'the line starts at the tag, not the batch head')
      } else {
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /is not in the history of a stabilize\/ PR merged into main/)
      }
    } finally {
      await api.close()
    }
  }
})

test('cut --at --dry-run validates the green tag and names the line', async () => {
  const { root, tagged, head } = greenTagRepo()
  const api = await fakeApi(cutApi({ tagged, head }))
  try {
    const result = await runLine(root, ['cut', '--dry-run', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs.releaseBranch, 'release/v0.9.x')
    assert.equal(result.outputs.sha, tagged)
    assert.match(result.stdout, /is on #50 \(stabilize\/main-2026-11-20\), merged into main/)
    assert.ok(api.requests.every((request) => request.method === 'GET'), 'a dry run only reads')
  } finally {
    await api.close()
  }
})

test('cut --at re-runs safely from the same green tag, even after main moved', async () => {
  const lineTip = 'c'.repeat(40)
  const expectedLine = `# Unreleased\n\n- Quotes. (#101)\n\n${CHANGELOG}`
  for (const lineAt of ['tag', 'changelog commit'] as const) {
    const { root, tagged, head } = greenTagRepo()
    const options = lineAt === 'tag' ? { existing: tagged } : { existing: lineTip, existingParent: tagged, existingChangelog: expectedLine }
    const api = await fakeApi(cutApi({ tagged, head, ...options }))
    try {
      const result = await runLine(root, ['cut', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /release\/v0\.9\.x already exists/)
      assert.ok(!api.requests.some((request) => request.method === 'POST' && request.body?.ref === 'refs/heads/release/v0.9.x'), 'the line is not created twice')
      const lineCommits = api.requests.filter((request) => request.method === 'POST' && request.url.endsWith('/git/commits') && (request.body?.parents as string[])[0] === tagged)
      assert.equal(lineCommits.length, lineAt === 'tag' ? 1 : 0, 'the changelog commit is added once')
      assert.equal(result.outputs.prUrl, 'https://example/pr/9')
    } finally {
      await api.close()
    }
  }
})

test('cut --at refuses a direct child of the tag that also changes code', async () => {
  const { root, tagged, head } = greenTagRepo()
  const existing = 'c'.repeat(40)
  const existingChangelog = `# Unreleased\n\n- Quotes. (#101)\n\n${CHANGELOG}`
  const handler = cutApi({ tagged, head, existing, existingParent: tagged, existingChangelog })
  const api = await fakeApi((request) => {
    if (request.method === 'GET' && request.url.endsWith(`/commits/${existing}?per_page=2`)) {
      return [200, { files: [{ filename: 'CHANGELOG.md' }, { filename: 'packages/core/index.ts' }] }]
    }
    return handler(request)
  })
  try {
    const result = await runLine(root, ['cut', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /neither .* nor its changelog commit/)
    assert.ok(api.requests.every((request) => request.method === 'GET'), 'an advanced line must not rebuild the bump PR')
    assert.equal(readVersion(root, 'package.json'), '0.9.0')
  } finally {
    await api.close()
  }
})

test('cut --at checks an existing changelog commit even when no notes need carrying', async () => {
  const { root, git } = fixtureRepo('0.9.0')
  const changelog = `# Unreleased\n\n- Quotes. (#101)\n\n${CHANGELOG}`
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog)
  git('add', '.')
  commitFixture(git, 'feat(sales): quotes (#101)')
  git('tag', 'green/2026-11-20')
  const tagged = git('rev-parse', 'HEAD')
  const api = await fakeApi(cutApi({
    tagged, head: tagged, existing: 'c'.repeat(40), existingParent: tagged,
    existingChangelog: `# Unreleased\n\n- Wrong notes. (#999)\n\n${CHANGELOG}`,
  }))
  try {
    const result = await runLine(root, ['cut', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /already carries a different # Unreleased/)
    assert.ok(api.requests.every((request) => request.method === 'GET'))
  } finally {
    await api.close()
  }
})

test('cut --at refuses a green tag carrying a different version before any writes', async () => {
  const { root, tagged, head } = greenTagRepo()
  const manifestPath = path.join(root, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '0.10.0' }))
  const api = await fakeApi(cutApi({ tagged, head }))
  try {
    const result = await runLine(root, ['cut', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /carries 0.9.0, but main is at 0.10.0/)
    assert.ok(api.requests.every((request) => request.method === 'GET'))
    assert.equal(readVersion(root, 'package.json'), '0.10.0')
  } finally {
    await api.close()
  }
})

test('cut --at refuses a line that was cut elsewhere', async () => {
  const { root, tagged, head } = greenTagRepo()
  const api = await fakeApi(cutApi({ tagged, head, existing: 'e'.repeat(40), existingParent: 'f'.repeat(40) }))
  try {
    const result = await runLine(root, ['cut', '--branch', 'main', '--at', 'green/2026-11-20'], apiEnv(api.url))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /already exists at eeeeeeeeeeee, which is neither green\/2026-11-20/)
  } finally {
    await api.close()
  }
})

test('prepare --dry-run bumps a released line to its next patch under latest-X.Y', async () => {
  const { root, git } = fixtureRepo('0.9.0')
  git('tag', 'v0.9.0')
  const result = await runLine(root, ['prepare', '--dry-run', '--branch', 'release/v0.9.x', '--latest', '0.10.0', '--released', 'v0.9.0', '--date', '2026-10-21'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.version, '0.9.1')
  assert.equal(result.outputs.distTag, 'latest-0.9')
  assert.equal(result.outputs.changelog, 'generated')
  assert.equal(readVersion(root, 'packages/core/package.json'), '0.9.1')
  assert.match(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), /^# 0\.9\.1 \(2026-10-21\)/)
})

function addUpgradeCompanions(root: string, from: string, to: string, marker: string) {
  fs.writeFileSync(path.join(root, 'UPGRADE_NOTES.md'), `# Upgrade notes\n\n## ${from} → ${to} (${marker})\n\n- Do this.\n`)
  for (const dir of ['.ai/skills', 'packages/create-app/agentic/shared/ai/skills']) {
    const skillDir = path.join(root, dir, `om-auto-upgrade-${from}-to-${to}`)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: om-auto-upgrade-${from}-to-${to}\n---\n`)
  }
}

test('prepare refuses a minor whose upgrade companions are missing', async () => {
  const { root, git } = fixtureRepo('0.10.0')
  git('tag', 'v0.9.0')
  git('tag', 'v0.9.1')
  const result = await runLine(root, ['prepare', '--dry-run', '--branch', 'release/v0.10.x', '--latest', '0.9.1', '--released', 'none', '--published', 'none', '--date', '2026-11-20'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /0\.10\.0 is a minor release and needs its upgrade companions/)
  assert.match(result.stderr, /"## 0\.9\.0 → 0\.10\.0 \(…\)" window/)
  assert.match(result.stderr, /om-auto-upgrade-0\.9\.0-to-0\.10\.0\/SKILL\.md/)
})

test('prepare dates a curated minor upgrade window with the date its changelog entry carries', async () => {
  const { root, git } = fixtureRepo('0.10.0')
  addUpgradeCompanions(root, '0.9.0', '0.10.0', 'Unreleased')
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# 0.10.0 (2026-11-18)\n\n- Curated.\n\n${CHANGELOG}`)
  git('add', '.')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'companions')
  git('tag', 'v0.9.0')
  const result = await runLine(root, ['prepare', '--dry-run', '--branch', 'release/v0.10.x', '--latest', '0.9.0', '--released', 'none', '--published', 'none', '--date', '2026-11-20'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.changelog, 'existing')
  assert.match(fs.readFileSync(path.join(root, 'UPGRADE_NOTES.md'), 'utf8'), /^## 0\.9\.0 → 0\.10\.0 \(2026-11-18\)$/m)
})

test('prepare --dry-run ships a fresh line as committed and moves latest', async () => {
  const { root, git } = fixtureRepo('0.10.0')
  addUpgradeCompanions(root, '0.9.0', '0.10.0', 'Unreleased')
  git('tag', 'v0.9.0')
  const result = await runLine(root, ['prepare', '--dry-run', '--branch', 'release/v0.10.x', '--latest', '0.9.0', '--released', 'none', '--published', 'none', '--date', '2026-10-21'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.version, '0.10.0')
  assert.equal(result.outputs.bumped, 'false')
  assert.equal(result.outputs.distTag, 'latest')
})

test('prepare refuses an untagged version that already has packages on npm', async () => {
  const { root, git } = fixtureRepo('0.9.2')
  git('tag', 'v0.9.0')
  git('tag', 'v0.9.1')
  const result = await runLine(root, ['prepare', '--dry-run', '--branch', 'release/v0.9.x', '--latest', '0.9.1', '--released', 'v0.9.1', '--published', '@open-mercato/core'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /0\.9\.2 has no tag, but @open-mercato\/core is already on npm\. Recreate v0\.9\.2/)
})

test('prepare resumes a tagged but unreleased version from its tagged commit, not the line tip', async () => {
  const { root, git } = fixtureRepo('0.9.1')
  git('tag', 'v0.9.0')
  git('tag', 'v0.9.1')
  const tagged = git('rev-parse', 'HEAD')
  fs.writeFileSync(path.join(root, 'backport.txt'), 'merged after the failed run\n')
  git('add', '.')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'backport')
  const result = await runLine(root, ['prepare', '--branch', 'release/v0.9.x', '--latest', '0.9.0', '--released', 'v0.9.0'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.version, '0.9.1')
  assert.equal(result.outputs.resumed, 'true')
  assert.equal(result.outputs.sha, tagged)
})

test('prepare commits the bump, then tags it before anything is built', async () => {
  const { root, git } = fixtureRepo('0.9.0')
  git('tag', 'v0.9.0')
  const head = git('rev-parse', 'HEAD')
  const bump = 'b'.repeat(40)
  const api = await fakeApi(({ method, url }) => {
    if (method === 'POST' && url.endsWith('/releases/generate-notes')) return [200, { body: '## 🐛 Fixes\n* a fix' }]
    if (method === 'GET' && url.includes('/git/commits/')) return [200, { sha: head, tree: { sha: 't'.repeat(40) } }]
    if (method === 'POST' && url.endsWith('/git/trees')) return [201, { sha: 'e'.repeat(40), tree: { sha: 'e'.repeat(40) } }]
    if (method === 'POST' && url.endsWith('/git/commits')) return [201, { sha: bump, tree: { sha: 'e'.repeat(40) } }]
    if (method === 'PATCH' && url.endsWith('/git/refs/heads/release/v0.9.x')) return [200, { object: { sha: bump } }]
    if (method === 'GET' && url.endsWith('/git/ref/tags/v0.9.1')) return [404, { message: 'Not Found' }]
    if (method === 'POST' && url.endsWith('/git/refs')) return [201, { object: { sha: bump } }]
    return [500, { message: `unexpected ${method} ${url}` }]
  })
  try {
    const result = await runLine(root, ['prepare', '--branch', 'release/v0.9.x', '--latest', '0.9.0', '--released', 'v0.9.0', '--date', '2026-10-21'], {
      GH_TOKEN: 't',
      GITHUB_REPOSITORY: 'acme/repo',
      GITHUB_API_URL: api.url,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs.sha, bump)
    const moveIndex = api.requests.findIndex((request) => request.method === 'PATCH')
    const tagRequest = api.requests.findIndex((request) => request.method === 'POST' && request.url.endsWith('/git/refs'))
    assert.ok(moveIndex >= 0 && tagRequest > moveIndex, 'the tag follows the bump commit')
    assert.deepEqual(api.requests[tagRequest].body, { ref: 'refs/tags/v0.9.1', sha: bump })
  } finally {
    await api.close()
  }
})

test('verify accepts a tag that names the committed version on its line, and resolves the dist-tag then', async () => {
  const { root, git } = fixtureRepo('0.9.1')
  git('update-ref', 'refs/remotes/origin/release/v0.9.x', 'HEAD')
  const result = await runLine(root, ['verify', '--tag', 'v0.9.1', '--latest', '0.10.0', '--released', 'none'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.outputs, { version: '0.9.1', released: 'false', distTag: 'latest-0.9' })
})

test('verify skips a version whose GitHub Release already exists', async () => {
  const { root, git } = fixtureRepo('0.9.1')
  git('update-ref', 'refs/remotes/origin/release/v0.9.x', 'HEAD')
  const result = await runLine(root, ['verify', '--tag', 'v0.9.1', '--released', 'v0.9.1'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs.released, 'true')
})

test('verify refuses a tag whose commit carries another version', async () => {
  const { root, git } = fixtureRepo('0.9.0')
  git('update-ref', 'refs/remotes/origin/release/v0.9.x', 'HEAD')
  const result = await runLine(root, ['verify', '--tag', 'v0.9.1', '--latest', '0.9.0', '--released', 'none'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /root manifest is 0\.9\.0, not 0\.9\.1/)
})

test('verify refuses a tag that is not on its release line', async () => {
  const { root } = fixtureRepo('0.9.1')
  const result = await runLine(root, ['verify', '--tag', 'v0.9.1', '--latest', '0.9.0', '--released', 'none'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /is not on release\/v0\.9\.x/)
})

test('announce opens the changelog PR before the GitHub Release that marks the version done', async () => {
  const { root } = fixtureRepo('0.9.0')
  const mainSha = 'a'.repeat(40)
  const olderChangelog = Buffer.from('# 0.8.0 (2026-09-01)\n\n- Old.\n').toString('base64')
  const api = await fakeApi(({ method, url }) => {
    if (method === 'GET' && url.endsWith('/git/ref/heads/main')) return [200, { object: { sha: mainSha } }]
    if (method === 'GET' && url.includes('/contents/CHANGELOG.md')) return [200, { sha: 'c', content: olderChangelog }]
    if (method === 'GET' && url.includes('/git/commits/')) return [200, { sha: mainSha, tree: { sha: 't' } }]
    if (method === 'POST' && url.endsWith('/git/trees')) return [201, { sha: 'tree', tree: { sha: 'tree' } }]
    if (method === 'POST' && url.endsWith('/git/commits')) return [201, { sha: 'c'.repeat(40), tree: { sha: 'tree' } }]
    if (method === 'GET' && url.includes('/git/ref/heads/chore/changelog-v0.9.0')) return [404, { message: 'Not Found' }]
    if (method === 'POST' && url.endsWith('/git/refs')) return [201, { object: { sha: 'c'.repeat(40) } }]
    if (method === 'GET' && url.includes('/pulls?')) return [200, []]
    if (method === 'POST' && url.endsWith('/pulls')) return [201, { number: 9, html_url: 'https://example/pr/9' }]
    if (method === 'POST' && url.endsWith('/issues/9/labels')) return [200, []]
    if (method === 'POST' && url.endsWith('/repo/labels')) return [422, { message: 'already_exists' }]
    if (method === 'GET' && url.endsWith('/releases/tags/v0.9.0')) return [404, { message: 'Not Found' }]
    if (method === 'POST' && url.endsWith('/releases')) return [201, { id: 1 }]
    return [500, { message: `unexpected ${method} ${url}` }]
  })
  try {
    const result = await runLine(root, ['announce', '--version', '0.9.0', '--sha', 'd'.repeat(40), '--dist-tag', 'latest'], {
      GH_TOKEN: 't',
      GITHUB_REPOSITORY: 'acme/repo',
      GITHUB_API_URL: api.url,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs.changelogPr, 'https://example/pr/9')
    const prIndex = api.requests.findIndex((request) => request.method === 'POST' && request.url.endsWith('/pulls'))
    const releaseIndex = api.requests.findIndex((request) => request.method === 'POST' && request.url.endsWith('/releases'))
    assert.ok(prIndex >= 0 && releaseIndex > prIndex, 'the GitHub Release is created last')
  } finally {
    await api.close()
  }
})

test('announce --dry-run renders the release body with the package table', async () => {
  const { root } = fixtureRepo('0.9.0')
  const result = await runLine(root, ['announce', '--dry-run', '--version', '0.9.0', '--sha', 'abcdef1234567890', '--dist-tag', 'latest'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /## Highlights/)
  assert.match(result.stdout, /\| `@open-mercato\/core` \| `0\.9\.0` \|/)
  assert.doesNotMatch(result.stdout, /eslint-plugin-ds/)
})

test('the release tooling typechecks under strict, erasable-only TypeScript', () => {
  const tsc = path.resolve('node_modules/.bin/tsc')
  const output = execFileSync(tsc, ['-p', path.resolve('scripts/tsconfig.release.json')], { encoding: 'utf8' })
  assert.equal(output.trim(), '')
})
