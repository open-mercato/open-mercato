import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, beforeEach } from 'node:test'
import {
  downloadRepositoryTarball,
  resolveGitHubCommitSha,
  resolveGitHubDefaultBranch,
  type GitHubDeadlines,
} from './ready-apps.js'
import { downloadSelectedTemplate, selectTemplateSha } from './templates/resolve-template.js'

const API = 'https://api.github.com'
const SHA = 'a'.repeat(40)
const FAST: GitHubDeadlines = { requestTimeoutMs: 50, archiveIdleTimeoutMs: 50, archiveTimeoutMs: 2000 }

const scratchDirs: string[] = []
const scratchDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'om-github-deadlines-'))
  scratchDirs.push(dir)
  return dir
}

const savedApiBase = process.env.OM_CREATE_APP_GITHUB_API_BASE_URL
beforeEach(() => {
  delete process.env.OM_CREATE_APP_GITHUB_API_BASE_URL
})
after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
  if (savedApiBase === undefined) delete process.env.OM_CREATE_APP_GITHUB_API_BASE_URL
  else process.env.OM_CREATE_APP_GITHUB_API_BASE_URL = savedApiBase
})

/** A fetch that ignores its abort signal, as a custom implementation may, and records the signals it was given. */
function fetchAnswering(answer: (url: string) => Promise<Response>) {
  const signals: AbortSignal[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal)
    return answer(String(input))
  }) as typeof fetch
  return { fetchImpl, signals }
}

const never = <T>() => new Promise<T>(() => undefined)

/** A body that sends `chunks` chunks, one every `intervalMs`, then stalls for good; `canceled` tells whether it was stopped. */
function stallingBody(chunks: number, intervalMs = 0) {
  const state = { sent: 0, canceled: false }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (state.sent === chunks) return never<void>()
      if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs))
      state.sent += 1
      controller.enqueue(new Uint8Array(100).fill(7))
    },
    cancel() {
      state.canceled = true
    },
  })
  return { stream, state }
}

async function withTempRoot(run: (tempRoot: string) => Promise<void>): Promise<void> {
  const savedTmp = process.env.TMPDIR
  const tempRoot = scratchDir()
  process.env.TMPDIR = tempRoot
  try {
    await run(tempRoot)
  } finally {
    if (savedTmp === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = savedTmp
  }
}

const timedOut = (action: string) => new RegExp(`^Error: GitHub did not answer in time while ${action} acme/app\\. Check network access and retry\\.$`)

test('ref resolution stops when the headers stall, and aborts the request', async () => {
  const { fetchImpl, signals } = fetchAnswering(() => never())
  await assert.rejects(resolveGitHubCommitSha('acme', 'app', 'main', '0.10.0', fetchImpl, FAST), timedOut('resolving a ref of'))
  assert.equal(signals.length, 1)
  assert.equal(signals[0].aborted, true, 'the fetch signal is aborted at the deadline')

  await assert.rejects(resolveGitHubDefaultBranch('acme', 'app', '0.10.0', fetchImpl, FAST), timedOut('inspecting'))
})

test('ref resolution stops when the JSON body stalls after the headers arrived', async () => {
  const commit = fetchAnswering(async () => new Response(stallingBody(0).stream, { status: 200 }))
  await assert.rejects(resolveGitHubCommitSha('acme', 'app', 'main', '0.10.0', commit.fetchImpl, FAST), timedOut('resolving a ref of'))

  const repo = fetchAnswering(async () => new Response(stallingBody(0).stream, { status: 200 }))
  await assert.rejects(resolveGitHubDefaultBranch('acme', 'app', '0.10.0', repo.fetchImpl, FAST), timedOut('inspecting'))

  const errorBody = fetchAnswering(async () => new Response(stallingBody(0).stream, { status: 500 }))
  await assert.rejects(resolveGitHubCommitSha('acme', 'app', 'main', '0.10.0', errorBody.fetchImpl, FAST), timedOut('resolving a ref of'))
})

test('the deadline is per request: the 404 follow-up gets its own and answers in time', async () => {
  const { fetchImpl } = fetchAnswering(async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    if (url === `${API}/repos/acme/app`) return new Response(JSON.stringify({ default_branch: 'main' }))
    return new Response('{}', { status: 422 })
  })
  await assert.rejects(
    resolveGitHubCommitSha('acme', 'app', 'gone', '0.10.0', fetchImpl, FAST),
    /^Error: Ref not found: acme\/app#gone\./,
  )
})

test('a tarball whose headers stall stops at the request deadline', async () => {
  const { fetchImpl, signals } = fetchAnswering(() => never())
  await assert.rejects(downloadRepositoryTarball('acme', 'app', SHA, '0.10.0', fetchImpl, FAST), timedOut('downloading tarball for'))
  assert.equal(signals[0].aborted, true)
})

test('a tarball stream that stalls is canceled and leaves no partial file', async () => {
  await withTempRoot(async (tempRoot) => {
    const { stream, state } = stallingBody(3)
    const { fetchImpl } = fetchAnswering(async () => new Response(stream, { status: 200 }))
    await assert.rejects(downloadRepositoryTarball('acme', 'app', SHA, '0.10.0', fetchImpl, FAST), timedOut('downloading tarball for'))
    assert.equal(state.sent, 3, 'the bytes before the stall were read')
    assert.equal(state.canceled, true, 'the network body is canceled')
    assert.deepEqual(readdirSync(tempRoot), [], 'the partial download is removed')
  })
})

test('a tarball that keeps trickling is stopped by the whole-download deadline', async () => {
  await withTempRoot(async (tempRoot) => {
    const { stream, state } = stallingBody(1000, 10)
    const { fetchImpl } = fetchAnswering(async () => new Response(stream, { status: 200 }))
    await assert.rejects(
      downloadRepositoryTarball('acme', 'app', SHA, '0.10.0', fetchImpl, { requestTimeoutMs: 1000, archiveIdleTimeoutMs: 1000, archiveTimeoutMs: 150 }),
      timedOut('downloading tarball for'),
    )
    assert.ok(state.sent > 1 && state.sent < 1000, `stopped after ${state.sent} chunks`)
    assert.deepEqual(readdirSync(tempRoot), [])
  })
})

test('a slow tarball that keeps sending within the stall timeout completes', async () => {
  let pulled = 0
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      if (pulled === 6) return controller.close()
      pulled += 1
      controller.enqueue(new Uint8Array(10).fill(1))
    },
  })
  const { fetchImpl } = fetchAnswering(async () => new Response(stream, { status: 200 }))
  const result = await downloadRepositoryTarball('acme', 'app', SHA, '0.10.0', fetchImpl, { ...FAST, archiveIdleTimeoutMs: 80 })
  assert.equal(result.status, 'ok')
  assert.ok(result.status === 'ok')
  try {
    assert.equal(readFileSync(result.archive.path).byteLength, 60, 'the stall timer restarts on every chunk')
  } finally {
    result.archive.dispose()
  }
  assert.equal(existsSync(result.archive.path), false)
})

test('--template passes its deadlines to ref resolution and the download', async () => {
  const { fetchImpl } = fetchAnswering(() => never())
  const lookup = { listing: 'unlisted' as const, entry: null, indexProblem: null, indexUrl: 'https://modules.openmercato.com/templates.json' }
  await assert.rejects(
    selectTemplateSha({ kind: 'repo', owner: 'acme', repo: 'app', ref: null, input: 'acme/app' }, lookup, { packageVersion: '0.10.0', fetchImpl, githubDeadlines: FAST }),
    timedOut('inspecting'),
  )
  await assert.rejects(
    selectTemplateSha({ kind: 'repo', owner: 'acme', repo: 'app', ref: 'v1', input: 'acme/app#v1' }, lookup, { packageVersion: '0.10.0', fetchImpl, githubDeadlines: FAST }),
    timedOut('resolving a ref of'),
  )
  const selection = {
    ...lookup,
    owner: 'acme',
    repo: 'app',
    ref: 'v1',
    sha: SHA,
    verified: false,
    facts: null,
    shaFromIndex: false,
  }
  await assert.rejects(
    downloadSelectedTemplate(selection, { packageVersion: '0.10.0', fetchImpl, githubDeadlines: FAST }),
    timedOut('downloading tarball for'),
  )
})
