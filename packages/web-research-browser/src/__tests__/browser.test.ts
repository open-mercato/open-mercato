import { PassThrough } from 'node:stream'
import { createTestContext, describeAdapterContract } from '@open-mercato/web-research/testing'
import { browserAdapterModule, createBrowserAdapter } from '../adapter'
import { Sidecar, type SidecarStream, type SpawnFn } from '../client'
import { decodeLine, encodeLine, type SidecarRequest } from '../protocol'

const SERP_HTML = `
<div class="result">
  <a class="result__a" href="https://example.com/one">Rendered result</a>
  <div class="result__snippet">Rendered snippet.</div>
</div>`

type FakeChild = SidecarStream & {
  written: string[]
  emitExit(code: number | null): void
  emitStdinError(error: NodeJS.ErrnoException): void
  killed: NodeJS.Signals[]
}

/**
 * Scripted child process. Playwright is never imported by these tests — the
 * point is the parent-side protocol, not the browser.
 */
function makeFakeSpawn(
  respond: (request: SidecarRequest) => Record<string, unknown> | 'silent' | Error,
): { spawnFn: SpawnFn; children: FakeChild[] } {
  const children: FakeChild[] = []
  const spawnFn: SpawnFn = () => {
    const stdout = new PassThrough({ encoding: 'utf8' })
    const stderr = new PassThrough({ encoding: 'utf8' })
    const exitHandlers: Array<(code: number | null) => void> = []
    const stdinErrorHandlers: Array<(error: NodeJS.ErrnoException) => void> = []
    const child: FakeChild = {
      written: [],
      killed: [],
      stdin: {
        on(event: 'error', handler: (error: NodeJS.ErrnoException) => void) {
          stdinErrorHandlers.push(handler)
          return child.stdin
        },
        write(chunk: string) {
          child.written.push(chunk)
          const request = decodeLine(chunk.trim()) as SidecarRequest
          const reply = respond(request)
          if (reply === 'silent') return true
          if (reply instanceof Error) {
            stdout.write(
              encodeLine({ id: request.id, ok: false, error: { message: reply.message, kind: 'runtime' } }),
            )
            return true
          }
          stdout.write(encodeLine({ id: request.id, ok: true, result: reply }))
          return true
        },
      },
      stdout,
      stderr,
      once(_event, handler) {
        exitHandlers.push(handler)
        return child
      },
      kill(signal) {
        child.killed.push((signal ?? 'SIGTERM') as NodeJS.Signals)
        return true
      },
      emitExit(code) {
        for (const handler of exitHandlers.splice(0)) handler(code)
      },
      emitStdinError(error) {
        for (const handler of stdinErrorHandlers) handler(error)
      },
    }
    children.push(child)
    return child
  }
  return { spawnFn, children }
}

const sidecarWith = (spawnFn: SpawnFn, overrides: Partial<Record<string, number>> = {}) =>
  new Sidecar('/fake/sidecar.js', spawnFn, overrides.callTimeoutMs ?? 500, overrides.closeTimeoutMs ?? 50, 4)

describe('sidecar client protocol', () => {
  it('correlates a reply to its request', async () => {
    const { spawnFn } = makeFakeSpawn(() => ({ pong: true }))
    await expect(sidecarWith(spawnFn).call('ping')).resolves.toEqual({ pong: true })
  })

  it('surfaces a sidecar error as a typed rejection', async () => {
    const { spawnFn } = makeFakeSpawn(() => new Error('navigation blocked'))
    await expect(sidecarWith(spawnFn).call('render', { url: 'https://x' })).rejects.toThrow('navigation blocked')
  })

  // A child that has died leaves its stdin pipe broken, and Node reports that
  // asynchronously on the stream rather than throwing from write(). Unhandled,
  // it escapes the adapter and the call throws where the contract promises an
  // outcome — which is exactly how this surfaced on a runner with no browser.
  it('turns a broken sidecar pipe into a typed rejection, not an unhandled error', async () => {
    const { spawnFn, children } = makeFakeSpawn(() => 'silent')
    const sidecar = sidecarWith(spawnFn)
    const call = sidecar.call('render', { url: 'https://x' })
    const epipe: NodeJS.ErrnoException = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    children[0].emitStdinError(epipe)
    children[0].emitExit(1)
    await expect(call).rejects.toThrow(/exited unexpectedly/)
  })

  it('times a silent call out instead of hanging forever', async () => {
    const { spawnFn } = makeFakeSpawn(() => 'silent')
    await expect(sidecarWith(spawnFn).call('render')).rejects.toThrow(/timed out/)
  })

  it('rejects one aborted call without disturbing the others', async () => {
    const { spawnFn } = makeFakeSpawn((request) => (request.method === 'slow' ? 'silent' : { ok: true }))
    const sidecar = sidecarWith(spawnFn)
    const controller = new AbortController()

    const aborted = sidecar.call('slow', {}, controller.signal)
    controller.abort()

    await expect(aborted).rejects.toThrow(/aborted/)
    await expect(sidecar.call('ping')).resolves.toEqual({ ok: true })
  })

  it('degrades to a clean busy error rather than piling up unbounded work', async () => {
    const { spawnFn } = makeFakeSpawn(() => 'silent')
    const sidecar = sidecarWith(spawnFn)
    const inflight = [0, 1, 2, 3].map(() => sidecar.call('slow').catch(() => 'settled'))

    await expect(sidecar.call('one-too-many')).rejects.toThrow(/busy/)
    await Promise.all(inflight)
  })

  it('rejects every pending call when the child dies, with the stderr tail', async () => {
    const { spawnFn, children } = makeFakeSpawn(() => 'silent')
    const sidecar = sidecarWith(spawnFn)
    const pending = sidecar.call('render')
    children[0].stderr.write('playwright: Executable does not exist\n')
    await new Promise((resolve) => setImmediate(resolve))
    children[0].emitExit(1)

    await expect(pending).rejects.toThrow(/exited unexpectedly/)
  })

  // Regression: a child that dies mid-line leaves a JSON fragment behind. If the
  // buffer is not cleared on respawn it prefixes the next spawn's first reply,
  // which then fails to parse and hangs that call for the full timeout.
  it('clears a partial line so the next spawn is not poisoned', async () => {
    const { spawnFn, children } = makeFakeSpawn(() => ({ ok: true }))
    const sidecar = sidecarWith(spawnFn)
    await sidecar.call('ping')

    children[0].stdout.write('{"id":"truncated","ok":tr')
    await new Promise((resolve) => setImmediate(resolve))
    children[0].emitExit(1)

    await expect(sidecar.call('ping')).resolves.toEqual({ ok: true })
    expect(children).toHaveLength(2)
  })

  it('escalates to SIGKILL when the child ignores a close', async () => {
    const { spawnFn, children } = makeFakeSpawn(() => 'silent')
    const sidecar = sidecarWith(spawnFn)
    await sidecar.call('ping').catch(() => undefined)

    await sidecar.close()

    expect(children[0].killed).toContain('SIGTERM')
    expect(children[0].killed).toContain('SIGKILL')
  })
})

describe('browser adapter', () => {
  const options = (extra: Record<string, unknown> = {}) => ({
    sidecar: { sidecarPath: '/fake/sidecar.js', callTimeoutMs: 500, closeTimeoutMs: 50, ...extra },
  })

  // Participation is the policy row's job; the scheduler never puts a browser
  // adapter in a normal wave, so it is reachable only via escalation.
  it('is ready without per-adapter opt-in, since the policy row governs it', () => {
    expect(createBrowserAdapter({}).readiness().ready).toBe(true)
  })

  it('parses a browser-rendered SERP with the shared engine profiles', async () => {
    const { spawnFn } = makeFakeSpawn((request) =>
      request.method === 'render' ? { url: 'https://html.duckduckgo.com/html/', html: SERP_HTML } : {},
    )
    const adapter = createBrowserAdapter(options({ spawnFn }))

    const outcome = await adapter.search({ query: 'x', limit: 5 }, createTestContext())

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.results[0]).toMatchObject({
      url: 'https://example.com/one',
      title: 'Rendered result',
      snippet: 'Rendered snippet.',
    })
  })

  it('releases the lease even when the render fails', async () => {
    const { spawnFn, children } = makeFakeSpawn((request) =>
      request.method === 'render' ? new Error('nav failed') : {},
    )
    const adapter = createBrowserAdapter(options({ spawnFn }))

    await adapter.search({ query: 'x', limit: 5 }, createTestContext())

    const methods = children[0].written.map((line) => (decodeLine(line.trim()) as SidecarRequest).method)
    expect(methods).toContain('release')
  })

  it('reports blocked when even a rendered page yields nothing', async () => {
    const { spawnFn } = makeFakeSpawn(() => ({ url: 'https://x', html: '<html><body>nope</body></html>' }))
    const adapter = createBrowserAdapter(options({ spawnFn }))

    const outcome = await adapter.search({ query: 'x', limit: 5 }, createTestContext())

    expect(outcome.status).toBe('blocked')
  })

  it('renders a page into readable text for fetch', async () => {
    const html = `<html><head><title>Doc</title></head><body><article><p>${'word '.repeat(80)}</p></article></body></html>`
    const { spawnFn } = makeFakeSpawn((request) =>
      request.method === 'render' ? { url: 'https://example.com/a', html } : {},
    )
    const adapter = createBrowserAdapter(options({ spawnFn }))

    const outcome = await adapter.fetch?.({ url: 'https://example.com/a' }, createTestContext())

    expect(outcome).toMatchObject({ status: 'ok', page: { title: 'Doc', renderedWith: 'browser' } })
  })
})

describeAdapterContract(
  browserAdapterModule,
  {
    configuredOptions: {
      sidecar: { sidecarPath: '/fake/sidecar.js', callTimeoutMs: 200, closeTimeoutMs: 50 },
    },
  },
  { describe, it, expect: expect as never },
)
