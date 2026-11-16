import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteAttachmentIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  STRUCTURE_TEST_TIMEOUT_MS,
  buildRulebookPdf,
  deletePartitionQuietly,
  extractAndWait,
  prepareStructurePartition,
  uploadStructureDocument,
  type StructurePartition,
} from '@open-mercato/core/modules/attachments/__integration__/helpers/documentStructure';
import { decodeJwtSubject, deleteMessageIfExists } from './helpers';

/**
 * TC-API-MSG-024: removing a draft attachment purges its document structure (C-13, PR #9648)
 * Surfaces: DELETE /api/messages/:id/attachments (messages.attachments.unlink_from_draft) and
 * PATCH /api/messages/:id with attachmentIds (messages.messages.update_draft).
 *
 * Both paths delete the attachment row. The extraction and its encrypted section text must go
 * with it; the structure routes cannot show that once the row is gone, so the rows are counted
 * directly in Postgres.
 */

type StructureRowCounts = { attachments: number; extractions: number; sections: number };

async function countStructureRows(attachmentId: string): Promise<StructureRowCounts> {
  return withClient(async (client) => {
    const result = await client.query<{ attachments: string; extractions: string; sections: string }>(
      `select
         (select count(*) from attachments where id = $1) as attachments,
         (select count(*) from attachment_document_extractions where attachment_id = $1) as extractions,
         (select count(*) from attachment_document_sections where attachment_id = $1) as sections`,
      [attachmentId],
    );
    const row = result.rows[0];
    return {
      attachments: Number(row.attachments),
      extractions: Number(row.extractions),
      sections: Number(row.sections),
    };
  });
}

async function uploadExtractedPdf(
  request: APIRequestContext,
  token: string,
  partition: StructurePartition,
  fileName: string,
): Promise<string> {
  const attachmentId = await uploadStructureDocument(request, token, partition, {
    fileName,
    mimeType: 'application/pdf',
    buffer: await buildRulebookPdf(),
  });
  const structure = await extractAndWait(request, token, attachmentId, partition);
  expect(structure.extraction?.status).toBe('completed');
  return attachmentId;
}

test.describe('TC-API-MSG-024: draft attachment removal purges document structure', () => {
  test('unlink and draft update drop extractions and sections with the attachment row', async ({ request }) => {
    test.setTimeout(STRUCTURE_TEST_TIMEOUT_MS * 2);
    let token: string | null = null;
    let draftId: string | null = null;
    let partition: StructurePartition | null = null;
    const attachmentIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      const employeeUserId = decodeJwtSubject(await getAuthToken(request, 'employee'));
      partition = await prepareStructurePartition(request, token, 'msgdraft');
      const unlinkedId = await uploadExtractedPdf(request, token, partition, `qa-msg-024-unlink-${Date.now()}.pdf`);
      attachmentIds.push(unlinkedId);
      const replacedId = await uploadExtractedPdf(request, token, partition, `qa-msg-024-replace-${Date.now()}.pdf`);
      attachmentIds.push(replacedId);

      const createResponse = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          isDraft: true,
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: `QA TC-API-MSG-024 ${Date.now()}`,
          body: 'Draft carrying structured attachments',
          sendViaEmail: false,
        },
      });
      expect(createResponse.status()).toBe(201);
      draftId = ((await createResponse.json()) as { id: string }).id;

      const linkResponse = await apiRequest(request, 'POST', `/api/messages/${draftId}/attachments`, {
        token,
        data: { attachmentIds: [unlinkedId, replacedId] },
      });
      expect(linkResponse.status()).toBe(200);

      const unlinkedBefore = await countStructureRows(unlinkedId);
      expect(unlinkedBefore.attachments).toBe(1);
      expect(unlinkedBefore.extractions).toBeGreaterThan(0);
      expect(unlinkedBefore.sections).toBeGreaterThan(0);
      expect((await countStructureRows(replacedId)).sections).toBeGreaterThan(0);

      const unlinkResponse = await apiRequest(request, 'DELETE', `/api/messages/${draftId}/attachments`, {
        token,
        data: { attachmentIds: [unlinkedId] },
      });
      expect(unlinkResponse.status()).toBe(200);
      expect(await countStructureRows(unlinkedId)).toEqual({ attachments: 0, extractions: 0, sections: 0 });
      expect((await countStructureRows(replacedId)).sections).toBeGreaterThan(0);

      const updateResponse = await apiRequest(request, 'PATCH', `/api/messages/${draftId}`, {
        token,
        data: { attachmentIds: [] },
      });
      expect(updateResponse.status()).toBe(200);
      expect(await countStructureRows(replacedId)).toEqual({ attachments: 0, extractions: 0, sections: 0 });
    } finally {
      if (token) {
        for (const attachmentId of attachmentIds) await deleteAttachmentIfExists(request, token, attachmentId);
        await deleteMessageIfExists(request, token, draftId);
        await deletePartitionQuietly(request, token, partition);
      }
    }
  });
});
