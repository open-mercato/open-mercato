import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-FT-CRUDFORM-001: Global feature toggle CrudForm persists scalars + typed default value (#2466).
 *
 * The single feature_toggles CrudForm surface is the global toggle (Tier C — scalar surface,
 * no custom fields). Its persistence risk lives in the `type` + `defaultValue` pair: the value
 * is `jsonb`, so its shape depends on `type` (boolean / string / number / json), and a partial
 * edit must not drop either field — exactly the regression fixed in #2524/#2528 ("hydrate
 * global edit form Type/Default Value"). This spec proves create + update round-trip every
 * scalar for all four toggle types. It complements TC-FT-004 (type-hydration for a single
 * `number` toggle) by sweeping all four types and additionally proving the falsy defaults
 * (`false`/`0`) and nested json values survive the update command's `?? existing` merge.
 *
 * Verified contract:
 * - Writing a global toggle requires the **super administrator** (`feature_toggles.global.manage`,
 *   enforced by `assertGlobalToggleSuperAdmin`), so this authenticates as `superadmin`, not `admin`.
 * - `/api/feature_toggles/global` is a `makeCrudRoute` collection route: POST → 201, PUT → 200
 *   (id in body), DELETE → 200 (`?id=`). The harness defaults match, so no status overrides.
 * - Read-back uses the detail GET `/api/feature_toggles/global/[id]` — the same endpoint the edit
 *   page loads to hydrate the form (#2524). The toggle is platform-wide (no tenant_id), and the
 *   detail route returns the record directly; the harness resolves that direct-record shape.
 * - Request bodies are camelCase; `defaultValue` round-trips verbatim through jsonb (incl. the
 *   falsy values `false`/`0` and nested object/array values).
 * - The update payload intentionally omits `identifier` and `type` so a partial save proves both
 *   survive (the #2524 regression), while name/description/category/defaultValue change.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const GLOBAL_PATH = '/api/feature_toggles/global';

type ToggleType = 'boolean' | 'string' | 'number' | 'json';

type TypedToggleCase = {
  type: ToggleType;
  title: string;
  createValue: unknown;
  updateValue: unknown;
};

// feature_toggles.identifier is globally unique (no tenant scoping on the column), so use crypto
// randomness to stay collision-free across parallel Playwright workers and avoid the CodeQL
// insecure-randomness flag on Math.random(). The pattern `^[a-z][a-z0-9_.-]*$` is satisfied by the
// leading `qa_ft_crudform_` prefix plus the hex UUID body.
function uniqueIdentifier(kind: ToggleType): string {
  return `qa_ft_crudform_${kind}_${randomUUID().replace(/-/g, '')}`;
}

async function readToggleById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(request, 'GET', `${GLOBAL_PATH}/${encodeURIComponent(id)}`, { token });
  if (response.status() === 404) return null;
  expect(response.status(), `read-back feature toggle failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<CrudRecord>(response);
  return body && body.id === id ? body : null;
}

const TYPED_CASES: TypedToggleCase[] = [
  // Boolean true → false proves the falsy default survives the update command's `?? existing` merge.
  { type: 'boolean', title: 'boolean toggle round-trips scalars + boolean default (true → false)', createValue: true, updateValue: false },
  { type: 'string', title: 'string toggle round-trips scalars + string default', createValue: 'flag-original', updateValue: 'flag-edited' },
  // Number 42 → 0 proves the falsy numeric default survives the update as well.
  { type: 'number', title: 'number toggle round-trips scalars + numeric default (42 → 0)', createValue: 42, updateValue: 0 },
  {
    type: 'json',
    title: 'json toggle round-trips scalars + nested object/array default',
    createValue: { enabled: true, threshold: 10, tiers: ['alpha', 'beta'] },
    updateValue: { enabled: false, threshold: 99, tiers: ['gamma'] },
  },
];

test.describe('TC-FT-CRUDFORM-001: Global feature toggle CrudForm persists scalars + typed default value', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  for (const toggleCase of TYPED_CASES) {
    test(toggleCase.title, async ({ request }) => {
      const token = await getAuthToken(request, 'superadmin');
      const stamp = Date.now();
      const identifier = uniqueIdentifier(toggleCase.type);
      const baseName = `QA CRUDFORM Toggle ${toggleCase.type} ${stamp}`;

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: GLOBAL_PATH,
        readById: (id) => readToggleById(request, token, id),
        create: {
          payload: {
            identifier,
            name: baseName,
            description: 'Original toggle description',
            category: 'qa-crudform',
            type: toggleCase.type,
            defaultValue: toggleCase.createValue,
          },
        },
        expectAfterCreate: {
          scalars: {
            identifier,
            name: baseName,
            description: 'Original toggle description',
            category: 'qa-crudform',
            type: toggleCase.type,
            defaultValue: toggleCase.createValue,
          },
        },
        update: {
          // Partial save: omit identifier + type so the round-trip proves both survive (#2524).
          payload: (id) => ({
            id,
            name: `${baseName} EDITED`,
            description: 'Updated toggle description',
            category: 'qa-crudform-edited',
            defaultValue: toggleCase.updateValue,
          }),
        },
        expectAfterUpdate: {
          scalars: {
            identifier,
            name: `${baseName} EDITED`,
            description: 'Updated toggle description',
            category: 'qa-crudform-edited',
            type: toggleCase.type,
            defaultValue: toggleCase.updateValue,
          },
        },
      });
    });
  }
});
