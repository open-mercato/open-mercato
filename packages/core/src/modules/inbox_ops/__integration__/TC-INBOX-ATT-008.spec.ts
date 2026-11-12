import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { fetchProposalDetail, type InboxProposalActionDetail } from '@open-mercato/core/helpers/integration/inboxFixtures'
import {
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  listEmailAttachmentParts,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  uniqueRunId,
  waitForTerminalEmailStatus,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments'] }

const EXTRACTION_TIMEOUT_MS = 90_000

type SourceRef = { kind: string; attachmentId?: string; fileName?: string; snippet: string }
type ActionWithRefs = InboxProposalActionDetail & { sourceRefs?: SourceRef[] | null }

/** A one-page PDF with Helvetica text lines, so `pdfjs-dist` extracts real text at upload. */
function buildTextPdf(lines: string[]): Buffer {
  const escapePdf = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const stream = ['BT', '/F1 12 Tf', '16 TL', '72 740 Td', ...lines.map((line) => `(${escapePdf(line)}) Tj T*`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

/**
 * TC-INBOX-ATT-008: the order lines of a Resend email exist only in its attached PDF. The PDF is
 * stored with extracted text, the extraction prompt carries that text, and the proposal's order
 * action contains the lines with `sourceRefs` citing the stored file. Like TC-INBOX-P2-001, the
 * LLM-dependent assertions are skipped when extraction fails because no provider key is set.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md (Phase 2)
 */
test.describe('TC-INBOX-ATT-008: order lines from an attached PDF reach the proposal', () => {
  test('proposes the PDF order lines and cites the file in sourceRefs', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS + EXTRACTION_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-008')
    const code = run.slice(-8).toUpperCase()
    const fileName = `${run}-purchase-order.pdf`
    try {
      const pdf = buildTextPdf([
        `Purchase Order PO-${code}`,
        'Customer: Marco Rossi, Rossi Imports',
        'Currency: EUR',
        `- 12 x Titanium Hinge TH-${code} at 8.50 EUR each`,
        `- 4 x Brass Latch BL-${code} at 21.00 EUR each`,
        `Customer reference: PO-${code}`,
      ])
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        from: 'Marco Rossi <marco@tc-inbox-att.example.test>',
        subject: `Purchase order ${run}`,
        text: 'Hello, please process the attached purchase order. Thank you.',
        attachments: [{ filename: fileName, contentType: 'application/pdf', content: pdf }],
      })

      const parts = await listEmailAttachmentParts(request, admin, received.emailId)
      expect(parts).toHaveLength(1)
      expect(parts[0].status).toBe('stored')
      const pdfAttachmentId = parts[0].attachmentId
      expect(pdfAttachmentId).toBeTruthy()

      // The ledger holds the (encrypted) text extracted at upload; the prompt reads it from there.
      const ledger = await withClient(async (client) => {
        const result = await client.query<{ extracted_text: string | null }>(
          'select extracted_text from inbox_email_attachments where inbox_email_id = $1',
          [received.emailId],
        )
        return result.rows
      })
      expect(ledger).toHaveLength(1)
      expect(ledger[0].extracted_text ?? '').not.toBe('')

      // Drains the `events` queue while polling, so standalone runs (no events worker) extract too.
      const processed = await waitForTerminalEmailStatus(request, admin, received.emailId, { timeoutMs: EXTRACTION_TIMEOUT_MS })
      if (processed.status === 'failed') {
        test.skip(true, 'LLM extraction failed (no API key configured in CI)')
        return
      }
      expect(['processed', 'needs_review']).toContain(processed.status)
      const proposalIds = await withClient(async (client) => {
        const result = await client.query<{ id: string }>(
          'select id from inbox_proposals where inbox_email_id = $1 and is_active = true and deleted_at is null',
          [received.emailId],
        )
        return result.rows.map((row) => row.id)
      })
      expect(proposalIds, 'extraction should create one proposal').toHaveLength(1)

      const proposal = await fetchProposalDetail(request, admin, proposalIds[0])
      expect(proposal).toBeTruthy()
      const actions = proposal!.actions as ActionWithRefs[]
      const orderAction = actions.find((action) => action.actionType === 'create_order' || action.actionType === 'create_quote')
      expect(orderAction, 'the proposal should contain an order or quote action').toBeTruthy()
      const payloadText = JSON.stringify(orderAction!.payload).toUpperCase()
      expect(payloadText).toContain(`TH-${code}`)
      expect(payloadText).toContain(`BL-${code}`)

      const attachmentRefs = actions.flatMap((action) => action.sourceRefs ?? []).filter((ref) => ref.kind === 'attachment')
      expect(attachmentRefs.length, 'sourceRefs should cite the attached PDF').toBeGreaterThan(0)
      for (const ref of attachmentRefs) {
        expect(ref.attachmentId).toBe(pdfAttachmentId)
        expect(ref.fileName).toBe(fileName)
        expect(ref.snippet.length).toBeGreaterThan(0)
      }
    } finally {
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
