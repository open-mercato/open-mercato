import {
  UNDO_TESTS_DISABLED_ENV,
  undoTestsDisabled,
} from '../undoHarness';

describe('undoTestsDisabled', () => {
  it('defaults to false when the flag is unset', () => {
    expect(undoTestsDisabled({})).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on', 'enabled'])('treats %s as disabled', (value) => {
    expect(undoTestsDisabled({ [UNDO_TESTS_DISABLED_ENV]: value })).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', 'disabled'])('treats %s as enabled', (value) => {
    expect(undoTestsDisabled({ [UNDO_TESTS_DISABLED_ENV]: value })).toBe(false);
  });

  it('falls back to false for unparseable values', () => {
    expect(undoTestsDisabled({ [UNDO_TESTS_DISABLED_ENV]: 'maybe' })).toBe(false);
  });

  it('uses the required env var name', () => {
    expect(UNDO_TESTS_DISABLED_ENV).toBe('OM_INTEGRATION_UNDO_TESTS_DISABLED');
  });
});
