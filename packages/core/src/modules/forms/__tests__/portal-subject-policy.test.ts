import {
  PORTAL_SUBJECT_TYPE,
  isPortalSubjectAllowed,
  isPortalSubmitAllowed,
} from '../lib/portal-subject-policy'

const CALLER_ID = '0000000a-0000-4000-8000-00000000000a'
const OTHER_ID = '0000000b-0000-4000-8000-00000000000b'

describe('portal subject policy (#7224)', () => {
  it('allows only the caller\'s own customer subject', () => {
    expect(PORTAL_SUBJECT_TYPE).toBe('customer')
    expect(isPortalSubjectAllowed(CALLER_ID, { subjectType: 'customer', subjectId: CALLER_ID })).toBe(true)
    expect(isPortalSubjectAllowed(CALLER_ID, { subjectType: 'customer', subjectId: OTHER_ID })).toBe(false)
    expect(isPortalSubjectAllowed(CALLER_ID, { subjectType: 'person', subjectId: CALLER_ID })).toBe(false)
    expect(isPortalSubjectAllowed(CALLER_ID, { subjectType: 'Customer', subjectId: CALLER_ID })).toBe(false)
    expect(isPortalSubjectAllowed(CALLER_ID, { subjectType: 'forms_invitation', subjectId: CALLER_ID })).toBe(false)
  })

  it('compares ids case-insensitively on both sides', () => {
    expect(isPortalSubjectAllowed(CALLER_ID.toUpperCase(), { subjectType: 'customer', subjectId: CALLER_ID })).toBe(true)
    expect(isPortalSubjectAllowed(CALLER_ID, { subjectType: 'customer', subjectId: CALLER_ID.toUpperCase() })).toBe(true)
    expect(
      isPortalSubmitAllowed(CALLER_ID, {
        startedBy: CALLER_ID.toUpperCase(),
        subjectType: 'customer',
        subjectId: OTHER_ID,
      }),
    ).toBe(false)
  })

  it('re-checks the subject only for submissions the caller started', () => {
    expect(isPortalSubmitAllowed(CALLER_ID, { startedBy: CALLER_ID, subjectType: 'customer', subjectId: CALLER_ID })).toBe(true)
    expect(isPortalSubmitAllowed(CALLER_ID, { startedBy: CALLER_ID, subjectType: 'customer', subjectId: OTHER_ID })).toBe(false)
    expect(isPortalSubmitAllowed(CALLER_ID, { startedBy: CALLER_ID, subjectType: 'patient', subjectId: CALLER_ID })).toBe(false)
    expect(isPortalSubmitAllowed(CALLER_ID, { startedBy: OTHER_ID, subjectType: 'patient', subjectId: OTHER_ID })).toBe(true)
  })

})
