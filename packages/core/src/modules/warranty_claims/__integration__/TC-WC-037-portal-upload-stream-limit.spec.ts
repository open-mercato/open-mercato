import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { resolveAttachmentMultipartMaxBytes } from '@open-mercato/core/modules/attachments/lib/upload-limits'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { uniqueLabel } from './helpers'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const UPLOAD_PATH = '/api/warranty_claims/portal/attachments'
const BOUNDARY = '----om-tc-wc-037'
const OVERSIZED_BODY_BYTES = 40 * 1024 * 1024
const UPLOAD_IDLE_TIMEOUT_MS = 10_000

// The server stops reading and answers 413 as soon as the body passes the
// multipart limit. A client that keeps writing after that point races the
// server closing the connection, so its socket may be reset before the 413 is
// read. Sending exactly one byte past the limit and then waiting leaves nothing
// unread on the server, so the 413 always arrives and is the evidence of the
// size check. The full-stream case is covered separately and never counts a
// reset as that evidence.
type UploadResult =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'closed'; bytesSent: number }

type UploadOptions = { bodyBytes: number; finish: boolean }

function parseUploadBody(raw: string): { ok?: boolean; error?: string } | null {
  try {
    return JSON.parse(raw) as { ok?: boolean; error?: string }
  } catch {
    return null
  }
}

function buildMultipartPrefix(method: 'POST' | 'PUT', claimId: string): Buffer {
  const fields = [`--${BOUNDARY}\r\nContent-Disposition: form-data; name="claimId"\r\n\r\n${claimId}\r\n`]
  if (method === 'PUT') {
    fields.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="attachmentId"\r\n\r\n${randomUUID()}\r\n`)
  }
  fields.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="tc-wc-037.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`)
  return Buffer.from(fields.join(''), 'utf8')
}

function sendChunkedUpload(
  method: 'POST' | 'PUT',
  cookieHeader: string,
  claimId: string,
  { bodyBytes, finish }: UploadOptions,
): Promise<UploadResult> {
  const url = new URL(UPLOAD_PATH, BASE_URL)
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  const prefix = buildMultipartPrefix(method, claimId)
  return new Promise((resolve, reject) => {
    let settled = false
    let responded = false
    let sent = prefix.length
    const req = send(url, {
      method,
      headers: {
        cookie: cookieHeader,
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        'transfer-encoding': 'chunked',
      },
    }, (res) => {
      responded = true
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', (error) => reject(error))
      res.on('aborted', () => reject(new Error('[internal] response aborted before it completed')))
      res.on('end', () => {
        settled = true
        resolve({ kind: 'response', status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        if (!finish) req.destroy()
      })
    })
    req.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => {
      req.destroy(new Error(`[internal] no response within ${UPLOAD_IDLE_TIMEOUT_MS} ms after ${sent} body bytes`))
    })
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (settled || error.code === 'EPIPE' || error.code === 'ECONNRESET') return
      reject(error)
    })
    req.on('close', () => {
      if (!responded) resolve({ kind: 'closed', bytesSent: sent })
    })
    req.write(prefix)
    const chunkBytes = 256 * 1024
    const writeMore = () => {
      while (sent < bodyBytes) {
        if (req.destroyed) return
        const chunk = Buffer.alloc(Math.min(chunkBytes, bodyBytes - sent), 0x41)
        sent += chunk.length
        if (!req.write(chunk)) {
          req.once('drain', writeMore)
          return
        }
      }
      if (finish) req.end(`\r\n--${BOUNDARY}--\r\n`)
    }
    writeMore()
  })
}

function expectUploadTooLarge(method: 'POST' | 'PUT', result: Extract<UploadResult, { kind: 'response' }>) {
  expect(result.status, `${method} oversized chunked upload should be rejected while streaming`).toBe(413)
  const body = parseUploadBody(result.body)
  expect(body?.ok).toBe(false)
  expect(body?.error).toContain('exceeds the maximum upload size')
}

async function withPortalSession(
  request: APIRequestContext,
  stampPrefix: string,
  run: (cookieHeader: string) => Promise<void>,
) {
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId } = getTokenContext(adminToken)
  const stamp = uniqueLabel(stampPrefix)

  let roleId: string | null = null
  let companyId: string | null = null
  let userId: string | null = null

  try {
    roleId = (await createCustomerRoleFixture(request, adminToken, {
      features: ['portal.account.manage'],
    })).id
    companyId = await createCustomerCompanyFixture(request, adminToken, `QA WC Stream Limit ${stamp}`)
    const user = await createCustomerUserFixture(request, adminToken, {
      roleIds: [roleId],
      customerEntityId: companyId,
      displayName: `QA WC Stream Limit User ${stamp}`,
    })
    userId = user.id
    const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })
    await run(session.cookieHeader)
  } finally {
    await deleteCustomerUserFixture(request, adminToken, userId)
    await deleteCustomerRoleFixture(request, adminToken, roleId)
    await deleteCustomerCompanyFixture(request, adminToken, companyId)
  }
}

/**
 * TC-WC-037: portal attachment uploads (create and replace) are size-limited while the multipart body
 * streams in. A chunked request without Content-Length that exceeds the upload limit is answered with
 * 413 before the claim is looked up, so it never reaches the ownership check (which would answer 404).
 */
test.describe('TC-WC-037: portal attachment upload stream limit', () => {
  test('rejects a chunked upload one byte over the limit with 413 before resolving the claim', async ({ request }) => {
    await withPortalSession(request, 'tc-wc-037', async (cookieHeader) => {
      for (const method of ['POST', 'PUT'] as const) {
        const result = await sendChunkedUpload(method, cookieHeader, randomUUID(), {
          bodyBytes: resolveAttachmentMultipartMaxBytes() + 1,
          finish: false,
        })
        expect(result.kind, `${method} upload one byte over the limit should get a response, not a reset`).toBe('response')
        if (result.kind === 'response') expectUploadTooLarge(method, result)
      }
    })
  })

  test('ends a fully streamed oversized upload with 413 or a reset past the limit, never another response', async ({ request }) => {
    await withPortalSession(request, 'tc-wc-037-stream', async (cookieHeader) => {
      for (const method of ['POST', 'PUT'] as const) {
        const result = await sendChunkedUpload(method, cookieHeader, randomUUID(), {
          bodyBytes: OVERSIZED_BODY_BYTES,
          finish: true,
        })
        if (result.kind === 'response') {
          expectUploadTooLarge(method, result)
          continue
        }
        expect(result.bytesSent, `${method} upload was reset before it passed the upload limit`).toBeGreaterThan(resolveAttachmentMultipartMaxBytes())
        expect(result.bytesSent, `${method} upload was reset only after the whole body was sent`).toBeLessThan(OVERSIZED_BODY_BYTES)
      }
    })
  })
})
