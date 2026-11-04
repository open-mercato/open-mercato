import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar'
import { main, parseArgs, resolveTemplateFlags, shouldOfferModulePicker } from '../../index.ts'
import {
  DEFAULT_TEMPLATES_URL,
  TEMPLATES_URL_ENV,
  fetchTemplatesIndex,
  parseTemplatesIndex,
  resolveTemplatesUrl,
} from './fetch-templates.js'
import {
  describeTemplateSelection,
  downloadSelectedTemplate,
  findTemplateEntry,
  parseTemplateArg,
  resolveTemplateSelection,
} from './resolve-template.js'
import type { TemplatesFetch, TemplatesIndex } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE: unknown = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'templates.json'), 'utf8'))
const API = 'https://api.github.com'
const SHA_SOURCE = '1111111111111111111111111111111111111111'
const SHA_VERIFIED = '2222222222222222222222222222222222222222'
const SHA_B2B = '3333333333333333333333333333333333333333'
const SHA_OTHER = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
const DEPS = { indexUrl: DEFAULT_TEMPLATES_URL, packageVersion: '0.10.0', timeoutMs: 50 }

const scratchDirs: string[] = []
const scratchDir = (prefix = 'om-templates-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratchDirs.push(dir)
  return dir
}

const savedEnv = {
  token: process.env.GITHUB_TOKEN,
  apiBase: process.env.OM_CREATE_APP_GITHUB_API_BASE_URL,
  templatesUrl: process.env[TEMPLATES_URL_ENV],
}
const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(() => {
  delete process.env.GITHUB_TOKEN
  delete process.env.OM_CREATE_APP_GITHUB_API_BASE_URL
  delete process.env[TEMPLATES_URL_ENV]
})

after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
  restore('GITHUB_TOKEN', savedEnv.token)
  restore('OM_CREATE_APP_GITHUB_API_BASE_URL', savedEnv.apiBase)
  restore(TEMPLATES_URL_ENV, savedEnv.templatesUrl)
})

type Route = (url: string) => Response | Promise<Response> | undefined
type RecordedRequest = { url: string; headers: Headers }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fetch that answers from the routes in order and records every request; an unrouted request fails the test. */
function mockFetch(...routes: Route[]) {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, headers: new Headers(init?.headers) })
    for (const route of routes) {
      const response = await route(url)
      if (response) return response
    }
    throw new Error(`unexpected request ${url}`)
  }) as typeof fetch
  return { fetchImpl, requests }
}

const indexRoute = (body: unknown = FIXTURE, status = 200): Route => (url) =>
  url === DEFAULT_TEMPLATES_URL ? json(body, status) : undefined
const repoRoute = (path: string, defaultBranch = 'main'): Route => (url) =>
  url === `${API}/repos/${path}` ? json({ default_branch: defaultBranch }) : undefined
const commitRoute = (path: string, ref: string, sha: string): Route => (url) =>
  url === `${API}/repos/${path}/commits/${encodeURIComponent(ref)}` ? json({ sha }) : undefined
const tarballRoute = (path: string, sha: string, response: () => Response): Route => (url) =>
  url === `${API}/repos/${path}/tarball/${sha}` ? response() : undefined
const githubRequests = (requests: RecordedRequest[]) => requests.filter((request) => request.url.startsWith(API))
const parsedFixture = () => parseTemplatesIndex(FIXTURE) as TemplatesIndex

// Index URL

test('resolveTemplatesUrl uses the default and accepts https or a loopback http override', () => {
  assert.equal(resolveTemplatesUrl({}), DEFAULT_TEMPLATES_URL)
  assert.equal(resolveTemplatesUrl({ [TEMPLATES_URL_ENV]: '  ' }), DEFAULT_TEMPLATES_URL)
  assert.equal(resolveTemplatesUrl({ [TEMPLATES_URL_ENV]: 'https://mirror.example.com/templates.json' }), 'https://mirror.example.com/templates.json')
  assert.equal(resolveTemplatesUrl({ [TEMPLATES_URL_ENV]: 'http://localhost:4100/templates.json' }), 'http://localhost:4100/templates.json')
  assert.equal(resolveTemplatesUrl({ [TEMPLATES_URL_ENV]: 'http://127.0.0.1:4100/templates.json' }), 'http://127.0.0.1:4100/templates.json')
  assert.equal(resolveTemplatesUrl({ [TEMPLATES_URL_ENV]: 'http://[::1]:4100/templates.json' }), 'http://[::1]:4100/templates.json')
})

test('resolveTemplatesUrl refuses plain http on other hosts, other schemes and invalid URLs', () => {
  for (const value of ['http://example.com/templates.json', 'http://127.0.0.2/templates.json', 'http://localhost.example.com/t.json', 'ftp://localhost/templates.json', 'file:///tmp/templates.json']) {
    assert.throws(() => resolveTemplatesUrl({ [TEMPLATES_URL_ENV]: value }), /OM_TEMPLATES_URL must be an https:\/\/ URL/, value)
  }
  assert.throws(() => resolveTemplatesUrl({ [TEMPLATES_URL_ENV]: 'not a url' }), /OM_TEMPLATES_URL is not a valid URL/)
})

// Index parsing and fetch

test('parseTemplatesIndex reads the fixture in the umbrella shape', () => {
  const index = parsedFixture()
  assert.equal(index.templates.length, 6)
  const crm = index.templates.find((entry) => entry.slug === 'crm')
  assert.equal(crm?.github, 'acme/crm-template')
  assert.equal(crm?.verified?.sha, SHA_VERIFIED)
  assert.deepEqual(crm?.verified?.facts?.env, [
    { name: 'OPENAI_API_KEY', description: 'Used by the AI assistant.', link: 'https://platform.openai.com/api-keys' },
  ])
  assert.equal(index.templates.find((entry) => entry.github === 'acme/b2b-portal')?.source.facts?.requiresEnterprise, true)
  assert.equal(index.templates.find((entry) => entry.github === 'acme/future-status')?.status, 'unknown')
  assert.equal(index.templates.find((entry) => entry.github === 'someone/no-slug-app')?.slug, null)
})

test('parseTemplatesIndex refuses another schema and drops malformed entries', () => {
  assert.equal(parseTemplatesIndex({ ...(FIXTURE as object), schema: 2 }), null)
  assert.equal(parseTemplatesIndex({ schema: 1 }), null)
  assert.equal(parseTemplatesIndex([]), null)
  const good = { github: 'Acme/Good', status: 'active', source: { sha: SHA_SOURCE.toUpperCase() } }
  const index = parseTemplatesIndex({
    schema: 1,
    templates: [
      good,
      { status: 'active', source: { sha: SHA_SOURCE } },
      { github: 'not-a-path', status: 'active', source: { sha: SHA_SOURCE } },
      { github: 'a/b/c', status: 'active', source: { sha: SHA_SOURCE } },
      { github: 'acme/..', status: 'active', source: { sha: SHA_SOURCE } },
      { github: 'acme/no-status', source: { sha: SHA_SOURCE } },
      { github: 'acme/short-sha', status: 'active', source: { sha: 'abc123' } },
      { github: 'acme/no-source', status: 'active' },
      'not an object',
    ],
  })
  assert.equal(index?.templates.length, 1)
  assert.equal(index?.templates[0]?.github, 'acme/good', 'paths are lower case')
  assert.equal(index?.templates[0]?.source.sha, SHA_SOURCE, 'shas are lower case')
  assert.equal(index?.templates[0]?.verified, null)
  assert.equal(index?.templates[0]?.slug, null)
})

test('parseTemplatesIndex frees strings of control characters and treats a bad verified block as not verified', () => {
  const index = parseTemplatesIndex({
    schema: 1,
    templates: [{
      slug: 'Bad Slug',
      github: 'acme/app',
      status: 'unmaintained',
      reason: 'Gone\u001b[2J away',
      source: { sha: SHA_SOURCE, facts: { omLine: '0.9', linesBehind: -1, env: [{ name: 'A_KEY' }, { description: 'no name' }] } },
      verified: { sha: 'not-a-sha' },
    }],
  })
  const entry = index?.templates[0]
  assert.equal(entry?.reason, 'Gone [2J away')
  assert.equal(entry?.slug, null, 'an invalid slug is ignored, the entry stays reachable as owner/repo')
  assert.equal(entry?.verified, null)
  assert.equal(entry?.source.facts?.linesBehind, null)
  assert.deepEqual(entry?.source.facts?.env, [{ name: 'A_KEY', description: '' }])
})

test('fetchTemplatesIndex retries once after a 5xx or a network error and never after a 4xx', async () => {
  const run = async (answers: Array<number | Error>) => {
    let calls = 0
    const fetchImpl: TemplatesFetch = async () => {
      const answer = answers[calls++]
      if (answer instanceof Error) throw answer
      return { status: answer as number, ok: answer === 200, json: async () => FIXTURE }
    }
    const result = await fetchTemplatesIndex({ fetchImpl, timeoutMs: 50 })
    return { result, calls }
  }
  const retried = await run([503, 200])
  assert.equal(retried.result.status, 'ok')
  assert.equal(retried.calls, 2)
  const network = await run([new Error('ECONNRESET'), new Error('ECONNRESET')])
  assert.deepEqual(network.result, { status: 'unavailable', url: DEFAULT_TEMPLATES_URL, reason: 'ECONNRESET' })
  assert.equal(network.calls, 2)
  const notFound = await run([404, 200])
  assert.deepEqual(notFound.result, { status: 'unavailable', url: DEFAULT_TEMPLATES_URL, reason: 'HTTP 404' })
  assert.equal(notFound.calls, 1)
})

test('fetchTemplatesIndex reports an unsupported body and never sends the GitHub token', async () => {
  process.env.GITHUB_TOKEN = 'ghp_secret'
  const { fetchImpl, requests } = mockFetch(indexRoute({ schema: 2, templates: [] }))
  const result = await resolveTemplateSelection(parseTemplateArg('acme/unlisted'), { ...DEPS, fetchImpl }).catch((error: Error) => error)
  assert.ok(result instanceof Error, 'the GitHub routes are not mocked, so resolution stops after the index')
  assert.equal(requests[0]?.url, DEFAULT_TEMPLATES_URL)
  assert.equal(requests[0]?.headers.get('accept'), 'application/json')
  assert.equal(requests[0]?.headers.get('authorization'), null)
  const direct = await fetchTemplatesIndex({ fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ schema: 2 }) }) })
  assert.deepEqual(direct, { status: 'unavailable', url: DEFAULT_TEMPLATES_URL, reason: 'unsupported templates.json format' })
})

// Argument parsing and lookup

test('parseTemplateArg reads a slug or owner/repo with an optional #ref', () => {
  assert.deepEqual(parseTemplateArg('crm'), { kind: 'slug', slug: 'crm', ref: null, input: 'crm' })
  assert.deepEqual(parseTemplateArg('crm#v1.0.0'), { kind: 'slug', slug: 'crm', ref: 'v1.0.0', input: 'crm#v1.0.0' })
  assert.deepEqual(parseTemplateArg(' Acme/CRM.app '), { kind: 'repo', owner: 'Acme', repo: 'CRM.app', ref: null, input: 'Acme/CRM.app' })
  assert.deepEqual(parseTemplateArg('acme/crm#feature/new#2'), { kind: 'repo', owner: 'acme', repo: 'crm', ref: 'feature/new#2', input: 'acme/crm#feature/new#2' })
})

test('parseTemplateArg refuses URLs, empty refs and invalid names', () => {
  for (const value of ['https://github.com/acme/crm', 'github.com/acme/crm', 'git@github.com:acme/crm.git']) {
    assert.throws(() => parseTemplateArg(value), /not a URL.*--app-url/, value)
  }
  assert.throws(() => parseTemplateArg('acme/crm#'), /invalid ref/)
  assert.throws(() => parseTemplateArg('acme/crm#bad ref'), /invalid ref/)
  assert.throws(() => parseTemplateArg('acme/crm#..'), /invalid ref/)
  assert.throws(() => parseTemplateArg('#main'), /needs a template slug or owner\/repo/)
  assert.throws(() => parseTemplateArg('Crm'), /lowercase alphanumeric/)
  assert.throws(() => parseTemplateArg('-crm'), /cannot start or end with a hyphen/)
  assert.throws(() => parseTemplateArg('acme/crm/extra'), /not a valid GitHub owner\/repo/)
  assert.throws(() => parseTemplateArg('ac_me/crm'), /not a valid GitHub owner\/repo/)
  assert.throws(() => parseTemplateArg('acme/..'), /not a valid GitHub owner\/repo/)
})

test('findTemplateEntry matches a slug exactly and owner/repo case-insensitively', () => {
  const index = parsedFixture()
  assert.equal(findTemplateEntry(index, parseTemplateArg('crm'))?.github, 'acme/crm-template')
  assert.equal(findTemplateEntry(index, parseTemplateArg('ACME/CRM-Template'))?.slug, 'crm')
  assert.equal(findTemplateEntry(index, parseTemplateArg('missing')), null)
  assert.equal(findTemplateEntry(index, parseTemplateArg('acme/missing')), null)
})

test('findTemplateEntry fails on a duplicate slug or path instead of picking one', () => {
  const index = parsedFixture()
  const crm = index.templates[0]!
  const duplicated: TemplatesIndex = { ...index, templates: [...index.templates, { ...crm, github: 'evil/crm' }, { ...crm, slug: null }] }
  assert.throws(() => findTemplateEntry(duplicated, parseTemplateArg('crm')), /lists crm more than once \(acme\/crm-template, evil\/crm\)/)
  assert.throws(() => findTemplateEntry(duplicated, parseTemplateArg('acme/crm-template')), /more than once/)
})

// Sha selection: one sha, its own facts

test('a listed slug without #ref selects verified.sha with its facts and makes no GitHub request', async () => {
  const { fetchImpl, requests } = mockFetch(indexRoute())
  const selection = await resolveTemplateSelection(parseTemplateArg('crm'), { ...DEPS, fetchImpl })
  assert.equal(selection.sha, SHA_VERIFIED)
  assert.equal(selection.verified, true)
  assert.equal(selection.facts?.omVersion, '0.10.0', 'the facts of verified.sha, not of source.sha')
  assert.equal(selection.ref, 'main')
  assert.equal(selection.shaFromIndex, true)
  assert.deepEqual(githubRequests(requests), [])
  assert.deepEqual(describeTemplateSelection(selection), {
    headline: `Template: acme/crm-template@${SHA_VERIFIED} (verified)`,
    pageUrl: 'https://modules.openmercato.com/t/acme/crm-template',
    notices: [],
  })
})

test('a listed entry without verified selects source.sha, not verified', async () => {
  const { fetchImpl } = mockFetch(indexRoute())
  const selection = await resolveTemplateSelection(parseTemplateArg('acme/b2b-portal'), { ...DEPS, fetchImpl })
  assert.equal(selection.sha, SHA_B2B)
  assert.equal(selection.verified, false)
  assert.equal(selection.facts?.requiresEnterprise, true)
  assert.equal(selection.ref, null, 'the default branch of an entry without ref is not resolved')
  assert.equal(describeTemplateSelection(selection).headline, `Template: acme/b2b-portal@${SHA_B2B} (not verified)`)
})

test('a listed #ref to a sha the index does not know has no facts', async () => {
  const { fetchImpl, requests } = mockFetch(indexRoute(), commitRoute('acme/crm-template', 'feature/x', SHA_OTHER))
  const selection = await resolveTemplateSelection(parseTemplateArg('crm#feature/x'), { ...DEPS, fetchImpl })
  assert.equal(selection.sha, SHA_OTHER)
  assert.equal(selection.verified, false)
  assert.equal(selection.facts, null)
  assert.equal(selection.ref, 'feature/x')
  assert.equal(selection.shaFromIndex, false)
  assert.deepEqual(githubRequests(requests).map((request) => request.url), [`${API}/repos/acme/crm-template/commits/feature%2Fx`])
  assert.equal(describeTemplateSelection(selection).headline, `Template: acme/crm-template@${SHA_OTHER} (not verified, no catalog facts for ${SHA_OTHER})`)
})

test('a listed #ref equal to source.sha keeps the source facts but not the verification', async () => {
  const { fetchImpl } = mockFetch(indexRoute(), commitRoute('acme/crm-template', 'main', SHA_SOURCE))
  const selection = await resolveTemplateSelection(parseTemplateArg('acme/crm-template#main'), { ...DEPS, fetchImpl })
  assert.equal(selection.sha, SHA_SOURCE)
  assert.equal(selection.verified, false)
  assert.equal(selection.facts?.omVersion, '0.10.1')
  assert.equal(describeTemplateSelection(selection).headline, `Template: acme/crm-template@${SHA_SOURCE} (not verified)`)
})

test('a listed #ref equal to verified.sha is verified with the verified facts', async () => {
  const { fetchImpl } = mockFetch(indexRoute(), commitRoute('acme/crm-template', 'v1.0.0', SHA_VERIFIED.toUpperCase()))
  const selection = await resolveTemplateSelection(parseTemplateArg('crm#v1.0.0'), { ...DEPS, fetchImpl })
  assert.equal(selection.sha, SHA_VERIFIED)
  assert.equal(selection.verified, true)
  assert.equal(selection.facts?.omVersion, '0.10.0')
})

test('an unlisted public repo is resolved through the default-branch API', async () => {
  const { fetchImpl, requests } = mockFetch(indexRoute(), repoRoute('agency/shop', 'trunk'), commitRoute('agency/shop', 'trunk', SHA_OTHER))
  const selection = await resolveTemplateSelection(parseTemplateArg('agency/shop'), { ...DEPS, fetchImpl })
  assert.equal(selection.listing, 'unlisted')
  assert.equal(selection.ref, 'trunk')
  assert.equal(selection.sha, SHA_OTHER)
  assert.equal(selection.facts, null)
  assert.deepEqual(githubRequests(requests).map((request) => request.url), [`${API}/repos/agency/shop`, `${API}/repos/agency/shop/commits/trunk`])
  assert.deepEqual(describeTemplateSelection(selection), {
    headline: `Template: agency/shop@${SHA_OTHER} (not listed, not verified)`,
    pageUrl: null,
    notices: [],
  })
})

test('an unlisted private repo sends GITHUB_TOKEN to the GitHub API only', async () => {
  process.env.GITHUB_TOKEN = 'ghp_private'
  const { fetchImpl, requests } = mockFetch(indexRoute(), repoRoute('agency/private-app'), commitRoute('agency/private-app', 'main', SHA_OTHER))
  const selection = await resolveTemplateSelection(parseTemplateArg('agency/private-app'), { ...DEPS, fetchImpl })
  assert.equal(selection.sha, SHA_OTHER)
  const github = githubRequests(requests)
  assert.equal(github.length, 2)
  for (const request of github) assert.equal(request.headers.get('authorization'), 'Bearer ghp_private')
  assert.equal(requests[0]?.headers.get('authorization'), null, 'the index request carries no token')
})

test('an unlisted private repo without GITHUB_TOKEN gets the access error with the token hint', async () => {
  const { fetchImpl } = mockFetch(indexRoute(), (url) => (url === `${API}/repos/agency/private-app` ? json({ message: 'Not Found' }, 404) : undefined))
  await assert.rejects(
    resolveTemplateSelection(parseTemplateArg('agency/private-app'), { ...DEPS, fetchImpl }),
    /GitHub repository not found or inaccessible: agency\/private-app\..*set GITHUB_TOKEN/,
  )
})

test('an unlisted #ref is resolved directly, and a ref GitHub does not know is named in the error', async () => {
  const { fetchImpl, requests } = mockFetch(indexRoute(), commitRoute('agency/shop', 'v2', SHA_OTHER))
  const selection = await resolveTemplateSelection(parseTemplateArg('agency/shop#v2'), { ...DEPS, fetchImpl })
  assert.equal(selection.ref, 'v2')
  assert.equal(githubRequests(requests).length, 1, 'no default-branch request with a #ref')

  const missing = mockFetch(
    indexRoute(),
    (url) => (url === `${API}/repos/agency/shop/commits/nope` ? json({ message: 'No commit found for SHA: nope' }, 422) : undefined),
    repoRoute('agency/shop'),
  )
  await assert.rejects(resolveTemplateSelection(parseTemplateArg('agency/shop#nope'), { ...DEPS, fetchImpl: missing.fetchImpl }), /Ref not found: agency\/shop#nope/)
})

test('an unreachable index lets owner/repo continue as catalog status unknown', async () => {
  const { fetchImpl, requests } = mockFetch(indexRoute({}, 503), repoRoute('acme/crm-template'), commitRoute('acme/crm-template', 'main', SHA_OTHER))
  const selection = await resolveTemplateSelection(parseTemplateArg('acme/crm-template'), { ...DEPS, fetchImpl })
  assert.equal(requests.filter((request) => request.url === DEFAULT_TEMPLATES_URL).length, 2, 'one retry after a 5xx')
  assert.equal(selection.listing, 'unknown')
  assert.equal(selection.verified, false, 'no catalog data applies, even for a repo the index would list')
  assert.equal(selection.facts, null)
  assert.deepEqual(describeTemplateSelection(selection), {
    headline: `Template: acme/crm-template@${SHA_OTHER} (catalog status unknown, not verified)`,
    pageUrl: null,
    notices: ['Could not read the template index (HTTP 503). Continuing without catalog data.'],
  })
})

test('an unreachable index fails a slug and suggests owner/repo', async () => {
  const { fetchImpl, requests } = mockFetch(indexRoute({}, 404))
  await assert.rejects(
    resolveTemplateSelection(parseTemplateArg('crm'), { ...DEPS, fetchImpl }),
    /Could not read the template index at https:\/\/modules\.openmercato\.com\/templates\.json \(HTTP 404\).*--template <owner\/repo>/,
  )
  assert.deepEqual(githubRequests(requests), [])
})

test('a slug the index does not have fails with the templates page', async () => {
  const { fetchImpl } = mockFetch(indexRoute())
  await assert.rejects(
    resolveTemplateSelection(parseTemplateArg('marketplace'), { ...DEPS, fetchImpl }),
    /No template with slug "marketplace"\. See https:\/\/modules\.openmercato\.com\/templates/,
  )
})

// Hold policy

test('a hold entry is refused with its reason by the retained slug and by owner/repo, before any GitHub request', async () => {
  for (const value of ['prm', 'open-mercato/ready-app-oss-prm', 'Open-Mercato/ready-app-oss-prm#main']) {
    const { fetchImpl, requests } = mockFetch(indexRoute())
    await assert.rejects(
      resolveTemplateSelection(parseTemplateArg(value), { ...DEPS, fetchImpl }),
      /open-mercato\/ready-app-oss-prm is on hold and cannot be used to create an app\. Reason: The repository has no license yet\./,
      value,
    )
    assert.deepEqual(githubRequests(requests), [], value)
  }
})

test('an entry with a status this CLI does not know is refused like hold', async () => {
  const { fetchImpl } = mockFetch(indexRoute())
  await assert.rejects(
    resolveTemplateSelection(parseTemplateArg('future'), { ...DEPS, fetchImpl }),
    /acme\/future-status a status this create-mercato-app does not know\. Update create-mercato-app/,
  )
})

test('an unmaintained entry works and prints its reason', async () => {
  const { fetchImpl } = mockFetch(indexRoute())
  const selection = await resolveTemplateSelection(parseTemplateArg('old-agency/field-service'), { ...DEPS, fetchImpl })
  assert.equal(selection.sha, '5555555555555555555555555555555555555555')
  assert.deepEqual(describeTemplateSelection(selection).notices, ['This template is unmaintained. Reason: The author no longer updates it.'])
})

test('the page URL follows the origin of an overridden index', async () => {
  const indexUrl = 'http://127.0.0.1:4100/data/templates.json'
  const { fetchImpl } = mockFetch((url) => (url === indexUrl ? json(FIXTURE) : undefined))
  const selection = await resolveTemplateSelection(parseTemplateArg('crm'), { ...DEPS, indexUrl, fetchImpl })
  assert.equal(describeTemplateSelection(selection).pageUrl, 'http://127.0.0.1:4100/t/acme/crm-template')
})

// Download of the selected sha

test('a missing index sha stops and suggests #<ref> with the entry ref, never other code', async () => {
  const { fetchImpl, requests } = mockFetch(
    indexRoute(),
    tarballRoute('acme/crm-template', SHA_VERIFIED, () => json({ message: 'Not Found' }, 404)),
    repoRoute('acme/crm-template'),
  )
  const selection = await resolveTemplateSelection(parseTemplateArg('crm'), { ...DEPS, fetchImpl })
  await assert.rejects(
    downloadSelectedTemplate(selection, { ...DEPS, fetchImpl }),
    new RegExp(`The commit ${SHA_VERIFIED} that the template index lists for acme/crm-template can no longer be downloaded\\..*--template acme/crm-template#main\\. That code is not verified\\.`),
  )
  assert.ok(!requests.some((request) => request.url.includes('/tarball/main')), 'no download of the branch on its own')
})

test('a missing index sha of an entry without ref suggests the default branch', async () => {
  const { fetchImpl } = mockFetch(
    indexRoute(),
    tarballRoute('acme/b2b-portal', SHA_B2B, () => json({ message: 'Not Found' }, 404)),
    repoRoute('acme/b2b-portal', 'develop'),
  )
  const selection = await resolveTemplateSelection(parseTemplateArg('b2b-portal'), { ...DEPS, fetchImpl })
  await assert.rejects(downloadSelectedTemplate(selection, { ...DEPS, fetchImpl }), /--template acme\/b2b-portal#develop\./)
})

test('a missing repo on download gets the access error, and a selected sha downloads by sha', async () => {
  const gone = mockFetch(
    indexRoute(),
    tarballRoute('acme/crm-template', SHA_VERIFIED, () => json({ message: 'Not Found' }, 404)),
    (url) => (url === `${API}/repos/acme/crm-template` ? json({ message: 'Not Found' }, 404) : undefined),
  )
  const selection = await resolveTemplateSelection(parseTemplateArg('crm'), { ...DEPS, fetchImpl: gone.fetchImpl })
  await assert.rejects(downloadSelectedTemplate(selection, { ...DEPS, fetchImpl: gone.fetchImpl }), /GitHub repository not found or inaccessible: acme\/crm-template/)

  const ok = mockFetch(tarballRoute('acme/crm-template', SHA_VERIFIED, () => new Response(new Uint8Array([1, 2, 3]))))
  const archive = await downloadSelectedTemplate(selection, { ...DEPS, fetchImpl: ok.fetchImpl })
  assert.deepEqual(new Uint8Array(readFileSync(archive.path)), new Uint8Array([1, 2, 3]))
  archive.dispose()
})

// CLI flags

test('parseArgs reads --template and --keep-name', () => {
  const parsed = parseArgs(['my-app', '--template', 'acme/crm#v1', '--keep-name'])
  assert.equal(parsed.appName, 'my-app')
  assert.equal(parsed.options.template, 'acme/crm#v1')
  assert.equal(parsed.options.keepName, true)
  assert.equal(parseArgs(['my-app']).options.keepName, false)
  assert.throws(() => parseArgs(['my-app', '--template']), /Option --template requires a value/)
})

test('resolveTemplateFlags accepts the import-safe flags and refuses every exclusion', () => {
  const flags = (argv: string[]) => resolveTemplateFlags(parseArgs(['my-app', ...argv]).options)
  assert.equal(flags([]), null)
  assert.deepEqual(flags(['--template', 'crm', '--preset', 'classic', '--no-module-picker', '--skip-agentic-setup', '--keep-name']), {
    kind: 'slug', slug: 'crm', ref: null, input: 'crm',
  })
  const cases: Array<[string[], RegExp]> = [
    [['--keep-name'], /--keep-name works only with --template/],
    [['--template', 'crm', '--app', 'prm'], /--template, --app and --app-url are mutually exclusive/],
    [['--template', 'crm', '--app-url', 'https://github.com/acme/app'], /--template, --app and --app-url are mutually exclusive/],
    [['--template', 'crm', '--modules', 'x'], /--modules and --module-picker are not supported with --template/],
    [['--template', 'crm', '--module-picker'], /--modules and --module-picker are not supported with --template/],
    [['--template', 'crm', '--preset', 'crm'], /--preset crm cannot be combined with --template/],
    [['--template', 'crm', '--preset', 'empty'], /--preset empty cannot be combined with --template/],
    [['--template', 'crm', '--agents', 'none'], /--agents is not supported with --template/],
    [['--template', 'crm', '--agents', 'codex'], /--agents is not supported with --template/],
    [['--template', 'crm', '--experimental-hooks-validator'], /--experimental-hooks-validator is not supported with --template/],
    [['--template', 'https://github.com/acme/app'], /not a URL/],
  ]
  for (const [argv, pattern] of cases) assert.throws(() => flags(argv), pattern, argv.join(' '))
})

test('shouldOfferModulePicker never offers the default picker with --template', () => {
  const options = parseArgs(['my-app', '--template', 'crm']).options
  assert.equal(shouldOfferModulePicker(options, null, true), false)
  assert.equal(shouldOfferModulePicker({ ...options, modulePicker: false }, null, true), false)
  assert.equal(shouldOfferModulePicker(parseArgs(['my-app']).options, null, true), true, 'unchanged without --template')
})

/** Runs `main` in a fresh directory with a mocked fetch, capturing its output. */
async function runMain(argv: string[], fetchImpl: typeof fetch, cwd = scratchDir()) {
  const output: string[] = []
  const originalCwd = process.cwd()
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  globalThis.fetch = fetchImpl
  console.log = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(' ').replace(/\u001b\[[0-9;]*m/g, ''))
  }
  process.chdir(cwd)
  try {
    await main(argv)
  } finally {
    process.chdir(originalCwd)
    globalThis.fetch = originalFetch
    console.log = originalLog
  }
  return { cwd, output }
}

test('main refuses every exclusion and a bad OM_TEMPLATES_URL before any request or directory', async () => {
  const cases: Array<[string[], RegExp, string?]> = [
    [['--template', 'crm', '--app', 'prm'], /mutually exclusive/],
    [['--template', 'crm', '--app-url', 'https://github.com/acme/app'], /mutually exclusive/],
    [['--template', 'crm', '--modules', 'x'], /--modules and --module-picker are not supported with --template/],
    [['--template', 'crm', '--module-picker'], /--modules and --module-picker are not supported with --template/],
    [['--template', 'crm', '--preset', 'wms'], /--preset wms cannot be combined with --template/],
    [['--template', 'crm', '--agents', 'all'], /--agents is not supported with --template/],
    [['--template', 'crm', '--experimental-hooks-validator'], /--experimental-hooks-validator is not supported with --template/],
    [['--keep-name'], /--keep-name works only with --template/],
    [['--template', 'github.com/acme/app'], /not a URL/],
    [['--template', 'crm'], /OM_TEMPLATES_URL must be an https:\/\//, 'http://example.com/templates.json'],
  ]
  for (const [argv, pattern, templatesUrl] of cases) {
    if (templatesUrl) process.env[TEMPLATES_URL_ENV] = templatesUrl
    const cwd = scratchDir()
    const { fetchImpl, requests } = mockFetch()
    await assert.rejects(runMain(['refused-app', ...argv, '--no-init-git'], fetchImpl, cwd), pattern, argv.join(' '))
    assert.deepEqual(requests, [], argv.join(' '))
    assert.equal(existsSync(join(cwd, 'refused-app')), false, argv.join(' '))
    delete process.env[TEMPLATES_URL_ENV]
  }
})

async function createGitHubStyleTarball(files: Record<string, string>, symlinks: Record<string, string> = {}): Promise<Uint8Array> {
  const dir = scratchDir('om-templates-tarball-')
  const root = join(dir, 'acme-crm-template-2222222')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  for (const [path, target] of Object.entries(symlinks)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    symlinkSync(target, join(root, path))
  }
  const archivePath = join(dir, 'archive.tar.gz')
  await tar.c({ cwd: dir, gzip: true, file: archivePath }, ['acme-crm-template-2222222'])
  return new Uint8Array(readFileSync(archivePath))
}

test('main prints owner/repo@sha and its verification before downloading the selected sha', async () => {
  const archive = await createGitHubStyleTarball({ 'package.json': '{"name":"crm-template"}\n', 'src/modules.ts': 'export {}\n' })
  const { fetchImpl, requests } = mockFetch(indexRoute(), tarballRoute('acme/crm-template', SHA_VERIFIED, () => new Response(archive)))
  const { cwd, output } = await runMain(['crm-app', '--template', 'crm', '--skip-agentic-setup', '--no-init-git'], fetchImpl)
  assert.deepEqual(requests.map((request) => request.url), [DEFAULT_TEMPLATES_URL, `${API}/repos/acme/crm-template/tarball/${SHA_VERIFIED}`])
  const headline = output.indexOf(`Template: acme/crm-template@${SHA_VERIFIED} (verified)`)
  assert.ok(headline >= 0, output.join('\n'))
  assert.equal(output[headline + 1], 'Template page: https://modules.openmercato.com/t/acme/crm-template')
  assert.ok(existsSync(join(cwd, 'crm-app', 'src', 'modules.ts')))
  assert.ok(existsSync(join(cwd, 'crm-app', '.mercato', 'generated', 'module-package-sources.css')))
  assert.ok(output.some((line) => line.includes('yarn initialize')), 'imported app next steps')
  assert.ok(!output.some((line) => line.includes('Agent pipeline')), 'no agentic setup for an app template')
})

test('main refuses a template archive with a symbolic link before creating the target directory', async () => {
  const archive = await createGitHubStyleTarball({ 'package.json': '{"name":"crm-template"}\n' }, { 'src/escape': '/etc' })
  const { fetchImpl } = mockFetch(indexRoute(), tarballRoute('acme/crm-template', SHA_VERIFIED, () => new Response(archive)))
  const cwd = scratchDir()
  await assert.rejects(
    runMain(['crm-app', '--template', 'crm', '--skip-agentic-setup', '--no-init-git'], fetchImpl, cwd),
    /Archive rejected: "acme-crm-template-2222222\/src\/escape" is a symbolic link\./,
  )
  assert.equal(existsSync(join(cwd, 'crm-app')), false)
})

test('main removes the target directory it created when a template import fails after extraction', async () => {
  const archive = await createGitHubStyleTarball({ 'package.json': '{"name":"crm-template"}\n', 'src/page.tsx.template': '' })
  const { fetchImpl } = mockFetch(indexRoute(), tarballRoute('acme/crm-template', SHA_VERIFIED, () => new Response(archive)))
  const cwd = scratchDir()
  await assert.rejects(
    runMain(['crm-app', '--template', 'crm', '--skip-agentic-setup', '--no-init-git'], fetchImpl, cwd),
    /must be committed source snapshots\. Found \.template files: src\/page\.tsx\.template/,
  )
  assert.equal(existsSync(join(cwd, 'crm-app')), false)
})

test('main refuses a hold slug without creating the target directory', async () => {
  const { fetchImpl, requests } = mockFetch(indexRoute())
  const cwd = scratchDir()
  await assert.rejects(
    runMain(['prm-app', '--template', 'prm', '--no-init-git'], fetchImpl, cwd),
    /on hold.*Reason: The repository has no license yet\./,
  )
  assert.deepEqual(requests.map((request) => request.url), [DEFAULT_TEMPLATES_URL])
  assert.equal(existsSync(join(cwd, 'prm-app')), false)
})
