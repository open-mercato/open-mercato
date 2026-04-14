/**
 * @jest-environment jsdom
 */
import * as React from 'react'
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
})
