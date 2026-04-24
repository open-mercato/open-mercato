/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent } from '@testing-library/react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PersonDetailHeader } from '../PersonDetailHeader'

const invalidateCustomerDictionaryMock = jest.fn()

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: jest.fn(() => ({ data: null })),
  invalidateCustomerDictionary: (...args: unknown[]) => invalidateCustomerDictionaryMock(...args),
}))

jest.mock('../PersonTagsDialog', () => ({
  PersonTagsDialog: () => null,
}))

describe('PersonDetailHeader', () => {
  beforeEach(() => {
    invalidateCustomerDictionaryMock.mockReset()
  })

  it('does not render a separate history button when the changelog tab is available', () => {
    renderWithProviders(
      <PersonDetailHeader
        data={{
          person: {
            id: 'person-1',
            displayName: 'Jane Doe',
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
          companies: [],
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

  it('triggers deletion directly from the trash action', () => {
    const onDelete = jest.fn(async () => undefined)

    renderWithProviders(
      <PersonDetailHeader
        data={{
          person: {
            id: 'person-1',
            displayName: 'Jane Doe',
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
          companies: [],
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('does not render a "Link company" CTA in the header (SPEC-2026-04-19 removal)', () => {
    const onOpenCompaniesTab = jest.fn()
    renderWithProviders(
      <PersonDetailHeader
        data={{
          person: {
            id: 'person-1',
            displayName: 'Jane Doe',
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
          companies: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={jest.fn(async () => undefined)}
        isDirty={false}
        isSaving={false}
        onOpenCompaniesTab={onOpenCompaniesTab}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Link company' })).not.toBeInTheDocument()
    expect(onOpenCompaniesTab).not.toHaveBeenCalled()
  })
})
