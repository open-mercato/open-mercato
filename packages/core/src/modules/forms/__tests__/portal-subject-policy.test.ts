import {
  PORTAL_SUBJECT_TYPE,
  isPortalSubjectAllowed,
  isPortalSubmitAllowed,
  isPortalSubmitForbidden,
} from '../lib/portal-subject-policy'
import { FormSubmission } from '../data/entities'

const CALLER_ID = '0000000a-0000-4000-8000-00000000000a'
const OTHER_ID = '0000000b-0000-4000-8000-00000000000b'
const ORG_ID = '00000000-0000-4000-8000-000000000001'
const TENANT_ID = '00000000-0000-4000-8000-000000000002'
const SUBMISSION_ID = '00000000-0000-4000-8000-0000000000aa'

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

  it('reads the submission in the caller scope and treats a missing row as not forbidden', async () => {
    const findOne = jest.fn()
    const em = { findOne } as never
    const args = { submissionId: SUBMISSION_ID, organizationId: ORG_ID, tenantId: TENANT_ID, customerUserId: CALLER_ID }

    findOne.mockResolvedValueOnce(null)
    await expect(isPortalSubmitForbidden(em, args)).resolves.toBe(false)
    expect(findOne).toHaveBeenCalledWith(FormSubmission, {
      id: SUBMISSION_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      deletedAt: null,
    })

    findOne.mockResolvedValueOnce({ startedBy: CALLER_ID, subjectType: 'customer', subjectId: OTHER_ID })
    await expect(isPortalSubmitForbidden(em, args)).resolves.toBe(true)

    findOne.mockResolvedValueOnce({ startedBy: CALLER_ID, subjectType: 'customer', subjectId: CALLER_ID })
    await expect(isPortalSubmitForbidden(em, args)).resolves.toBe(false)
  })
})
