import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';

/**
 * TC-CRM-020: Deal Note And Activity Creation
 *
 * Deal detail v3 replaced the modal activity dialog with an inline composer, and the note flow
 * moved into a tabbed NotesSection. This test exercises the canonical public APIs and verifies
 * the created records render on the deal detail page.
 */
test.describe('TC-CRM-020: Deal Note And Activity Creation', () => {
  test('should add a deal note and log a deal activity', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-020 Company ${Date.now()}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TCCRM020${Date.now()}`,
        displayName: `QA TC-CRM-020 Person ${Date.now()}`,
        companyEntityId: companyId,
      });
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-020 Deal ${Date.now()}`,
        companyIds: [companyId],
        personIds: [personId],
      });

      const noteText = `QA deal note ${Date.now()}`;
      const activitySubject = `QA deal activity ${Date.now()}`;

      const noteResp = await apiRequest(request, 'POST', '/api/customers/comments', {
        token,
        data: { entityId: companyId, dealId, body: noteText },
      });
      expect(noteResp.status(), `POST /api/customers/comments returned ${noteResp.status()}`).toBeLessThan(400);

      const activityResp = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          dealId,
          interactionType: 'call',
          title: activitySubject,
          body: 'QA deal activity description',
        },
      });
      expect(activityResp.status(), `POST /api/customers/interactions returned ${activityResp.status()}`).toBeLessThan(400);

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);
      await expect(page.getByText(activitySubject).first()).toBeVisible({ timeout: 20_000 });
      await page.getByRole('tab', { name: /Notes/i }).click().catch(() => {});
      await expect(page.getByText(noteText).first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  for (const otherUserEdits of [false, true]) {
    test(otherUserEdits ? 'rejects deletion after another user saves the note' : 'deletes a note immediately after its own save', async ({ page, request }) => {
      const token = await getAuthToken(request);
      const stamp = crypto.randomUUID();
      const commentsPath = '/api/customers/comments';
      let companyId: string | null = null;
      let dealId: string | null = null;
      let noteId: string | null = null;
      let roleId: string | null = null;
      let userId: string | null = null;

      try {
        let editorToken: string | null = null;
        if (otherUserEdits) {
          const { organizationId, tenantId } = getTokenContext(token);
          const roleName = `qa_note_editor_${stamp}`;
          const email = `qa-note-editor-${stamp}@acme.com`;
          const password = `Qa1!${stamp}`;
          roleId = await createRoleFixture(request, token, { name: roleName, tenantId });
          await setRoleAclFeatures(request, token, { roleId, features: ['customers.activities.manage'] });
          userId = await createUserFixture(request, token, { email, password, organizationId, roles: [roleName] });
          editorToken = await getAuthToken(request, email, password);
        }

        companyId = await createCompanyFixture(request, token, `QA note company ${stamp}`);
        dealId = await createDealFixture(request, token, { title: `QA note deal ${stamp}`, companyIds: [companyId] });
        await login(page, 'admin');
        await page.goto(`/backend/customers/deals/${dealId}`);
        await page.getByRole('tab', { name: 'Notes', exact: true }).click();

        const waitForNoteWrite = (method: 'POST' | 'PUT' | 'DELETE') => page.waitForResponse((response) =>
          new URL(response.url()).pathname === commentsPath && response.request().method() === method,
        );
        const original = `Original note ${stamp}`;
        const edited = `Edited note ${stamp}`;
        const otherEdit = `Another user's note ${stamp}`;
        await page.getByRole('button', { name: /^Add (?:a )?note$/i }).click();
        const composer = page.locator('form textarea:visible');
        await composer.fill(original);
        const created = waitForNoteWrite('POST');
        await composer.press('Control+Enter');
        const createResponse = await created;
        expect(createResponse.status()).toBe(201);
        const createdNote = await createResponse.json() as { id?: string; updatedAt?: string };
        noteId = expectId(createdNote.id, 'Note creation returns its ID');
        const createdVersion = expectId(createdNote.updatedAt, 'Note creation returns its version');

        await page.getByRole('button', { name: original, exact: true }).click();
        const inlineEditor = page.locator('div.group textarea:visible');
        await inlineEditor.fill(edited);
        const saved = waitForNoteWrite('PUT');
        await inlineEditor.press('Control+Enter');
        const saveResponse = await saved;
        expect(saveResponse.status()).toBe(200);
        const saveHeaderVersion = expectId(saveResponse.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME], 'Note save sends its loaded version');
        expect(new Date(saveHeaderVersion).toISOString()).toBe(new Date(createdVersion).toISOString());
        const savedNote = await saveResponse.json() as { updatedAt?: string };
        const savedVersion = expectId(savedNote.updatedAt, 'Note update returns its saved version');
        const editedNote = page.getByRole('button', { name: edited, exact: true });
        await expect(editedNote).toBeVisible();

        if (editorToken) {
          const concurrentSave = await apiRequest(request, 'PUT', commentsPath, {
            token: editorToken,
            headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: savedVersion },
            data: { id: noteId, body: otherEdit },
          });
          expect(concurrentSave.status()).toBe(200);
        }

        await page.locator('div.group').filter({ has: editedNote }).locator('button:has(svg.lucide-trash2)').click();
        const deleted = waitForNoteWrite('DELETE');
        await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click();
        const deleteResponse = await deleted;
        const deleteHeaderVersion = expectId(deleteResponse.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME], 'Note delete sends its saved version');
        expect(new Date(deleteHeaderVersion).toISOString()).toBe(new Date(savedVersion).toISOString());
        if (otherUserEdits) {
          expect(deleteResponse.status()).toBe(409);
          expect(await deleteResponse.json()).toMatchObject({ code: 'optimistic_lock_conflict', expectedUpdatedAt: savedVersion });
          await expect(page.getByTestId('record-conflict-banner')).toBeVisible();
          const listed = await apiRequest(request, 'GET', `${commentsPath}?dealId=${dealId}`, { token });
          expect(await readJsonSafe(listed)).toMatchObject({ items: [expect.objectContaining({ id: noteId, body: otherEdit })] });
        } else {
          expect(deleteResponse.status()).toBe(200);
          await expect(editedNote).toHaveCount(0);
        }
      } finally {
        await deleteEntityIfExists(request, token, commentsPath, noteId);
        await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
        await deleteUserIfExists(request, token, userId);
        await deleteRoleIfExists(request, token, roleId);
      }
    });
  }
});
