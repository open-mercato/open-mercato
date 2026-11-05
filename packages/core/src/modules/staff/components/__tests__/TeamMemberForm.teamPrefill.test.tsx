/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { TeamMemberForm } from '../TeamMemberForm'

const TEAM_ID = '11111111-1111-1111-1111-111111111111'
const TEAM_NAME = 'Engineering'

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
  apiCall: jest.fn(async (url: string) => {
    if (url.includes('/api/staff/teams')) {
      return { result: { items: [{ id: TEAM_ID, name: TEAM_NAME }] } }
    }
    return { result: { items: [] } }
  }),
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: () => <div data-testid="lookup-select" />,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  AttachmentsSection: () => <div />,
  TagsSection: () => <div />,
}))

// Surface `<SelectValue>` children into the trigger so the test can assert the
// pre-selected team label renders (the fix). The real Radix `Select` shows the
// placeholder until content opens unless the label is passed as SelectValue
// children — exactly what this test guards against.
jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="team-select-trigger">{children}</div>
  ),
  SelectValue: ({ children, placeholder }: { children?: React.ReactNode; placeholder?: string }) => (
    <span>{children ?? placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="team-select-content">{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Render only the custom field components so the real teamId field logic runs.
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({
    fields,
    initialValues,
  }: {
    fields: Array<{ id: string; type: string; component?: (props: Record<string, unknown>) => React.ReactNode }>
    initialValues: Record<string, unknown>
  }) => (
    <div>
      {(fields || []).map((field) =>
        field.type === 'custom' && field.component ? (
          <div key={field.id} data-field={field.id}>
            {field.component({
              value: initialValues?.[field.id],
              setValue: () => {},
              setFormValue: () => {},
              values: initialValues,
              disabled: false,
            })}
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
        isActive: true,
        updatedAt: '2026-06-01T00:00:00.000Z',
      }}
      onSubmit={async () => {}}
    />,
  )
}

describe('TeamMemberForm team select prefill', () => {
  it('renders the saved team label inside the select trigger on edit', async () => {
    renderForm()
    await screen.findByTestId('team-select-trigger')
    await waitFor(() => {
      const teamField = screen.getByTestId('team-select-trigger')
      expect(within(teamField).getByText(TEAM_NAME)).toBeInTheDocument()
    })
  })
})
