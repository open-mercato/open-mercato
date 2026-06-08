import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

/**
 * TC-ENT-2055-RECORD-READBACK: a custom-entity record written through
 * `/api/entities/records` MUST be readable back with all of its values —
 * including multi-select (array) custom fields.
 *
 * Root cause this guards (found while QA-sweeping CrudForm persistence for
 * #2333/#2055): the records GET reads through the query engine, which only
 * routed an entity to the `custom_entities_storage` (doc-storage) reader when
 * the entity had an ACTIVE row in `custom_entities`. A module-declared custom
 * entity whose id is also a frozen system id (e.g. `example:todo`, registered
 * in entities.ids.generated.ts) is NEVER registered in `custom_entities`
 * (install treats a system id as non-registrable), yet POST/PUT still write its
 * records to `custom_entities_storage`. So the write returned 200 but the GET
 * routed to the empty ORM/index path → list + by-id both returned total:0 and
 * the edit form loaded blank (multi-select showed nothing selected).
 *
 * The fix makes read/write symmetric: `HybridQueryEngine.isCustomEntity` and the
 * records route both treat an entity as doc-storage-backed when it has rows in
 * `custom_entities_storage`, even without a `custom_entities` registration.
 *
 * Endpoints covered:
 *   - POST   /api/entities/records                         (create)
 *   - GET    /api/entities/records?entityId=               (list — must include it)
 *   - GET    /api/entities/records?entityId=&id=<recordId> (by-id — edit-form read)
 *   - DELETE /api/entities/records?entityId=&recordId=     (cleanup)
 *
 * Asserts the record round-trips with: integer (priority), single-select
 * (severity), boolean (blocked), multi tags (labels), and the multi-select
 * listbox (assignee) — the exact field that displayed empty pre-fix.
 */

const ENTITY_ID = 'example:todo';

async function readById(
  request: APIRequestContext,
  token: string,
  recordId: string,
): Promise<Record<string, unknown> | null> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/entities/records?entityId=${encodeURIComponent(ENTITY_ID)}&page=1&pageSize=1&sortField=id&sortDir=asc&id=${encodeURIComponent(recordId)}`,
    { token },
  );
  expect(res.status(), 'by-id GET 200').toBe(200);
  const body = (await res.json()) as { items?: Array<Record<string, unknown>>; total?: number };
  const items = body.items ?? [];
  return items.find((it) => String(it.id) === String(recordId)) ?? null;
}

test('TC-ENT-2055-RECORD-READBACK: a custom-entity record reads back all values incl. multi-select', async ({ request }) => {
  const token = await getAuthToken(request, 'admin');
  let recordId: string | null = null;

  try {
    const create = await apiRequest(request, 'POST', '/api/entities/records', {
      token,
      data: {
        entityId: ENTITY_ID,
        values: {
          priority: 2,
          severity: 'low',
          blocked: true,
          labels: ['ops'],
          assignee: ['charlie'],
          description: 'TC-ENT-2055 round-trip',
        },
      },
    });
    expect(create.status(), `create 200: ${create.status()}`).toBe(200);
    const created = (await create.json()) as { ok?: boolean; item?: { recordId?: string } };
    recordId = created.item?.recordId ?? null;
    expect(typeof recordId, 'recordId present').toBe('string');

    // 1) The just-created live record MUST appear in the list (pre-fix: total 0).
    const list = await apiRequest(
      request,
      'GET',
      `/api/entities/records?entityId=${encodeURIComponent(ENTITY_ID)}&page=1&pageSize=100&sortField=id&sortDir=asc`,
      { token },
    );
    expect(list.status(), 'list GET 200').toBe(200);
    const listBody = (await list.json()) as { items?: Array<Record<string, unknown>>; total?: number };
    expect((listBody.total ?? 0), 'list total includes the new record').toBeGreaterThanOrEqual(1);
    expect(
      (listBody.items ?? []).some((it) => String(it.id) === String(recordId)),
      'created record present in list',
    ).toBe(true);

    // 2) The by-id read (what the edit form fetches) MUST return every value,
    //    custom-field keys normalized to bare names (no cf_ prefix).
    const detail = await readById(request, token, recordId as string);
    expect(detail, 'by-id detail returned (not blank)').toBeTruthy();
    expect(detail!.priority, 'integer field').toBe(2);
    expect(detail!.severity, 'single-select field').toBe('low');
    expect(detail!.blocked, 'boolean field').toBe(true);
    expect(detail!.labels, 'multi tags field').toEqual(['ops']);
    expect(detail!.assignee, 'multi-select listbox field (the pre-fix-empty one)').toEqual(['charlie']);
    expect(detail!.description, 'multiline field').toBe('TC-ENT-2055 round-trip');
  } finally {
    if (recordId) {
      await apiRequest(
        request,
        'DELETE',
        `/api/entities/records?entityId=${encodeURIComponent(ENTITY_ID)}&recordId=${encodeURIComponent(recordId)}`,
        { token },
      ).catch(() => {});
    }
  }
});
