import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-SALES-CRUDFORM-001: Sales Channel CrudForm persists scalars + custom fields (#2466).
 *
 * Sales channels are the sales-module rich-field surface: scalars (name, code, description,
 * isActive, websiteUrl, contactEmail, address fields) plus custom fields of several kinds
 * (text, integer, boolean, single-select) and a multi-select array. Proves create + update
 * round-trip every value.
 *
 * Notes from the verified API contract:
 * - The list GET filters by `?ids=` (comma-separated), so a custom `readById`.
 * - Request bodies are camelCase; the channel list response returns scalars camelCase (`isActive`,
 *   `websiteUrl`, ...) and custom fields under `customValues` (a bare-key object) plus a
 *   `customFields` definition array — both already handled by the harness `getCustomFieldValue`.
 * - `channelUpdateSchema` requires `id` AND `code`; PUT is a partial update so omitted scalars
 *   and omitted custom fields are retained.
 * - Custom fields submit as `cf_<key>`. Sales channels declare no default custom fields, so the
 *   spec creates its own definitions via the entities API and tombstones them in `finally`
 *   (self-contained). Keys are stamped per run so retries/parallel workers never collide.
 * - The native `statusEntryId` dictionary reference is intentionally omitted: it requires a
 *   dictionary-entry fixture with no self-contained helper (mirrors the resources spec deferring
 *   `capacityUnitValue`). The dictionary/multiselect dimension is covered by the multi-select CF.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const CHANNELS_PATH = '/api/sales/channels';
const DEFINITIONS_PATH = '/api/entities/definitions';
const CHANNEL_ENTITY_ID = 'sales:sales_channel';

type ChannelCustomFieldDefinition = {
  key: string;
  kind: string;
  label: string;
  multi?: boolean;
  options?: string[];
};

async function createChannelCustomFieldDefinition(
  request: APIRequestContext,
  token: string,
  input: ChannelCustomFieldDefinition,
): Promise<void> {
  const configJson: CrudRecord = { label: input.label };
  if (input.multi !== undefined) configJson.multi = input.multi;
  if (input.options) configJson.options = input.options;
  const response = await apiRequest(request, 'POST', DEFINITIONS_PATH, {
    token,
    data: { entityId: CHANNEL_ENTITY_ID, key: input.key, kind: input.kind, configJson },
  });
  expect(
    response.status(),
    `POST ${DEFINITIONS_PATH} should create channel custom field "${input.key}"`,
  ).toBe(200);
}

async function deleteChannelCustomFieldDefinition(
  request: APIRequestContext,
  token: string | null,
  key: string,
): Promise<void> {
  if (!token) return;
  const response = await apiRequest(request, 'DELETE', DEFINITIONS_PATH, {
    token,
    data: { entityId: CHANNEL_ENTITY_ID, key },
  });
  expect([200, 404]).toContain(response.status());
}

// Custom-field multi-select rows have no guaranteed read order, so normalize array values to a
// stable sort before the harness compares them (the catalog CF multi-select spec does the same).
// The channel list response exposes custom fields under `customValues` (a bare-key object), which
// `getCustomFieldValue` reads first, so sort the array values held there.
function normalizeArrayCustomFields(record: CrudRecord | null): CrudRecord | null {
  if (!record) return record;
  const customValues = record.customValues;
  if (customValues && typeof customValues === 'object' && !Array.isArray(customValues)) {
    for (const [key, value] of Object.entries(customValues as CrudRecord)) {
      if (Array.isArray(value)) {
        (customValues as CrudRecord)[key] = [...value].map((entry) => String(entry)).sort();
      }
    }
  }
  return record;
}

async function readChannelByIds(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${CHANNELS_PATH}?ids=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back sales channels failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  const record = (body?.items ?? []).find((item) => item.id === id) ?? null;
  return normalizeArrayCustomFields(record);
}

test.describe('TC-SALES-CRUDFORM-001: Sales Channel CrudForm persists scalars + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars + custom fields (text/integer/boolean/select) and a multi-select on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const tierKey = `tier_${stamp}`;
    const priorityKey = `priority_${stamp}`;
    const memoKey = `memo_${stamp}`;
    const featuredKey = `featured_${stamp}`;
    const regionsKey = `regions_${stamp}`;
    const definitionKeys = [tierKey, priorityKey, memoKey, featuredKey, regionsKey];

    try {
      await createChannelCustomFieldDefinition(request, token, {
        key: tierKey,
        kind: 'select',
        label: 'Channel Tier',
        options: ['bronze', 'silver', 'gold'],
      });
      await createChannelCustomFieldDefinition(request, token, { key: priorityKey, kind: 'integer', label: 'Channel Priority' });
      await createChannelCustomFieldDefinition(request, token, { key: memoKey, kind: 'text', label: 'Channel Memo' });
      await createChannelCustomFieldDefinition(request, token, { key: featuredKey, kind: 'boolean', label: 'Channel Featured' });
      await createChannelCustomFieldDefinition(request, token, {
        key: regionsKey,
        kind: 'select',
        label: 'Channel Regions',
        multi: true,
        options: ['emea', 'amer', 'apac'],
      });

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: CHANNELS_PATH,
        readById: (id) => readChannelByIds(request, token, id),
        create: {
          payload: {
            name: `QA CRUDFORM Channel ${stamp}`,
            code: `qa-crudform-${stamp}`,
            description: 'Original channel description',
            isActive: true,
            websiteUrl: 'https://qa-crudform.example.com',
            contactEmail: 'qa-crudform@example.com',
            city: 'Warsaw',
            region: 'Mazovia',
            postalCode: '00-001',
            country: 'PL',
            [`cf_${tierKey}`]: 'gold',
            [`cf_${priorityKey}`]: 3,
            [`cf_${memoKey}`]: 'Original channel memo',
            [`cf_${featuredKey}`]: true,
            [`cf_${regionsKey}`]: ['emea', 'apac'],
          },
        },
        expectAfterCreate: {
          scalars: {
            name: `QA CRUDFORM Channel ${stamp}`,
            code: `qa-crudform-${stamp}`,
            description: 'Original channel description',
            isActive: true,
            websiteUrl: 'https://qa-crudform.example.com',
            contactEmail: 'qa-crudform@example.com',
            city: 'Warsaw',
            region: 'Mazovia',
            postalCode: '00-001',
            country: 'PL',
          },
          customFields: {
            [tierKey]: 'gold',
            [priorityKey]: 3,
            [memoKey]: 'Original channel memo',
            [featuredKey]: true,
            [regionsKey]: ['apac', 'emea'],
          },
        },
        update: {
          payload: (id) => ({
            id,
            code: `qa-crudform-${stamp}`,
            name: `QA CRUDFORM Channel ${stamp} EDITED`,
            description: 'Updated channel description',
            isActive: false,
            websiteUrl: 'https://qa-crudform-edited.example.com',
            city: 'Krakow',
            [`cf_${tierKey}`]: 'silver',
            [`cf_${priorityKey}`]: 7,
            [`cf_${featuredKey}`]: false,
            [`cf_${regionsKey}`]: ['amer', 'emea'],
          }),
        },
        expectAfterUpdate: {
          scalars: {
            name: `QA CRUDFORM Channel ${stamp} EDITED`,
            code: `qa-crudform-${stamp}`,
            description: 'Updated channel description',
            isActive: false,
            websiteUrl: 'https://qa-crudform-edited.example.com',
            city: 'Krakow',
            region: 'Mazovia',
            country: 'PL',
          },
          customFields: {
            [tierKey]: 'silver',
            [priorityKey]: 7,
            [featuredKey]: false,
            [regionsKey]: ['amer', 'emea'],
            [memoKey]: 'Original channel memo',
          },
        },
      });
    } finally {
      for (const key of definitionKeys) {
        await deleteChannelCustomFieldDefinition(request, token, key);
      }
    }
  });
});
