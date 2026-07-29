/**
 * Injectable fake `fetch` serving the recorded Figma REST fixtures. The live
 * network path in `figma-extract.ts` is exercised byte-for-byte — only the
 * transport is replaced.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { FetchLike } from '../../figma-extract'

export const FIXTURE_FILE_KEY = 'Ac9mEbR4nDb0oKf1LeKeY0'

const fixturesDir = __dirname

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

export type FixtureFetchOptions = {
  /** HTTP status for `variables/local` (200 serves the ok fixture, 403 the plan-gated one). */
  variablesStatus?: 200 | 403
  /** Expected `X-Figma-Token` header; requests with a different token get 403. */
  expectToken?: string
  /** Serve this many 429 responses before real answers. */
  rateLimit429s?: number
  /** `Retry-After` header value on 429 responses (default "2"). */
  retryAfter?: string
  /** Every `/nodes` request 429s persistently — batches fail even after retries. */
  nodes429Forever?: boolean
  /** Records every requested URL, in order. */
  requestLog?: string[]
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}

export function createFigmaFixtureFetch(options: FixtureFetchOptions = {}): FetchLike {
  const fileDepth2 = loadFixture('figma-file-depth2.json')
  const styles = loadFixture('figma-styles.json')
  const styleNodes = loadFixture('figma-style-nodes.json') as Record<string, unknown>
  const frameNodes = loadFixture('figma-frame-nodes.json') as Record<string, unknown>
  const variablesOk = loadFixture('figma-variables-local-ok.json')
  const variables403 = loadFixture('figma-variables-local-403.json')
  const allNodes: Record<string, unknown> = { ...styleNodes, ...frameNodes }
  let remaining429s = options.rateLimit429s ?? 0

  return async (url, init) => {
    options.requestLog?.push(url)
    if (options.expectToken && init.headers['X-Figma-Token'] !== options.expectToken) {
      return response(403, { error: true, status: 403, message: 'Invalid token' })
    }
    const rateLimited = () =>
      response(429, { error: true, status: 429, message: 'Rate limited' }, { 'retry-after': options.retryAfter ?? '2' })
    if (remaining429s > 0) {
      remaining429s -= 1
      return rateLimited()
    }
    const parsed = new URL(url)
    const prefix = `/v1/files/${FIXTURE_FILE_KEY}`
    if (options.nodes429Forever && parsed.pathname === `${prefix}/nodes`) {
      return rateLimited()
    }
    if (parsed.pathname === `${prefix}/variables/local`) {
      return (options.variablesStatus ?? 403) === 200
        ? response(200, variablesOk)
        : response(403, variables403)
    }
    if (parsed.pathname === `${prefix}/styles`) {
      return response(200, styles)
    }
    if (parsed.pathname === `${prefix}/nodes`) {
      const ids = (parsed.searchParams.get('ids') ?? '').split(',').filter(Boolean)
      const nodes: Record<string, unknown> = {}
      for (const id of ids) nodes[id] = allNodes[id] ?? null
      return response(200, { nodes })
    }
    if (parsed.pathname === prefix) {
      return response(200, fileDepth2)
    }
    return response(404, { error: true, status: 404, message: `Unknown fixture URL: ${url}` })
  }
}

/** Fixed clock for byte-deterministic extraction artifacts. */
export const FIXTURE_NOW = () => new Date('2026-07-21T10:00:00.000Z')
