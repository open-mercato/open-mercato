/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => false,
  }),
}))

import enDict from '../i18n/en.json'
import { SubmissionDrawer } from '../backend/forms/[id]/submissions/components/SubmissionDrawer'

const FORM_ID = '11111111-1111-4111-8111-111111111111'
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333'
const REVISION_ONE_ID = '44444444-4444-4444-8444-444444444444'
const REVISION_TWO_ID = '55555555-5555-4555-8555-555555555555'

function buildRevision(id: string, revisionNumber: number) {
  return {
    id,
    submissionId: SUBMISSION_ID,
    revisionNumber,
    encryptionKeyVersion: 1,
    savedAt: '2026-10-07T20:56:34.000Z',
    savedBy: 'user-1',
    savedByRole: 'respondent',
    changeSource: 'user',
    changedFieldKeys: ['answer'],
    changeSummary: null,
    anonymizedAt: null,
  }
}

function mockSubmissionApi() {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/revisions')) {
      return {
        ok: true,
        status: 200,
        result: {
          submission: { id: SUBMISSION_ID, status: 'submitted' },
          revisions: [buildRevision(REVISION_TWO_ID, 2), buildRevision(REVISION_ONE_ID, 1)],
        },
      }
    }
    return {
      ok: true,
      status: 200,
      result: {
        submission: {
          id: SUBMISSION_ID,
          status: 'submitted',
          subjectType: 'forms_invitation',
          subjectId: 'subject-1',
          anonymizedAt: null,
          pdfSnapshotAttachmentId: null,
        },
        revision: buildRevision(REVISION_TWO_ID, 2),
        decoded_data: { answer: 'Yes' },
        actors: [],
        formVersion: { id: 'version-1', versionNumber: 3, roles: ['respondent', 'reviewer'] },
      },
    }
  })
}

describe('SubmissionDrawer', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('renders the revision timeline from the revisions endpoint response (#7062)', async () => {
    mockSubmissionApi()
    renderWithProviders(
      <SubmissionDrawer
        formId={FORM_ID}
        submissionId={SUBMISSION_ID}
        formVersionRoles={[]}
        onClose={() => {}}
      />,
      { dict: enDict },
    )

    await waitFor(() => expect(screen.getByText('#1')).toBeTruthy())
    expect(screen.getByText('#2')).toBeTruthy()
    expect(screen.getAllByText(/— v3/).length).toBeGreaterThan(0)
  })
})
