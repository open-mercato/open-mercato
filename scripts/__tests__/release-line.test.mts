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
  changelogEntryDate,
  changelogSection,
  dropUnreleased,
  ensureChangelogEntry,
  highestLatest,
  insertChangelogEntry,
  newestLineTag,
  nextMinorVersion,
  planRelease,
  previousMinorRelease,
  releaseBranchFor,
  resolveStableDistTag,
  stampManifestVersion,
  stampUpgradeWindow,
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
