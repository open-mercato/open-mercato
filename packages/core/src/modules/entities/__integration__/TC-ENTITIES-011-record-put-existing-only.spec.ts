import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomEntity,
  createRecord,
  deleteCustomEntityIfExists,
  deleteRecordIfExists,
  expectUuid,
  listRecords,
  saveFieldDefinitions,
  uniqueEntityId,
} from './helpers/entitiesApi';

/**
 * TC-ENTITIES-011: PUT /api/entities/records only updates an existing, non-deleted record  [P1] (api + ui)
 *
 * A UUID `recordId` that matches no record, or a soft-deleted one, must be refused with a
 * localized 404 and must not write anything: no record is created under the client-chosen
 * id and a deleted record stays deleted. Updating a live record keeps working. A PUT that
 * carries a stale optimistic-lock version is refused by the lock check first (409), before the
 * existence check runs.
 *
 * Endpoints covered:
 *   - POST   /api/entities/entities, /api/entities/definitions.batch (fixtures)
 *   - POST   /api/entities/records                                    (fixture record)
 *   - PUT    /api/entities/records                                    (update / 404 / 409)
 *   - GET    /api/entities/records[?withDeleted=true]                 (read-back)
 *   - DELETE /api/entities/records, /api/entities/entities            (soft delete + cleanup)
 * UI covered:
 *   - /backend/entities/user/:entityId/records/:recordId — saving a deleted record shows the error
 */

type RecordRow = { id?: string; title?: unknown; updated_at?: string; updatedAt?: string };

async function readRecords(
  request: APIRequestContext,
  token: string,
  entityId: string,
  withDeleted: boolean,
): Promise<RecordRow[]> {
  const res = await listRecords(request, token, entityId, withDeleted ? '&withDeleted=true' : '');
  expect(res.status(), 'records list 200').toBe(200);
  const body = await readJsonSafe<{ items?: RecordRow[] }>(res);
  return body?.items ?? [];
}

async function setUpEntity(request: APIRequestContext, token: string, entityId: string): Promise<void> {
  expect((await createCustomEntity(request, token, { entityId, label: 'TC-ENTITIES-011 Entity' })).status()).toBe(200);
  expect(
    (await saveFieldDefinitions(request, token, entityId, [
      { key: 'title', kind: 'text', configJson: { label: 'Title', formEditable: true } },
    ])).status(),
    'field definitions saved',
  ).toBe(200);
}

async function createTitledRecord(
  request: APIRequestContext,
  token: string,
  entityId: string,
  title: string,
): Promise<string> {
  const res = await createRecord(request, token, entityId, { title });
  expect(res.status(), 'record create 200').toBe(200);
  const body = await readJsonSafe<{ item?: { recordId?: string } }>(res);
  return expectUuid(body?.item?.recordId, 'created recordId');
}

function putRecord(
  request: APIRequestContext,
  token: string,
  data: { entityId: string; recordId: string; values: Record<string, unknown> },
  expectedUpdatedAt?: string,
) {
  return apiRequest(request, 'PUT', '/api/entities/records', {
    token,
    data,
    headers: expectedUpdatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': expectedUpdatedAt } : undefined,
  });
}

test.describe('TC-ENTITIES-011: record PUT updates existing, non-deleted records only', () => {
  test('API: unknown and soft-deleted ids answer 404 and write nothing; live records still update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const entityId = uniqueEntityId('put_existing');
    let liveId: string | null = null;
    let deletedId: string | null = null;

    try {
      await setUpEntity(request, token, entityId);
      liveId = await createTitledRecord(request, token, entityId, 'live original');
      deletedId = await createTitledRecord(request, token, entityId, 'deleted original');

      const live = await putRecord(request, token, { entityId, recordId: liveId, values: { title: 'live edited' } });
      expect(live.status(), 'PUT on a live record 200').toBe(200);

      const unknownId = randomUUID();
      const unknown = await putRecord(request, token, { entityId, recordId: unknownId, values: { title: 'created via put' } });
      expect(unknown.status(), 'PUT on an unknown UUID 404').toBe(404);
      expect((await readJsonSafe<{ error?: string }>(unknown))?.error, 'localized not-found error').toBe('Record not found');

      const versionBeforeDelete = (await readRecords(request, token, entityId, false))
        .find((row) => row.id === deletedId);
      const staleVersion = String(versionBeforeDelete?.updated_at ?? versionBeforeDelete?.updatedAt ?? '');
      expect(staleVersion.length, 'record exposes updated_at').toBeGreaterThan(0);

      const removed = await apiRequest(
        request,
        'DELETE',
        `/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(deletedId)}`,
        { token },
      );
      expect(removed.status(), 'soft delete 200').toBe(200);

      const revive = await putRecord(request, token, { entityId, recordId: deletedId, values: { title: 'revived' } });
      expect(revive.status(), 'PUT on a soft-deleted record 404').toBe(404);
      expect((await readJsonSafe<{ error?: string }>(revive))?.error, 'localized not-found error').toBe('Record not found');

      const staleRevive = await putRecord(
        request,
        token,
        { entityId, recordId: deletedId, values: { title: 'revived with stale version' } },
        staleVersion,
      );
      expect(staleRevive.status(), 'stale-versioned PUT on a deleted record is refused by the lock check').toBe(409);

      const active = await readRecords(request, token, entityId, false);
      expect(active.map((row) => row.id).sort(), 'only the live record is active').toEqual([liveId]);
      expect(active[0]?.title, 'live record updated').toBe('live edited');

      const all = await readRecords(request, token, entityId, true);
      expect(all.some((row) => row.id === unknownId), 'no record created under the unknown id').toBe(false);
      expect(all.find((row) => row.id === deletedId)?.title, 'deleted record content untouched').toBe('deleted original');
    } finally {
      await deleteRecordIfExists(request, token, entityId, liveId);
      await deleteRecordIfExists(request, token, entityId, deletedId);
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });

  test('UI: saving the edit form of a deleted record shows the error and keeps it deleted', async ({ page, request }) => {
    test.setTimeout(90_000);
    const token = await getAuthToken(request, 'admin');
    const entityId = uniqueEntityId('put_existing_ui');
    let recordId: string | null = null;

    try {
      await setUpEntity(request, token, entityId);
      recordId = await createTitledRecord(request, token, entityId, 'before delete');
      const removed = await apiRequest(
        request,
        'DELETE',
        `/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`,
        { token },
      );
      expect(removed.status(), 'soft delete 200').toBe(200);

      await login(page, 'admin');
      const editPath = `/backend/entities/user/${encodeURIComponent(entityId)}/records/${encodeURIComponent(recordId)}`;
      await page.goto(editPath);
      const titleInput = page.getByRole('main').getByRole('textbox').first();
      await expect(titleInput).toBeVisible({ timeout: 20_000 });
      await titleInput.fill('saved after delete');

      const saveResponse = page.waitForResponse(
        (response) => response.url().includes('/api/entities/records') && response.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: 'Save' }).first().click();
      expect((await saveResponse).status(), 'edit-form PUT refused with 404').toBe(404);

      await expect(page.getByText('Record not found').first()).toBeVisible();
      expect(new URL(page.url()).pathname, 'form stays on the edit page').toBe(editPath);

      const active = await readRecords(request, token, entityId, false);
      expect(active.some((row) => row.id === recordId), 'deleted record stays deleted').toBe(false);
    } finally {
      await deleteRecordIfExists(request, token, entityId, recordId);
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });
});
