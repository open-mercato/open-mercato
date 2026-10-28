import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { expect, test } from '@playwright/test'
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

type UploadResult = { status: number; body: string }

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
  const prefix = Buffer.from(fields.join(''), 'utf8')
  const oversizedBodyBytes = resolveAttachmentMultipartMaxBytes() + 1
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
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        req.destroy()
      })
    })
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (settled || error.code === 'EPIPE' || error.code === 'ECONNRESET') return
      reject(error)
    })
    req.on('close', () => {
      if (!responded) reject(new Error('[internal] connection closed before a response arrived'))
    })
    req.write(prefix)
    let sent = prefix.length
    const writeMore = () => {
      while (sent < oversizedBodyBytes) {
        if (req.destroyed) return
        const chunk = Buffer.alloc(Math.min(256 * 1024, oversizedBodyBytes - sent), 0x41)
        sent += chunk.length
        if (!req.write(chunk)) {
          req.once('drain', writeMore)
          return
        }
      }
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
