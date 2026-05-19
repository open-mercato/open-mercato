/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CompanyDetailHeader } from '../CompanyDetailHeader'

const invalidateCustomerDictionaryMock = jest.fn()
const mockSendObjectMessageDialog = jest.fn()

jest.mock('@open-mercato/ui/backend/messages', () => ({
  SendObjectMessageDialog: (props: Record<string, unknown>) => {
    mockSendObjectMessageDialog(props)
    return <button type="button">Send message</button>
  },
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: jest.fn(() => ({ data: null })),
  invalidateCustomerDictionary: (...args: unknown[]) => invalidateCustomerDictionaryMock(...args),
}))

jest.mock('../CompanyTagsDialog', () => ({
  CompanyTagsDialog: ({ open }: { open: boolean }) => (
    open ? <div>company-tags-dialog</div> : null
  ),
}))

describe('CompanyDetailHeader', () => {
  beforeEach(() => {
    invalidateCustomerDictionaryMock.mockReset()
    mockSendObjectMessageDialog.mockReset()
  })

  it('opens the company record tags dialog from the edit tags action', () => {
    renderWithProviders(
      <CompanyDetailHeader
        data={{
          company: {
            id: 'company-1',
            displayName: 'Acme Corp',
            organizationId: 'org-1',
            status: null,
            lifecycleStage: null,
            source: null,
            temperature: null,
            renewalQuarter: null,
          },
          profile: null,
          customFields: {},
          tags: [],
          comments: [],
          activities: [],
          interactions: [],
          deals: [],
          todos: [],
          people: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={jest.fn(async () => undefined)}
        isDirty={false}
        isSaving={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }))

    expect(screen.getByText('company-tags-dialog')).toBeInTheDocument()
  })

  it('renders the object history trigger in the header action cluster', () => {
    renderWithProviders(
      <CompanyDetailHeader
        data={{
          company: {
            id: 'company-1',
            displayName: 'Acme Corp',
            organizationId: 'org-1',
            status: null,
            lifecycleStage: null,
            source: null,
            temperature: null,
            renewalQuarter: null,
          },
          profile: null,
          customFields: {},
          tags: [],
          comments: [],
          activities: [],
          interactions: [],
          deals: [],
          todos: [],
          people: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={jest.fn(async () => undefined)}
        isDirty={false}
        isSaving={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'audit_logs.version_history.title' })).toBeInTheDocument()
  })

  it('renders the send-message trigger in the header action cluster', () => {
    renderWithProviders(
      <CompanyDetailHeader
        data={{
          company: {
            id: 'company-1',
            displayName: 'Acme Corp',
            organizationId: 'org-1',
            primaryEmail: 'hello@acme.test',
            status: null,
            lifecycleStage: null,
            source: null,
            temperature: null,
            renewalQuarter: null,
          },
          profile: null,
          customFields: {},
          tags: [],
          comments: [],
          activities: [],
          interactions: [],
          deals: [],
          todos: [],
          people: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={jest.fn(async () => undefined)}
        isDirty={false}
        isSaving={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    expect(mockSendObjectMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      object: expect.objectContaining({
        entityModule: 'customers',
        entityType: 'company',
        entityId: 'company-1',
      }),
      buttonVariant: 'outline',
      buttonSize: 'icon',
    }))
  })

  it('triggers deletion directly from the trash action', () => {
    const onDelete = jest.fn(async () => undefined)

    renderWithProviders(
      <CompanyDetailHeader
        data={{
          company: {
            id: 'company-1',
            displayName: 'Acme Corp',
            organizationId: 'org-1',
            status: null,
            lifecycleStage: null,
            source: null,
            temperature: null,
            renewalQuarter: null,
          },
          profile: null,
          customFields: {},
          tags: [],
          comments: [],
          activities: [],
          interactions: [],
          deals: [],
          todos: [],
          people: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={onDelete}
        isDirty={false}
        isSaving={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete company' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
