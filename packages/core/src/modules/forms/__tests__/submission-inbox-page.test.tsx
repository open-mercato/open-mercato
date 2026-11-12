/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ title, data }: { title: React.ReactNode; data: Array<{ id: string }> }) => (
    <div>
      <h1>{title}</h1>
      <span data-testid="row-count">{data.length}</span>
    </div>
  ),
}))

jest.mock('../backend/forms/[id]/submissions/components/SubmissionDrawer', () => ({
  SubmissionDrawer: () => null,
}))

import enDict from '../i18n/en.json'
import FormSubmissionInboxPage from '../backend/forms/[id]/submissions/page'
import { resolvePublishedVersionRoles } from '../backend/forms/[id]/submissions/components/formSummary'

const FORM_ID = '11111111-1111-4111-8111-111111111111'
const PUBLISHED_VERSION_ID = '22222222-2222-4222-8222-222222222222'

function buildFormDetail() {
  return {
    id: FORM_ID,
    key: 'qa_form',
    name: 'QA form',
    description: null,
    status: 'active',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    currentPublishedVersionId: PUBLISHED_VERSION_ID,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    versions: [
      {
        id: PUBLISHED_VERSION_ID,
        versionNumber: 1,
        status: 'published',
        schemaHash: 'hash',
        registryVersion: 'v1',
        publishedAt: '2026-10-01T10:00:00.000Z',
        publishedBy: null,
        changelog: null,
        archivedAt: null,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ],
  }
}

function buildInbox() {
  return {
    items: [
      {
        id: 'sub-1',
        status: 'submitted',
        formVersionNumber: 1,
        revisionCount: 1,
        distinctRoleCount: 1,
        pdfSnapshotAttachmentId: null,
        anonymizedAt: null,
        subjectType: 'anonymous',
        subjectId: '33333333-3333-4333-8333-333333333333',
        submittedAt: '2026-10-01T11:00:00.000Z',
        updatedAt: '2026-10-01T11:00:00.000Z',
        locale: 'en',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  }
}

describe('FormSubmissionInboxPage', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.includes('/submissions')) return { ok: true, status: 200, result: buildInbox() }
      return { ok: true, status: 200, result: buildFormDetail() }
    })
  })

  it('renders the submissions of a published form using the flat form detail response', async () => {
    const { getByText, getByTestId } = renderWithProviders(
      <FormSubmissionInboxPage params={{ id: FORM_ID }} />,
      { dict: enDict },
    )

    await waitFor(() => expect(getByText('QA form — Submissions')).toBeTruthy())
    expect(getByTestId('row-count').textContent).toBe('1')
  })
})

describe('resolvePublishedVersionRoles', () => {
  it('returns no roles when the published version summary carries none', () => {
    expect(resolvePublishedVersionRoles(buildFormDetail())).toEqual([])
  })

  it('returns the roles of the current published version', () => {
    const detail = buildFormDetail()
    expect(
      resolvePublishedVersionRoles({
        ...detail,
        versions: [{ ...detail.versions[0], roles: ['admin', 'patient'] }],
      }),
    ).toEqual(['admin', 'patient'])
  })

  it('returns no roles when the form has no published version', () => {
    expect(resolvePublishedVersionRoles({ ...buildFormDetail(), currentPublishedVersionId: null })).toEqual([])
    expect(resolvePublishedVersionRoles(null)).toEqual([])
  })
})
