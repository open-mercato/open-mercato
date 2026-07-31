import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures';

/**
 * TC-ENT-2055-RECORD-READBACK: the records surface serves CUSTOM entities only,
 * and a custom-entity record written through `/api/entities/records` MUST be
 * readable back with all of its values — including multi-select (array) fields.
 *
 * History: the original #2055 fix made reads follow writes for ids that landed in
 * `custom_entities_storage` without a `custom_entities` registration. That
 * classification-by-storage-rows let a stray doc record written for a TABLE-backed
 * system id (e.g. `customers:customer_deal`) reroute the whole module's list reads
 * to doc storage (#2939). The hardened contract (#2942): ids backed by a registered
 * ORM table are rejected by `/api/entities/records` outright — doc storage is for
 * custom entities only — while genuine custom entities keep full read/write symmetry.
 *
 * Part 1 — system entities are rejected (400, code `system_entity_records_blocked`)
 * on both read and write: `example:todo` (ORM table `todos`) and
 * `customers:customer_deal` (ORM table `customer_deals`).
 *
 * Part 2 — round-trip parity on a runtime-defined custom entity: integer,
 * single-select, boolean, multi tags, multi-select listbox (the field that
 * displayed empty pre-#2055), and multiline values all read back with bare keys.
 *
 * Endpoints covered:
 *   - POST   /api/entities/entities                          (runtime entity)
 *   - POST   /api/entities/definitions                       (runtime field defs)
 *   - POST   /api/entities/records                           (create + rejection)
 *   - GET    /api/entities/records?entityId=                 (list + rejection)
 *   - GET    /api/entities/records?entityId=&id=<recordId>   (by-id read)
 *   - DELETE /api/entities/records?entityId=&recordId=       (cleanup)
 *   - DELETE /api/entities/entities                          (cleanup)
 */

const SYSTEM_ENTITY_CASES: Array<{ entityId: string; values: Record<string, unknown> }> = [
  { entityId: 'example:todo', values: { priority: 2 } },
  { entityId: 'customers:customer_deal', values: { competitive_risk: 'high' } },
];

const RUNTIME_ENTITY_ID = `qa_ent2055:readback_${Date.now()}`;

function buildRuntimeFieldDefs(dictionaryId: string): Array<{ key: string; kind: string; configJson: Record<string, unknown> }> {
  return [
    { key: 'priority', kind: 'integer', configJson: { label: 'Priority', formEditable: true } },
    { key: 'severity', kind: 'select', configJson: { label: 'Severity', options: ['low', 'medium', 'high'], formEditable: true } },
    { key: 'blocked', kind: 'boolean', configJson: { label: 'Blocked', formEditable: true } },
    { key: 'labels', kind: 'text', configJson: { label: 'Labels', multi: true, input: 'tags', formEditable: true } },
    { key: 'assignee', kind: 'select', configJson: { label: 'Assignees', options: ['alice', 'bob', 'charlie'], multi: true, input: 'listbox', formEditable: true } },
    { key: 'regions', kind: 'dictionary', configJson: { label: 'Regions', dictionaryId, multi: true, formEditable: true, filterable: true } },
    { key: 'description', kind: 'multiline', configJson: { label: 'Description', formEditable: true } },
  ];
}

async function createDictionaryEntry(
  request: APIRequestContext,
  token: string,
  dictionaryId: string,
  value: string,
  label: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'POST',
    `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
    { token, data: { value, label } },
  );
  expect(response.status(), `dictionary entry ${value} create 201`).toBe(201);
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id, `dictionary entry ${value} id`).toBe('string');
  return body.id as string;
}

async function readById(
  request: APIRequestContext,
  token: string,
  recordId: string,
): Promise<Record<string, unknown> | null> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/entities/records?entityId=${encodeURIComponent(RUNTIME_ENTITY_ID)}&page=1&pageSize=1&sortField=id&sortDir=asc&id=${encodeURIComponent(recordId)}`,
    { token },
  );
  expect(res.status(), 'by-id GET 200').toBe(200);
  const body = (await res.json()) as { items?: Array<Record<string, unknown>>; total?: number };
  const items = body.items ?? [];
  return items.find((it) => String(it.id) === String(recordId)) ?? null;
}

test.describe('TC-ENT-2055-RECORD-READBACK', () => {
  test('system (table-backed) entity ids are rejected by the records API', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    for (const { entityId, values } of SYSTEM_ENTITY_CASES) {
      const create = await apiRequest(request, 'POST', '/api/entities/records', {
        token,
        data: { entityId, values },
      });
      expect(create.status(), `POST records for ${entityId} is rejected`).toBe(400);
      const createBody = (await create.json()) as { code?: string };
      expect(createBody.code, `rejection code for ${entityId}`).toBe('system_entity_records_blocked');

      const list = await apiRequest(
        request,
        'GET',
        `/api/entities/records?entityId=${encodeURIComponent(entityId)}&page=1&pageSize=1`,
        { token },
      );
      expect(list.status(), `GET records for ${entityId} is rejected`).toBe(400);
      const listBody = (await list.json()) as { code?: string };
      expect(listBody.code, `rejection code for ${entityId} list`).toBe('system_entity_records_blocked');

      const register = await apiRequest(request, 'POST', '/api/entities/entities', {
        token,
        data: { entityId, label: 'QA rogue system-entity registration' },
      });
      expect(register.status(), `registering ${entityId} as a custom entity is rejected`).toBe(400);
      const registerBody = (await register.json()) as { code?: string };
      expect(registerBody.code, `registration rejection code for ${entityId}`).toBe('system_entity_records_blocked');
    }
  });

  test('a custom-entity record reads back all values incl. multi-select', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let recordId: string | null = null;
    let entityCreated = false;
    let dictionaryId: string | null = null;
    const dictionaryEntryIds: string[] = [];

    try {
      dictionaryId = await createDictionaryFixture(request, token, {
        key: `qa_ent2055_regions_${Date.now()}`,
        name: 'QA ENT-2055 Regions',
      });
      dictionaryEntryIds.push(
        await createDictionaryEntry(request, token, dictionaryId, 'north', 'North'),
        await createDictionaryEntry(request, token, dictionaryId, 'south', 'South'),
      );

      const createEntity = await apiRequest(request, 'POST', '/api/entities/entities', {
        token,
        data: { entityId: RUNTIME_ENTITY_ID, label: 'QA ENT-2055 Readback Item', description: 'Runtime entity for record readback parity' },
      });
      expect(createEntity.status(), `runtime entity upsert 200: ${createEntity.status()}`).toBe(200);
      entityCreated = true;

      for (const def of buildRuntimeFieldDefs(dictionaryId)) {
        const res = await apiRequest(request, 'POST', '/api/entities/definitions', {
          token,
          data: { entityId: RUNTIME_ENTITY_ID, key: def.key, kind: def.kind, configJson: def.configJson },
        });
        expect(res.status(), `field def ${def.key} upsert 200: ${res.status()}`).toBe(200);
      }

      const create = await apiRequest(request, 'POST', '/api/entities/records', {
        token,
        data: {
          entityId: RUNTIME_ENTITY_ID,
          values: {
            priority: 2,
            severity: 'low',
            blocked: true,
            labels: ['ops'],
            assignee: ['charlie'],
            regions: ['north', 'south'],
            description: 'TC-ENT-2055 round-trip',
          },
        },
      });
      expect(create.status(), `create 200: ${create.status()}`).toBe(200);
      const created = (await create.json()) as { ok?: boolean; item?: { recordId?: string } };
      recordId = created.item?.recordId ?? null;
      expect(typeof recordId, 'recordId present').toBe('string');

      // 1) The just-created live record MUST appear in the list.
      const list = await apiRequest(
        request,
        'GET',
        `/api/entities/records?entityId=${encodeURIComponent(RUNTIME_ENTITY_ID)}&page=1&pageSize=100&sortField=id&sortDir=asc`,
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
      expect(detail!.assignee, 'multi-select listbox field').toEqual(['charlie']);
      expect(detail!.regions, 'multi dictionary field').toEqual(['north', 'south']);
      expect(detail!.description, 'multiline field').toBe('TC-ENT-2055 round-trip');

      const update = await apiRequest(request, 'PUT', '/api/entities/records', {
        token,
        data: {
          entityId: RUNTIME_ENTITY_ID,
          recordId,
          values: {
            priority: 3,
            severity: 'medium',
            blocked: false,
            labels: ['ops', 'qa'],
            assignee: ['alice', 'bob'],
            regions: ['south'],
            description: 'TC-ENT-2055 updated round-trip',
          },
        },
      });
      expect(update.status(), `update 200: ${update.status()}`).toBe(200);
      const updatedDetail = await readById(request, token, recordId as string);
      expect(updatedDetail, 'updated by-id detail returned').toBeTruthy();
      expect(updatedDetail!.priority, 'updated integer field').toBe(3);
      expect(updatedDetail!.severity, 'updated single-select field').toBe('medium');
      expect(updatedDetail!.blocked, 'updated boolean field').toBe(false);
      expect(updatedDetail!.labels, 'updated multi tags field').toEqual(['ops', 'qa']);
      expect(updatedDetail!.assignee, 'updated multi-select listbox field').toEqual(['alice', 'bob']);
      expect(updatedDetail!.regions, 'updated multi dictionary field').toEqual(['south']);
      expect(updatedDetail!.description, 'updated multiline field').toBe('TC-ENT-2055 updated round-trip');
    } finally {
      if (recordId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/entities/records?entityId=${encodeURIComponent(RUNTIME_ENTITY_ID)}&recordId=${encodeURIComponent(recordId)}`,
          { token },
        ).catch(() => {});
      }
      if (entityCreated) {
        await apiRequest(request, 'DELETE', '/api/entities/entities', {
          token,
          data: { entityId: RUNTIME_ENTITY_ID },
        }).catch(() => {});
      }
      if (dictionaryId) {
        for (const entryId of dictionaryEntryIds) {
          await apiRequest(
            request,
            'DELETE',
            `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entryId)}`,
            { token },
          ).catch(() => {});
        }
      }
      if (dictionaryId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/dictionaries/${encodeURIComponent(dictionaryId)}`,
          { token },
        ).catch(() => {});
      }
    }
  });
});
