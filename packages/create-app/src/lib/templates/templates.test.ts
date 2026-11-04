import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
import { NPM_CORE_DIST_TAGS_URL, compatibilityNotice, lineOf } from './compat.js'
import { finalizeTemplateApp, printTemplateImportNextSteps, readTemplateManifest } from './finalize.js'
import { scaffoldFromTemplate } from './template-step.js'
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

test('help documents --template and --keep-name with two examples and no --app prm example', async () => {
  const noFetch = (async () => {
    throw new Error('help must not fetch')
  }) as typeof fetch
  const { cwd, output } = await runMain(['--help'], noFetch)
  const help = output.join('\n')
  assert.match(help, /^ {2}--template <slug \| owner\/repo>\[#ref\]$/m)
  assert.match(help, /https:\/\/modules\.openmercato\.com\/templates/)
  assert.match(help, /^ {2}--keep-name +With --template, keep the template's package\.json name$/m)
  assert.match(help, /^ {2}npx create-mercato-app my-crm --template crm$/m)
  assert.match(help, /^ {2}npx create-mercato-app my-portal --template some-agency\/b2b-portal#v1\.0\.0$/m)
  assert.match(help, /^ {2}--app <name> /m, '--app stays documented')
  assert.doesNotMatch(help, /--app prm/)
  assert.deepEqual(readdirSync(cwd), [])
})

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
  assert.deepEqual(requests.map((request) => request.url), [
    DEFAULT_TEMPLATES_URL,
    NPM_CORE_DIST_TAGS_URL,
    `${API}/repos/acme/crm-template/tarball/${SHA_VERIFIED}`,
  ])
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

// Compatibility and Enterprise notices

const SHA_UNLISTED = 'abcdef0123456789abcdef0123456789abcdef01'
const stripAnsi = (line: string) => line.replace(/\u001b\[[0-9;]*m/g, '')
const npmRoute = (latest: string): Route => (url) =>
  url === NPM_CORE_DIST_TAGS_URL ? json({ latest, canary: '0.99.0-canary.1' }) : undefined
const npmDown: Route = (url) => {
  if (url === NPM_CORE_DIST_TAGS_URL) throw new TypeError('fetch failed')
  return undefined
}
const lockfile = (core: string, extra = '') => [
  '# This file is generated by running "yarn install" inside your project.',
  '__metadata:',
  '  version: 8',
  '',
  `"@open-mercato/core@npm:^${core}, @open-mercato/core@npm:${core}":`,
  `  version: ${core}`,
  `  resolution: "@open-mercato/core@npm:${core}"`,
  '  languageName: node',
  extra,
].join('\n')
const ENTERPRISE_LOCK = [
  '"@open-mercato/enterprise@npm:0.10.1":',
  '  version: 0.10.1',
  '  resolution: "@open-mercato/enterprise@npm:0.10.1"',
].join('\n')
const appPackageJson = (core = '0.10.0', extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ name: 'crm-template', private: true, ...extra, dependencies: { '@open-mercato/core': core } }, null, 2)}\n`

/** Runs the template step for one `--template` value against a mocked index, GitHub and npm. */
async function runTemplateStep(
  value: string,
  files: Record<string, string>,
  routes: Route[],
  options: { keepName?: boolean; appName?: string } = {},
) {
  const archive = await createGitHubStyleTarball(files)
  const appName = options.appName ?? 'my-app'
  const targetDir = join(scratchDir(), appName)
  const logs: string[] = []
  const warnings: string[] = []
  const tarballs: Route = (url) => (url.includes('/tarball/') ? new Response(archive) : undefined)
  const { fetchImpl, requests } = mockFetch(indexRoute(), ...routes, tarballs)
  const result = await scaffoldFromTemplate(
    targetDir,
    parseTemplateArg(value),
    { appName, keepName: options.keepName ?? false, indexUrl: DEFAULT_TEMPLATES_URL, packageVersion: '0.10.0' },
    { fetchImpl, timeoutMs: 50, log: (line) => logs.push(stripAnsi(line)), warn: (line) => warnings.push(stripAnsi(line)) },
  )
  return { targetDir, result, logs, warnings, requests }
}

test('lineOf reads major.minor from versions and simple ranges', () => {
  assert.equal(lineOf('0.10.1'), '0.10')
  assert.equal(lineOf('^0.9.4'), '0.9')
  assert.equal(lineOf('~0.9.4'), '0.9')
  assert.equal(lineOf('>=0.9.0 <0.11.0'), '0.9')
  assert.equal(lineOf('0.10.x'), '0.10')
  assert.equal(lineOf('v1.2'), '1.2')
  assert.equal(lineOf('0.11.0-canary.12.abc'), '0.11')
  assert.equal(lineOf('0.x'), null)
  assert.equal(lineOf('workspace:*'), null)
  assert.equal(lineOf('latest'), null)
})

test('a template on the latest stable line prints no compatibility warning', async () => {
  const { warnings, requests } = await runTemplateStep('crm', { 'package.json': appPackageJson(), 'yarn.lock': lockfile('0.10.0') }, [npmRoute('0.10.3')])
  assert.deepEqual(warnings, [])
  assert.equal(requests.filter((request) => request.url === NPM_CORE_DIST_TAGS_URL).length, 1, 'npm is read once, without a retry')
  assert.equal(requests.find((request) => request.url === NPM_CORE_DIST_TAGS_URL)?.headers.get('authorization'), null)
})

test('catalog facts win over the downloaded lockfile when they apply to the selected sha', async () => {
  const files = { 'package.json': appPackageJson('0.8.2'), 'yarn.lock': lockfile('0.8.2', ENTERPRISE_LOCK) }
  const current = await runTemplateStep('crm', files, [npmRoute('0.10.0')])
  assert.deepEqual(current.warnings, [], 'the verified facts say 0.10, the lockfile is not read, and their requiresEnterprise is false')

  const newer = await runTemplateStep('crm', files, [npmRoute('0.11.0')])
  assert.deepEqual(newer.warnings, ['Built on Open Mercato 0.10 (from the catalog facts for this commit); the latest stable line is 0.11.'])
})

test('an unlisted repo one line behind takes its line from the lockfile and prints not listed, not verified', async () => {
  const { logs, warnings } = await runTemplateStep(
    'agency/shop',
    { 'package.json': appPackageJson('^0.9.0'), 'yarn.lock': lockfile('0.9.4') },
    [npmRoute('0.10.1'), repoRoute('agency/shop', 'trunk'), commitRoute('agency/shop', 'trunk', SHA_UNLISTED)],
  )
  assert.ok(logs.includes(`Template: agency/shop@${SHA_UNLISTED} (not listed, not verified)`), logs.join('\n'))
  assert.deepEqual(warnings, ['Built on Open Mercato 0.9 (from yarn.lock); the latest stable line is 0.10.'])
})

test('a listed #ref to a sha without catalog facts takes its line from the lockfile', async () => {
  const { logs, warnings } = await runTemplateStep(
    'crm#feature/x',
    { 'package.json': appPackageJson(), 'yarn.lock': lockfile('0.9.1') },
    [npmRoute('0.10.0'), commitRoute('acme/crm-template', 'feature/x', SHA_OTHER)],
  )
  assert.ok(logs.includes(`Template: acme/crm-template@${SHA_OTHER} (not verified, no catalog facts for ${SHA_OTHER})`))
  assert.deepEqual(warnings, ['Built on Open Mercato 0.9 (from yarn.lock); the latest stable line is 0.10.'])
})

test('without yarn.lock the line comes from package.json, then from the manifest', async () => {
  const routes = [npmRoute('0.10.0'), repoRoute('agency/shop'), commitRoute('agency/shop', 'main', SHA_UNLISTED)]
  const fromPackage = await runTemplateStep('agency/shop', { 'package.json': appPackageJson('^0.9.2') }, routes)
  assert.deepEqual(fromPackage.warnings, ['Built on Open Mercato 0.9 (from package.json); the latest stable line is 0.10.'])

  const fromManifest = await runTemplateStep('agency/shop', {
    'package.json': '{"name":"shop"}\n',
    'mercato-template.json': JSON.stringify({ schema: 1, openMercato: '0.8.x' }),
  }, routes)
  assert.deepEqual(fromManifest.warnings, ['Built on Open Mercato 0.8 (from mercato-template.json); the latest stable line is 0.10.'])

  const unknown = await runTemplateStep('agency/shop', { 'package.json': '{"name":"shop"}\n' }, routes)
  assert.deepEqual(unknown.warnings, [
    'Could not check the Open Mercato line of this template. No @open-mercato/core version was found in yarn.lock, package.json or mercato-template.json.',
  ])
})

test('with npm unreachable, catalog linesBehind decides; without catalog facts the line cannot be checked', async () => {
  const listed = await runTemplateStep('b2b-portal', { 'package.json': appPackageJson('0.9.4') }, [npmDown, repoRoute('acme/b2b-portal', 'develop')])
  assert.deepEqual(listed.warnings, [
    'Built on Open Mercato 0.9, 1 line behind the latest stable line.',
    'This template depends on @open-mercato/enterprise, which needs an Open Mercato Enterprise license.',
  ])

  const current = await runTemplateStep('crm', { 'package.json': appPackageJson() }, [npmDown])
  assert.deepEqual(current.warnings, [], 'linesBehind 0 in the facts needs no warning')

  const unlisted = await runTemplateStep(
    'agency/shop',
    { 'package.json': appPackageJson(), 'yarn.lock': lockfile('0.9.4') },
    [npmDown, repoRoute('agency/shop'), commitRoute('agency/shop', 'main', SHA_UNLISTED)],
  )
  assert.deepEqual(unlisted.warnings, [
    'Could not check the Open Mercato line of this template. It is built on 0.9 (from yarn.lock), and the latest stable line could not be read from npm.',
  ])
})

test('the Enterprise notice comes from the catalog facts, else from the lockfile or package.json', async () => {
  const routes = [npmRoute('0.10.0'), repoRoute('agency/shop'), commitRoute('agency/shop', 'main', SHA_UNLISTED)]
  const notice = 'This template depends on @open-mercato/enterprise, which needs an Open Mercato Enterprise license.'
  const fromLock = await runTemplateStep('agency/shop', { 'package.json': appPackageJson(), 'yarn.lock': lockfile('0.10.0', ENTERPRISE_LOCK) }, routes)
  assert.deepEqual(fromLock.warnings, [notice])

  const lockWithout = await runTemplateStep('agency/shop', {
    'package.json': appPackageJson('0.10.0', { devDependencies: { '@open-mercato/enterprise': '0.10.0' } }),
    'yarn.lock': lockfile('0.10.0'),
  }, routes)
  assert.deepEqual(lockWithout.warnings, [], 'yarn.lock decides when it exists')

  const fromPackage = await runTemplateStep('agency/shop', {
    'package.json': appPackageJson('0.10.0', { devDependencies: { '@open-mercato/enterprise': '0.10.0' } }),
  }, routes)
  assert.deepEqual(fromPackage.warnings, [notice])

  const fromFacts = await runTemplateStep('b2b-portal', { 'package.json': appPackageJson('0.10.0') }, [npmRoute('0.9.0'), repoRoute('acme/b2b-portal')])
  assert.deepEqual(fromFacts.warnings, [notice])
})

test('compatibilityNotice compares lines and names the source', () => {
  assert.equal(compatibilityNotice({ pinned: { line: '0.10', source: 'yarn.lock' }, latestLine: '0.10', linesBehind: null }), null)
  assert.equal(
    compatibilityNotice({ pinned: { line: '0.11', source: 'package.json' }, latestLine: '0.10', linesBehind: null }),
    'Built on Open Mercato 0.11 (from package.json); the latest stable line is 0.10.',
  )
  assert.equal(
    compatibilityNotice({ pinned: { line: '0.8', source: 'catalog' }, latestLine: null, linesBehind: 2 }),
    'Built on Open Mercato 0.8, 2 lines behind the latest stable line.',
  )
  assert.match(
    compatibilityNotice({ pinned: { line: '0.8', source: 'catalog' }, latestLine: null, linesBehind: null }) ?? '',
    /^Could not check the Open Mercato line of this template\. It is built on 0\.8 \(from the catalog facts for this commit\)/,
  )
})

// Finalizing: manifest removal, name rewrite, provenance

test('finalizing rewrites the name, adds provenance as the last key and removes the manifest', async () => {
  const packageJson = `${JSON.stringify({ name: 'crm-template', version: '1.2.0', private: true, scripts: { dev: 'mercato dev' }, dependencies: { '@open-mercato/core': '0.10.0' } }, null, 4)}\n`
  const manifest = {
    schema: 1,
    name: 'crm-template',
    openMercato: '0.10.x',
    env: [{ name: 'OPENAI_API_KEY', description: 'Used by the AI assistant.', link: 'https://platform.openai.com/api-keys' }],
    modules: [{ id: 'customers', from: '@open-mercato/core' }],
    createdWith: { tool: 'create-mercato-template', version: '0.1.0' },
  }
  const { targetDir, result } = await runTemplateStep('crm', {
    'package.json': packageJson,
    'mercato-template.json': JSON.stringify(manifest, null, 2),
    '.env.example': 'DATABASE_URL=\nOPENAI_API_KEY=\n',
    'src/modules.ts': 'export {}\n',
  }, [npmRoute('0.10.0')], { appName: 'my-crm' })

  const raw = readFileSync(join(targetDir, 'package.json'), 'utf8')
  const pkg = JSON.parse(raw)
  assert.deepEqual(Object.keys(pkg), ['name', 'version', 'private', 'scripts', 'dependencies', 'openMercatoTemplate'])
  assert.equal(pkg.name, 'my-crm')
  assert.deepEqual(pkg.openMercatoTemplate, { repo: 'acme/crm-template', ref: 'main', sha: SHA_VERIFIED })
  assert.ok(raw.startsWith('{\n    "name": "my-crm",\n'), 'four-space indentation kept')
  assert.ok(raw.endsWith('}\n'), 'trailing newline kept')
  assert.equal(existsSync(join(targetDir, 'mercato-template.json')), false)
  assert.equal(readFileSync(join(targetDir, 'src', 'modules.ts'), 'utf8'), 'export {}\n', 'other files untouched')
  assert.ok(existsSync(join(targetDir, '.mercato', 'generated', 'module-package-sources.css')))
  assert.deepEqual(result, {
    appName: 'my-crm',
    hasEnvExample: true,
    envKeys: [{ name: 'OPENAI_API_KEY', description: 'Used by the AI assistant.', link: 'https://platform.openai.com/api-keys' }],
    provenance: { repo: 'acme/crm-template', ref: 'main', sha: SHA_VERIFIED },
  })
})

test('--keep-name keeps the template package name and still records provenance', async () => {
  const { targetDir } = await runTemplateStep('crm', { 'package.json': appPackageJson() }, [npmRoute('0.10.0')], { keepName: true })
  const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'crm-template')
  assert.equal(pkg.openMercatoTemplate.sha, SHA_VERIFIED)
})

test('provenance records #ref, the entry ref or the resolved default branch, and the repo as listed or typed', async () => {
  const provenanceOf = (targetDir: string) => JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).openMercatoTemplate
  const files = { 'package.json': appPackageJson() }

  const withRef = await runTemplateStep('Acme/CRM-Template#v1.0.0', files, [npmRoute('0.10.0'), commitRoute('acme/crm-template', 'v1.0.0', SHA_VERIFIED)])
  assert.deepEqual(provenanceOf(withRef.targetDir), { repo: 'acme/crm-template', ref: 'v1.0.0', sha: SHA_VERIFIED })

  const noEntryRef = await runTemplateStep('b2b-portal', files, [npmRoute('0.10.0'), repoRoute('acme/b2b-portal', 'develop')])
  assert.deepEqual(provenanceOf(noEntryRef.targetDir), { repo: 'acme/b2b-portal', ref: 'develop', sha: SHA_B2B })

  const unlisted = await runTemplateStep('Agency/Shop', files, [npmRoute('0.10.0'), repoRoute('Agency/Shop', 'trunk'), commitRoute('Agency/Shop', 'trunk', SHA_UNLISTED)])
  assert.deepEqual(provenanceOf(unlisted.targetDir), { repo: 'Agency/Shop', ref: 'trunk', sha: SHA_UNLISTED })

  const branchUnreadable = await runTemplateStep('b2b-portal', files, [npmRoute('0.10.0'), (url) => (url === `${API}/repos/acme/b2b-portal` ? json({}, 500) : undefined)])
  assert.deepEqual(provenanceOf(branchUnreadable.targetDir), { repo: 'acme/b2b-portal', ref: SHA_B2B, sha: SHA_B2B }, 'the sha stands in for an unreadable default branch')
})

test('finalizeTemplateApp keeps tabs, CRLF, a missing trailing newline and a BOM, and replaces inherited provenance', () => {
  const dir = scratchDir()
  const raw = '﻿{\r\n\t"private": true,\r\n\t"openMercatoTemplate": {\r\n\t\t"repo": "first/template",\r\n\t\t"ref": "main",\r\n\t\t"sha": "x"\r\n\t},\r\n\t"scripts": {}\r\n}'
  writeFileSync(join(dir, 'package.json'), raw)
  const result = finalizeTemplateApp(dir, { appName: 'my-app', keepName: false, provenance: { repo: 'acme/app', ref: 'main', sha: SHA_SOURCE } })
  assert.deepEqual(result, { manifest: { status: 'absent' }, notices: [] })
  const written = readFileSync(join(dir, 'package.json'), 'utf8')
  assert.equal(
    written,
    `﻿{\r\n\t"name": "my-app",\r\n\t"private": true,\r\n\t"scripts": {},\r\n\t"openMercatoTemplate": {\r\n\t\t"repo": "acme/app",\r\n\t\t"ref": "main",\r\n\t\t"sha": "${SHA_SOURCE}"\r\n\t}\r\n}`,
  )
})

test('finalizeTemplateApp fails on a missing or broken package.json', () => {
  const options = { appName: 'my-app', keepName: false, provenance: { repo: 'acme/app', ref: 'main', sha: SHA_SOURCE } }
  const missing = scratchDir()
  assert.throws(() => finalizeTemplateApp(missing, options), /has no package\.json at its root/)
  const broken = scratchDir()
  writeFileSync(join(broken, 'package.json'), '{"name": ')
  assert.throws(() => finalizeTemplateApp(broken, options), /package\.json of the app template is not valid JSON/)
  const array = scratchDir()
  writeFileSync(join(array, 'package.json'), '[]')
  assert.throws(() => finalizeTemplateApp(array, options), /not a JSON object/)
})

test('a broken, schema 2 or oversized manifest is removed unread with a notice', () => {
  const options = { appName: 'my-app', keepName: false, provenance: { repo: 'acme/app', ref: 'main', sha: SHA_SOURCE } }
  const cases: Array<[string, string]> = [
    ['{"schema": 1, "env": [', 'it is not valid JSON'],
    [JSON.stringify({ schema: 2, env: [{ name: 'SECRET_KEY', description: 'x' }] }), 'its schema (2) is not 1'],
    [JSON.stringify({ env: [] }), 'its schema (missing) is not 1'],
    [JSON.stringify({ schema: 1, padding: 'x'.repeat(256 * 1024) }), 'it is larger than 256 KiB'],
  ]
  for (const [content, reason] of cases) {
    const dir = scratchDir()
    writeFileSync(join(dir, 'package.json'), '{"name":"t"}\n')
    writeFileSync(join(dir, 'mercato-template.json'), content)
    const result = finalizeTemplateApp(dir, options)
    assert.deepEqual(result.manifest, { status: 'invalid', reason }, reason)
    assert.deepEqual(result.notices, [`mercato-template.json was not read because ${reason}. It was removed, so no declared env keys are shown.`])
    assert.equal(existsSync(join(dir, 'mercato-template.json')), false, reason)
  }
})

test('readTemplateManifest keeps valid env keys once, cleans control characters and ignores unknown fields', () => {
  const dir = scratchDir()
  writeFileSync(join(dir, 'mercato-template.json'), JSON.stringify({
    schema: 1,
    openMercato: '0.10.x',
    future: { anything: true },
    env: [
      { name: 'OPENAI_API_KEY', description: 'Used by\u001b[2J the AI assistant.' },
      { name: 'OPENAI_API_KEY', description: 'duplicate' },
      { name: 'not valid', description: 'spaces' },
      { name: '', description: 'empty' },
      { description: 'no name' },
      'STRING_ONLY',
      { name: 'STRIPE_KEY', description: 'Stripe.', link: 'https://dashboard.stripe.com' },
    ],
  }))
  assert.deepEqual(readTemplateManifest(dir), {
    status: 'ok',
    openMercato: '0.10.x',
    env: [
      { name: 'OPENAI_API_KEY', description: 'Used by [2J the AI assistant.' },
      { name: 'STRIPE_KEY', description: 'Stripe.', link: 'https://dashboard.stripe.com' },
    ],
  })
  assert.equal(existsSync(join(dir, 'mercato-template.json')), true, 'reading does not remove the file')
})

// Next steps

test('next steps print cp .env.example .env and the declared env keys only when present', () => {
  const provenance = { repo: 'acme/crm-template', ref: 'main', sha: SHA_VERIFIED }
  const lines: string[] = []
  printTemplateImportNextSteps({
    appName: 'my-app',
    hasEnvExample: true,
    envKeys: [
      { name: 'OPENAI_API_KEY', description: 'Used by the AI assistant.', link: 'https://platform.openai.com/api-keys' },
      { name: 'S3_BUCKET', description: 'Bucket for uploads.', link: 'javascript:alert(1)' },
    ],
    provenance,
  }, (line) => lines.push(stripAnsi(line)))
  assert.deepEqual(lines, [
    'Next steps:',
    '',
    '  cd my-app',
    '  cp .env.example .env',
    '  # Fill in the keys this template declares:',
    '  #   OPENAI_API_KEY  Used by the AI assistant.  https://platform.openai.com/api-keys',
    '  #   S3_BUCKET       Bucket for uploads.',
    '  yarn install',
    '  yarn initialize',
    '  yarn dev',
    '',
    `Created from the app template acme/crm-template@${SHA_VERIFIED} (recorded in package.json "openMercatoTemplate").`,
    'If you want agentic tooling in the app later, run `yarn mercato agentic:init` inside it.',
    '',
  ])

  const bare: string[] = []
  printTemplateImportNextSteps({ appName: 'my-app', hasEnvExample: false, envKeys: [], provenance }, (line) => bare.push(stripAnsi(line)))
  assert.ok(!bare.some((line) => line.includes('cp .env.example') || line.includes('Fill in')), bare.join('\n'))
  assert.deepEqual(bare.slice(0, 4), ['Next steps:', '', '  cd my-app', '  yarn install'])
})

// Cleanup and flags in main

test('main removes the target directory when finalizing fails', async () => {
  for (const [files, pattern] of [
    [{ 'README.md': '# no package.json\n' }, /has no package\.json at its root/],
    [{ 'package.json': '{"name": ' }, /package\.json of the app template is not valid JSON/],
  ] as const) {
    const archive = await createGitHubStyleTarball(files)
    const { fetchImpl } = mockFetch(indexRoute(), npmRoute('0.10.0'), tarballRoute('acme/crm-template', SHA_VERIFIED, () => new Response(archive)))
    const cwd = scratchDir()
    await assert.rejects(runMain(['crm-app', '--template', 'crm', '--no-init-git'], fetchImpl, cwd), pattern)
    assert.deepEqual(readdirSync(cwd), [], 'the target directory is removed')
  }
})

test('main never touches an existing target directory', async () => {
  const cwd = scratchDir()
  mkdirSync(join(cwd, 'crm-app'))
  writeFileSync(join(cwd, 'crm-app', 'keep.txt'), 'mine')
  const { fetchImpl, requests } = mockFetch(indexRoute())
  await assert.rejects(runMain(['crm-app', '--template', 'crm', '--no-init-git'], fetchImpl, cwd), /Directory "crm-app" already exists/)
  assert.deepEqual(requests, [])
  assert.equal(readFileSync(join(cwd, 'crm-app', 'keep.txt'), 'utf8'), 'mine')
})

test('main warns that --registry and --verdaccio do not apply to an app template, and not for --app-url', async () => {
  const yarnrc = 'nodeLinker: node-modules\nnpmScopes:\n  open-mercato:\n    npmRegistryServer: "https://registry.npmjs.org"\n'
  const archive = await createGitHubStyleTarball({ 'package.json': appPackageJson(), '.yarnrc.yml': yarnrc })
  const warning = '--registry and --verdaccio do not apply to app templates. The app keeps the registry settings of its own .yarnrc.yml.'

  for (const flags of [['--registry', 'http://localhost:4873'], ['--verdaccio']]) {
    const { fetchImpl } = mockFetch(indexRoute(), npmRoute('0.10.0'), tarballRoute('acme/crm-template', SHA_VERIFIED, () => new Response(archive)))
    const { cwd, output } = await runMain(['crm-app', '--template', 'crm', ...flags, '--no-init-git'], fetchImpl)
    assert.ok(output.includes(warning), flags.join(' '))
    assert.equal(readFileSync(join(cwd, 'crm-app', '.yarnrc.yml'), 'utf8'), yarnrc, 'the snapshot keeps its registry')
  }

  const { fetchImpl } = mockFetch(repoRoute('agency/shop'), tarballRoute('agency/shop', 'main', () => new Response(archive)))
  const { output } = await runMain(['shop-app', '--app-url', 'https://github.com/agency/shop', '--registry', 'http://localhost:4873', '--no-init-git'], fetchImpl)
  assert.ok(!output.includes(warning), 'no warning for --app-url')
  assert.ok(output.some((line) => line.includes('Imported ready apps are copied as raw source snapshots.')), '--app-url next steps unchanged')
})

test('main prints the template next steps with the declared env keys after a successful import', async () => {
  const archive = await createGitHubStyleTarball({
    'package.json': appPackageJson(),
    '.env.example': 'OPENAI_API_KEY=\n',
    'mercato-template.json': JSON.stringify({ schema: 1, env: [{ name: 'OPENAI_API_KEY', description: 'Used by the AI assistant.' }] }),
  })
  const { fetchImpl } = mockFetch(indexRoute(), npmRoute('0.10.0'), tarballRoute('acme/crm-template', SHA_VERIFIED, () => new Response(archive)))
  const { output } = await runMain(['crm-app', '--template', 'crm', '--no-init-git'], fetchImpl)
  const start = output.indexOf('Next steps:')
  assert.deepEqual(output.slice(start, start + 9), [
    'Next steps:',
    '',
    '  cd crm-app',
    '  cp .env.example .env',
    '  # Fill in the keys this template declares:',
    '  #   OPENAI_API_KEY  Used by the AI assistant.',
    '  yarn install',
    '  yarn initialize',
    '  yarn dev',
  ])
  assert.ok(!output.some((line) => line.includes('Imported ready apps are copied as raw source snapshots.')))
})

// End to end

test('the CLI creates an app from a template end to end with a mocked fetch', async () => {
  const archive = await createGitHubStyleTarball({
    'package.json': appPackageJson('0.9.4'),
    'yarn.lock': lockfile('0.9.4'),
    '.env.example': 'DATABASE_URL=\n',
    'mercato-template.json': JSON.stringify({ schema: 1, env: [{ name: 'OPENAI_API_KEY', description: 'Used by the AI assistant.' }] }),
    'src/modules.ts': 'export const enabledModules = []\n',
  })
  const root = scratchDir('om-templates-cli-')
  const mockPath = join(root, 'mock-fetch.mjs')
  writeFileSync(mockPath, `
const index = ${JSON.stringify(JSON.stringify(FIXTURE))}
const archive = Uint8Array.from(Buffer.from('${Buffer.from(archive).toString('base64')}', 'base64'))
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (input) => {
  const url = String(input)
  if (url === ${JSON.stringify(DEFAULT_TEMPLATES_URL)}) return new Response(index, { status: 200 })
  if (url === ${JSON.stringify(NPM_CORE_DIST_TAGS_URL)}) return json({ latest: '0.10.2' })
  if (url === ${JSON.stringify(`${API}/repos/acme/crm-template/tarball/${SHA_VERIFIED}`)}) return new Response(archive)
  return json({ message: 'Not Found' }, 404)
}
`)
  const packageRoot = join(__dirname, '..', '..', '..')
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--import', pathToFileURL(mockPath).href, join(packageRoot, 'src', 'index.ts'), join(root, 'my-crm'), '--template', 'crm', '--no-init-git'],
    { cwd: packageRoot, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '', OM_TEMPLATES_URL: '', OM_CREATE_APP_GITHUB_API_BASE_URL: '' } },
  )
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  const stdout = stripAnsi(result.stdout)
  assert.match(stdout, new RegExp(`Template: acme/crm-template@${SHA_VERIFIED} \\(verified\\)`))
  assert.doesNotMatch(stdout, /Built on Open Mercato|Could not check/, 'the verified facts (0.10) apply, not the 0.9 lockfile')
  assert.match(stdout, /Success! Created my-crm/)
  assert.match(stdout, /#   OPENAI_API_KEY {2}Used by the AI assistant\./)
  const appDir = join(root, 'my-crm')
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'my-crm')
  assert.deepEqual(pkg.openMercatoTemplate, { repo: 'acme/crm-template', ref: 'main', sha: SHA_VERIFIED })
  assert.equal(existsSync(join(appDir, 'mercato-template.json')), false)
  assert.equal(readFileSync(join(appDir, 'src', 'modules.ts'), 'utf8'), 'export const enabledModules = []\n')
  assert.equal(existsSync(join(appDir, 'AGENTS.md')), false, 'no agentic setup')
})
