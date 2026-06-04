import {
  CRUDFORM_EXTENSION_TESTS_DISABLED_ENV,
  crudFormExtensionTestsDisabled,
  getCustomFieldValue,
} from '../crudFormFields';

describe('crudFormExtensionTestsDisabled', () => {
  it('defaults to false when the flag is unset (sweep runs)', () => {
    expect(crudFormExtensionTestsDisabled({})).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on', 'enabled'])('treats %s as disabled', (value) => {
    expect(crudFormExtensionTestsDisabled({ [CRUDFORM_EXTENSION_TESTS_DISABLED_ENV]: value })).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', 'disabled'])('treats %s as enabled (sweep runs)', (value) => {
    expect(crudFormExtensionTestsDisabled({ [CRUDFORM_EXTENSION_TESTS_DISABLED_ENV]: value })).toBe(false);
  });

  it('falls back to false for unparseable values', () => {
    expect(crudFormExtensionTestsDisabled({ [CRUDFORM_EXTENSION_TESTS_DISABLED_ENV]: 'maybe' })).toBe(false);
  });

  it('uses the real env name', () => {
    expect(CRUDFORM_EXTENSION_TESTS_DISABLED_ENV).toBe('OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED');
  });
});

describe('getCustomFieldValue', () => {
  it('reads a bare key from customValues', () => {
    expect(getCustomFieldValue({ customValues: { priority: 3 } }, 'priority')).toBe(3);
  });

  it('reads a top-level cf_ prefixed key', () => {
    expect(getCustomFieldValue({ cf_severity: 'high' }, 'severity')).toBe('high');
  });

  it('reads a top-level cf: prefixed key', () => {
    expect(getCustomFieldValue({ 'cf:blocked': true }, 'blocked')).toBe(true);
  });

  it('reads a value from a customFields definition array', () => {
    const record = { customFields: [{ key: 'labels', value: ['a', 'b'] }] };
    expect(getCustomFieldValue(record, 'labels')).toEqual(['a', 'b']);
  });

  it('prefers customValues over a redundant cf_ key', () => {
    expect(getCustomFieldValue({ customValues: { priority: 5 }, cf_priority: 1 }, 'priority')).toBe(5);
  });

  it('preserves an explicit null under customValues (presence beats fallthrough)', () => {
    expect(getCustomFieldValue({ customValues: { description: null }, cf_description: 'stale' }, 'description')).toBeNull();
  });

  it('returns undefined when the field is absent everywhere', () => {
    expect(getCustomFieldValue({ customValues: { other: 1 } }, 'priority')).toBeUndefined();
  });
});
