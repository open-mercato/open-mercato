/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { TeamMemberForm } from '../TeamMemberForm'

const TEAM_ID = '11111111-1111-1111-1111-111111111111'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ result: { items: [] } })),
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: () => <div data-testid="lookup-select" />,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  AttachmentsSection: () => <div />,
  TagsSection: () => <div />,
}))

// Render BOTH the group titles and the field labels so that any duplicated
// "Tags" heading (group title + field label pointing at the same key) would
// surface as two matching nodes. This is the regression guarded by issue #2872.
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({
    fields,
    groups,
  }: {
    fields: Array<{ id: string; label?: string }>
    groups: Array<{ id: string; title?: string }>
  }) => (
    <div>
      {(groups || []).map((group) =>
        group.title ? (
          <div key={`group-${group.id}`} data-group-title={group.id}>
            {group.title}
          </div>
        ) : null,
      )}
      {(fields || []).map((field) =>
        field.label && field.label.trim().length > 0 ? (
          <div key={`field-${field.id}`} data-field-label={field.id}>
            {field.label}
          </div>
        ) : null,
      )}
    </div>
  ),
}))

function renderForm() {
  return render(
    <TeamMemberForm
      embedded
      title="Edit team member"
      backHref="/backend/staff/team-members"
      cancelHref="/backend/staff/team-members"
      initialValues={{
        id: '22222222-2222-2222-2222-222222222222',
        teamId: TEAM_ID,
        displayName: 'Priya Nair',
        roleIds: [],
        tags: ['vip'],
        isActive: true,
        updatedAt: '2026-06-01T00:00:00.000Z',
      }}
      onSubmit={async () => {}}
    />,
  )
}

describe('TeamMemberForm tags heading', () => {
  it('renders the "Tags" heading exactly once in the edit view', async () => {
    renderForm()
    await waitFor(() => {
      expect(screen.getAllByText('Tags')).toHaveLength(1)
    })
  })

  it('keeps the "Tags" heading on the group card and clears the redundant field label', async () => {
    renderForm()
    await waitFor(() => {
      expect(screen.getByText('Tags')).toHaveAttribute('data-group-title', 'tags')
    })
    expect(screen.queryByText('Tags', { selector: '[data-field-label]' })).toBeNull()
  })
})
