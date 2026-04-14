/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CompanyDetailHeader } from '../CompanyDetailHeader'

const invalidateCustomerDictionaryMock = jest.fn()

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

  it('does not render a separate history button when the changelog tab is the audit entry point', () => {
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

    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
  })
})
