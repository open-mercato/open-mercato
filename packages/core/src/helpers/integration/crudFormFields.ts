import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean';

/**
 * Pure, runner-agnostic helpers for the CrudForm field-persistence sweep (umbrella #2466).
 *
 * Kept free of any `@playwright/test` import so this logic is unit-testable under jest.
 * The Playwright harness (`crudFormPersistence.ts`) re-exports everything here.
 */

export const CRUDFORM_EXTENSION_TESTS_DISABLED_ENV = 'OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED';

export type CrudRecord = Record<string, unknown>;

/**
 * Reads the sweep disable flag. Default `false` so the sweep runs unless explicitly turned off
 * via `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED=1` (or `true`/`yes`/`on`).
 */
export function crudFormExtensionTestsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanWithDefault(env[CRUDFORM_EXTENSION_TESTS_DISABLED_ENV], false);
}

/**
 * Resolves a custom-field value from a CRUD response record, tolerating every shape the
 * platform emits: bare keys under `customValues`, top-level `cf_<name>` / `cf:<name>`, or a
 * `customFields` definition array carrying `value`. Returns `undefined` when absent.
 */
export function getCustomFieldValue(record: CrudRecord, fieldName: string): unknown {
  const customValues = record.customValues;
  if (customValues && typeof customValues === 'object' && fieldName in (customValues as CrudRecord)) {
    return (customValues as CrudRecord)[fieldName];
  }
  const prefixedUnderscore = record[`cf_${fieldName}`];
  if (prefixedUnderscore !== undefined) return prefixedUnderscore;
  const prefixedColon = record[`cf:${fieldName}`];
  if (prefixedColon !== undefined) return prefixedColon;
  const customFields = record.customFields;
  if (Array.isArray(customFields)) {
    const match = customFields.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as CrudRecord;
      return candidate.key === fieldName || candidate.id === fieldName || candidate.name === fieldName;
    });
    if (match && typeof match === 'object') {
      return (match as CrudRecord).value;
    }
  }
  return undefined;
}
