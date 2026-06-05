import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomEntity,
  createRecord,
  deleteCustomEntityIfExists,
  listRecords,
  saveFieldDefinitions,
  uniqueEntityId,
} from './helpers/entitiesApi';

type ValidationFailure = { error?: string; fields?: Record<string, string> };

/**
 * TC-ENTITIES-005: Field-level validation rejects invalid record values  [P1] (api)
 * Source: issue #2471.
 *
 * POST /api/entities/records validates submitted values against the entity's field
 * definitions and returns 400 { error: 'Validation failed', fields: { cf_<key>: msg } }
 * without persisting the record.
 *
 * Verified contract notes:
 *   - Type checking is rule-driven: a `kind: 'integer'` field only rejects a
 *     non-numeric value when its `configJson.validation` includes an `integer`
 *     (or `date`) rule. The `fields` map is keyed with the `cf_` prefix regardless
 *     of how the value was submitted.
 *   - The endpoint always rejects UNDECLARED keys (mass-assignment guard) with the
 *     `[internal] Unknown custom field` message — covered as a second case.
 */
test.describe('TC-ENTITIES-005: Field-level validation rejects invalid record values', () => {
  test('rejects bad integer/date values and undeclared keys; persists nothing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const entityId = uniqueEntityId('validated');

    try {
      expect((await createCustomEntity(request, token, { entityId, label: 'TC-ENTITIES-005 Entity' })).status()).toBe(200);
      expect(
        (await saveFieldDefinitions(request, token, entityId, [
          { key: 'name', kind: 'text', configJson: { label: 'Name' } },
          { key: 'age', kind: 'integer', configJson: { label: 'Age', validation: [{ rule: 'integer', message: '[internal] age must be an integer' }] } },
          { key: 'birth_date', kind: 'date', configJson: { label: 'Birth date', validation: [{ rule: 'date', message: '[internal] birth_date must be a valid date' }] } },
        ])).status(),
        'field definitions saved',
      ).toBe(200);

      // Case A: declared fields with type rules reject the wrong value types.
      const badTypes = await createRecord(request, token, entityId, {
        name: 'x',
        age: 'not_a_number',
        birth_date: 'invalid-date',
      });
      expect(badTypes.status(), 'invalid integer/date → 400').toBe(400);
      const badBody = await readJsonSafe<ValidationFailure>(badTypes);
      expect(badBody?.error, 'error label').toBe('Validation failed');
      expect(badBody?.fields?.cf_age, 'integer field error reported').toBeTruthy();
      expect(badBody?.fields?.cf_birth_date, 'date field error reported').toBeTruthy();

      // Case B: an undeclared key is rejected by the mass-assignment guard.
      const undeclared = await createRecord(request, token, entityId, { ghost_field: 'injected' });
      expect(undeclared.status(), 'undeclared key → 400').toBe(400);
      const undeclaredBody = await readJsonSafe<ValidationFailure>(undeclared);
      expect(undeclaredBody?.fields?.cf_ghost_field, 'undeclared key flagged').toBe('[internal] Unknown custom field');

      // No record should have been persisted by either rejected request.
      const listRes = await listRecords(request, token, entityId);
      expect(listRes.status(), 'records list 200').toBe(200);
      const listBody = await readJsonSafe<{ total?: number; items?: unknown[] }>(listRes);
      expect(listBody?.total ?? 0, 'no record persisted from invalid submissions').toBe(0);
    } finally {
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });
});
