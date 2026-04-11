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
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomDataSection } from '../detail/CustomDataSection'
import type { CrudField } from '../CrudForm'
import type { CustomFieldDefDto } from '../utils/customFieldDefs'

type WindowWithOriginalFetch = Window & {
  __omOriginalFetch?: typeof fetch
}

describe('CustomDataSection relation display', () => {
  const relationId = '27bf226d-cb46-4535-8181-1a629ebd231b'

  beforeAll(() => {
    registerEntityIds({
      customers: {
        customer_entity: 'customers:customer_entity',
        customer_person_profile: 'customers:customer_person_profile',
        customer_company_profile: 'customers:customer_company_profile',
      },
      catalog: {
        catalog_product_variant: 'catalog:catalog_product_variant',
      },
    })
  })

  afterEach(() => {
    delete (window as WindowWithOriginalFetch).__omOriginalFetch
    jest.restoreAllMocks()
  })

  it('resolves relation UUIDs into linked labels in read-only mode', async () => {
    ;(window as WindowWithOriginalFetch).__omOriginalFetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/api/entities/relations/options?')
      expect(url).toContain(`entityId=${encodeURIComponent('virtual:case_study')}`)
      expect(url).toContain(`ids=${encodeURIComponent(relationId)}`)
      return new Response(
        JSON.stringify({
          items: [
            {
              value: relationId,
              label: 'ERP AI w CGE S.A.',
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

  it('keeps deep links for relation displays that need route context', async () => {
    ;(window as WindowWithOriginalFetch).__omOriginalFetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/api/entities/relations/options?')
      expect(url).toContain(`entityId=${encodeURIComponent('customers:customer_entity')}`)
      expect(url).toContain(`ids=${encodeURIComponent(relationId)}`)
      expect(url).toContain(`routeContextFields=${encodeURIComponent('kind')}`)
      return new Response(
        JSON.stringify({
          items: [
            {
              value: relationId,
              label: 'Ada Lovelace',
              routeContext: { kind: 'person' },
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
        id: 'cf_related_customer',
        label: 'Customer',
        type: 'select',
        options: [{ value: relationId, label: 'Ada Lovelace' }],
      },
    ]
    const definitions: CustomFieldDefDto[] = [
      {
        key: 'related_customer',
        kind: 'relation',
        label: 'Customer',
        optionsUrl: '/api/entities/relations/options?entityId=customers%3Acustomer_entity&labelField=display_name',
      },
    ]

    renderWithProviders(
      <CustomDataSection
        entityId="customers:customer_entity"
        values={{ cf_related_customer: relationId }}
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

    const relationLink = await screen.findByRole('link', { name: 'Ada Lovelace' })
    expect(relationLink).toHaveAttribute(
      'href',
      `/backend/customers/people-v2/${encodeURIComponent(relationId)}`,
    )
  })
})
