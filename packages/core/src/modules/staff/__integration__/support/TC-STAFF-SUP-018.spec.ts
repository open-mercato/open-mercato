/**
 * TC-STAFF-SUP-018: deleting a portal upload purges its document structure (C-13, PR #9648).
 *
 * A customer uploads a PDF to their ticket, staff extract its document structure, and the
 * customer deletes the file through DELETE /api/staff/portal/support-tickets/:id/attachments.
 * The extraction and its encrypted section text must be removed with the attachment row. The
 * structure routes cannot show that once the row is gone, so the rows are counted in Postgres.
 */
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { portalCookieHeaders } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  STRUCTURE_TEST_TIMEOUT_MS,
  buildRulebookPdf,
  structurePath,
  waitForStructure,
} from '@open-mercato/core/modules/attachments/__integration__/helpers/documentStructure'
import {
  Cleanup,
  PORTAL_MANAGE,
  PORTAL_VIEW,
  adminToken,
  cleanupTicketAttachments,
  createCategory,
  createPortalCustomer,
  createProject,
  deleteTask,
  fileTicket,
  pointFallbackAt,
} from './fixtures'

type StructureRowCounts = { attachments: number; extractions: number; sections: number }

async function countStructureRows(attachmentId: string): Promise<StructureRowCounts> {
  return withClient(async (client) => {
    const result = await client.query<{ attachments: string; extractions: string; sections: string }>(
      `select
         (select count(*) from attachments where id = $1) as attachments,
         (select count(*) from attachment_document_extractions where attachment_id = $1) as extractions,
         (select count(*) from attachment_document_sections where attachment_id = $1) as sections`,
      [attachmentId],
    )
    const row = result.rows[0]
    return {
      attachments: Number(row.attachments),
      extractions: Number(row.extractions),
      sections: Number(row.sections),
    }
  })
}

test.describe('TC-STAFF-SUP-018: portal attachment delete purges document structure', () => {
  test('the customer delete removes extractions and sections with the attachment row', async ({ request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const project = await createProject(request, admin, cleanup, 'structure')
      await pointFallbackAt(request, admin, cleanup, project.id)
      const category = await createCategory(request, admin, cleanup, 'structure')
      const buyer = await createPortalCustomer(request, admin, cleanup, {
        features: [PORTAL_VIEW, PORTAL_MANAGE],
        label: 'structure-buyer',
      })
      const ticket = await fileTicket(request, buyer, { categoryValue: category.value })
      cleanup.add(() => deleteTask(request, admin, ticket.id))
      cleanupTicketAttachments(request, admin, cleanup, ticket.id)

      const upload = await request.fetch(`/api/staff/portal/support-tickets/${ticket.id}/attachments`, {
        method: 'POST',
        headers: portalCookieHeaders(buyer.session),
        multipart: {
          file: { name: `qa-sup-018-${Date.now()}.pdf`, mimeType: 'application/pdf', buffer: await buildRulebookPdf() },
        },
      })
      const uploaded = await readJsonSafe<{ item?: { id?: string } }>(upload)
      expect(upload.status(), `portal upload: ${JSON.stringify(uploaded)}`).toBe(201)
      const attachmentId = uploaded?.item?.id as string

      const extraction = await apiRequest(request, 'POST', structurePath(attachmentId), {
        token: admin,
        data: { ocr: 'never' },
      })
      expect([200, 202]).toContain(extraction.status())
      const structure = await waitForStructure(request, admin, attachmentId)
      expect(structure.extraction?.status).toBe('completed')

      const before = await countStructureRows(attachmentId)
      expect(before.attachments).toBe(1)
      expect(before.extractions).toBeGreaterThan(0)
      expect(before.sections).toBeGreaterThan(0)

      const deleted = await request.delete(
        `/api/staff/portal/support-tickets/${ticket.id}/attachments?attachmentId=${attachmentId}`,
        { headers: portalCookieHeaders(buyer.session) },
      )
      expect(deleted.status()).toBe(200)
      expect(await countStructureRows(attachmentId)).toEqual({ attachments: 0, extractions: 0, sections: 0 })

      const repeated = await request.delete(
        `/api/staff/portal/support-tickets/${ticket.id}/attachments?attachmentId=${attachmentId}`,
        { headers: portalCookieHeaders(buyer.session) },
      )
      expect(repeated.status()).toBe(404)
    } finally {
      await cleanup.run()
    }
  })
})
