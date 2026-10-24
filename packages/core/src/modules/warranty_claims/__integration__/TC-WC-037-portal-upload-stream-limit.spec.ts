import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { resolveDefaultAttachmentMaxUploadBytes } from '@open-mercato/core/modules/attachments/lib/upload-limits'
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
const OVERSIZED_FILE_BYTES = 40 * 1024 * 1024

// The server answers 413 and stops reading once the streamed body passes the
// limit, while the client is still writing, so depending on timing the socket
// is reset before the response is read. A reset only counts as that rejection
// when the client had already sent more than the file limit: an earlier reset
// (an auth or validation failure) or a full read would not. A reset cannot show
// the 413 itself, so the response branch keeps checking it.
type UploadResult =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'closed'; bytesSent: number }

function parseUploadBody(raw: string): { ok?: boolean; error?: string } | null {
  try {
    return JSON.parse(raw) as { ok?: boolean; error?: string }
  } catch {
    return null
  }
}

function sendChunkedUpload(method: 'POST' | 'PUT', cookieHeader: string, claimId: string): Promise<UploadResult> {
  const url = new URL(UPLOAD_PATH, BASE_URL)
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  const fields = [`--${BOUNDARY}\r\nContent-Disposition: form-data; name="claimId"\r\n\r\n${claimId}\r\n`]
  if (method === 'PUT') {
    fields.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="attachmentId"\r\n\r\n${randomUUID()}\r\n`)
  }
  fields.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="tc-wc-037.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`)
  return new Promise((resolve, reject) => {
    let settled = false
    let responded = false
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
      })
    })
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (settled || error.code === 'EPIPE' || error.code === 'ECONNRESET') return
      reject(error)
    })
    let sent = 0
    req.on('close', () => {
      if (!responded) resolve({ kind: 'closed', bytesSent: sent })
    })
    req.write(fields.join(''))
    const chunk = Buffer.alloc(256 * 1024, 0x41)
    const writeMore = () => {
      while (sent < OVERSIZED_FILE_BYTES) {
        if (req.destroyed) return
        sent += chunk.length
        if (!req.write(chunk)) {
          req.once('drain', writeMore)
          return
        }
      }
      req.end(`\r\n--${BOUNDARY}--\r\n`)
    }
    writeMore()
  })
}

/**
 * TC-WC-037: portal attachment uploads (create and replace) are size-limited while the multipart body
 * streams in. A chunked request without Content-Length that exceeds the upload limit is answered with
 * 413 before the claim is looked up, so it never reaches the ownership check (which would answer 404).
 */
test.describe('TC-WC-037: portal attachment upload stream limit', () => {
  test('rejects an oversized chunked upload with 413 before resolving the claim', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-037')

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

      for (const method of ['POST', 'PUT'] as const) {
        const result = await sendChunkedUpload(method, session.cookieHeader, randomUUID())
        if (result.kind === 'closed') {
          expect(result.bytesSent, `${method} upload was reset before it passed the upload limit`).toBeGreaterThan(resolveDefaultAttachmentMaxUploadBytes())
          expect(result.bytesSent, `${method} upload was reset only after the whole body was sent`).toBeLessThan(OVERSIZED_FILE_BYTES)
          continue
        }
        expect(result.status, `${method} oversized chunked upload should be rejected while streaming`).toBe(413)
        const body = parseUploadBody(result.body)
        expect(body?.ok).toBe(false)
        expect(body?.error).toContain('exceeds the maximum upload size')
      }
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })
})
