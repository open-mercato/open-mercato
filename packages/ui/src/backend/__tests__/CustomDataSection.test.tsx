/** @jest-environment jsdom */
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomDataSection } from '../detail/CustomDataSection'
import type { CrudField } from '../CrudForm'
import type { CustomFieldDefDto } from '../utils/customFieldDefs'

type WindowWithOriginalFetch = Window & {
  __omOriginalFetch?: typeof fetch
}

describe('CustomDataSection relation display', () => {
  const relationId = '27bf226d-cb46-4535-8181-1a629ebd231b'

  afterEach(() => {
    delete (window as WindowWithOriginalFetch).__omOriginalFetch
    jest.restoreAllMocks()
  })

  it('resolves relation UUIDs into linked labels in read-only mode', async () => {
    ;(window as WindowWithOriginalFetch).__omOriginalFetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/api/entities/records?')
      expect(url).toContain(`entityId=${encodeURIComponent('virtual:case_study')}`)
      expect(url).toContain(`id=${relationId}`)
      return new Response(
        JSON.stringify({
          items: [
            {
              id: relationId,
              title: 'ERP AI w CGE S.A.',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    const fields: CrudField[] = [
      {
        id: 'cf_subject_of_case_study',
        label: 'Case study',
        type: 'select',
        options: [],
        loadOptions: async () => [],
      },
    ]
    const definitions: CustomFieldDefDto[] = [
      {
        key: 'subject_of_case_study',
        kind: 'relation',
        label: 'Case study',
        optionsUrl: '/api/entities/relations/options?entityId=virtual%3Acase_study&labelField=title',
      },
    ]

    renderWithProviders(
      <CustomDataSection
        entityId="customers:customer_entity"
        values={{ cf_subject_of_case_study: relationId }}
        onSubmit={async () => {}}
        title="Custom fields"
        loadFields={async () => ({ fields, definitions })}
        labels={{
          loading: 'Loading custom data…',
          emptyValue: 'No value',
          noFields: 'No fields',
          saveShortcut: 'Save now',
          edit: 'Edit',
          cancel: 'Cancel',
        }}
      />,
    )

    const relationLink = await screen.findByRole('link', { name: 'ERP AI w CGE S.A.' })
    expect(relationLink).toHaveAttribute(
      'href',
      `/backend/entities/user/${encodeURIComponent('virtual:case_study')}/records/${encodeURIComponent(relationId)}`,
    )

    fireEvent.click(relationLink)
    expect(screen.queryByRole('button', { name: 'Save now' })).not.toBeInTheDocument()
  })
})
