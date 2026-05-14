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
          loading: 'Loading custom data\u2026',
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
          loading: 'Loading custom data\u2026',
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

  it('renders text/richtext fields as markdown even when relation displays are empty', async () => {
    ;(window as WindowWithOriginalFetch).__omOriginalFetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({ items: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const fields: CrudField[] = [
      {
        id: 'cf_notes',
        label: 'Notes',
        type: 'richtext',
      },
      {
        id: 'cf_linked_case',
        label: 'Linked case',
        type: 'select',
        options: [],
        loadOptions: async () => [],
      },
    ]
    const definitions: CustomFieldDefDto[] = [
      {
        key: 'notes',
        kind: 'richtext',
        label: 'Notes',
      },
      {
        key: 'linked_case',
        kind: 'relation',
        label: 'Linked case',
        optionsUrl: '/api/entities/relations/options?entityId=virtual%3Acase_study&labelField=title',
      },
    ]

    renderWithProviders(
      <CustomDataSection
        entityId="customers:customer_entity"
        values={{ cf_notes: '**Bold note**', cf_linked_case: relationId }}
        onSubmit={async () => {}}
        title="Custom fields"
        loadFields={async () => ({ fields, definitions })}
        labels={{
          loading: 'Loading custom data\u2026',
          emptyValue: 'No value',
          noFields: 'No fields',
          saveShortcut: 'Save now',
          edit: 'Edit',
          cancel: 'Cancel',
        }}
      />,
    )

    const notesContent = await screen.findByText('**Bold note**')
    expect(notesContent).toBeInTheDocument()
    expect(notesContent.className).toContain('text-sm')
  })

  it('renders select values from bare custom-field response keys', async () => {
    const fields: CrudField[] = [
      {
        id: 'cf_buying_role',
        label: 'Buying role',
        type: 'select',
        options: [
          { value: 'economic_buyer', label: 'Economic buyer' },
          { value: 'champion', label: 'Champion' },
          { value: 'technical_evaluator', label: 'Technical evaluator' },
          { value: 'influencer', label: 'Influencer' },
        ],
      },
      {
        id: 'cf_relationship_health',
        label: 'Relationship health',
        type: 'select',
        options: [
          { value: 'healthy', label: 'Healthy' },
          { value: 'monitor', label: 'Monitor' },
          { value: 'at_risk', label: 'At risk' },
        ],
      },
      {
        id: 'cf_renewal_quarter',
        label: 'Renewal quarter',
        type: 'select',
        options: [
          { value: 'Q1', label: 'Q1' },
          { value: 'Q2', label: 'Q2' },
          { value: 'Q3', label: 'Q3' },
          { value: 'Q4', label: 'Q4' },
        ],
      },
    ]
    const definitions: CustomFieldDefDto[] = [
      {
        key: 'buying_role',
        kind: 'select',
        label: 'Buying role',
      },
      {
        key: 'relationship_health',
        kind: 'select',
        label: 'Relationship health',
      },
      {
        key: 'renewal_quarter',
        kind: 'select',
        label: 'Renewal quarter',
      },
    ]

    renderWithProviders(
      <CustomDataSection
        entityIds={['customers:customer_person_profile', 'customers:customer_company_profile']}
        values={{ buying_role: 'champion', relationship_health: 'monitor', renewal_quarter: 'Q4' }}
        onSubmit={async () => {}}
        title="Custom fields"
        loadFields={async () => ({ fields, definitions })}
        labels={{
          loading: 'Loading custom data\u2026',
          emptyValue: 'No value',
          noFields: 'No fields',
          saveShortcut: 'Save now',
          edit: 'Edit',
          cancel: 'Cancel',
        }}
      />,
    )

    expect(await screen.findByText('Champion')).toBeInTheDocument()
    expect(await screen.findByText('Monitor')).toBeInTheDocument()
    expect(screen.getByText('Q4')).toBeInTheDocument()
  })

  it('resolves customer_person_profile with entity_id route context', async () => {
    const entityId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const profileId = 'pppppppp-1111-2222-3333-444444444444'

    ;(window as WindowWithOriginalFetch).__omOriginalFetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          items: [
            {
              value: profileId,
              label: 'John Doe Profile',
              routeContext: { entity_id: entityId },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const fields: CrudField[] = [
      {
        id: 'cf_person_profile',
        label: 'Person Profile',
        type: 'select',
        options: [],
        loadOptions: async () => [],
      },
    ]
    const definitions: CustomFieldDefDto[] = [
      {
        key: 'person_profile',
        kind: 'relation',
        label: 'Person Profile',
        optionsUrl: '/api/entities/relations/options?entityId=customers%3Acustomer_person_profile&labelField=title',
      },
    ]

    renderWithProviders(
      <CustomDataSection
        entityId="customers:customer_entity"
        values={{ cf_person_profile: profileId }}
        onSubmit={async () => {}}
        title="Custom fields"
        loadFields={async () => ({ fields, definitions })}
        labels={{
          loading: 'Loading custom data\u2026',
          emptyValue: 'No value',
          noFields: 'No fields',
          saveShortcut: 'Save now',
          edit: 'Edit',
          cancel: 'Cancel',
        }}
      />,
    )

    const link = await screen.findByRole('link', { name: 'John Doe Profile' })
    expect(link).toHaveAttribute(
      'href',
      `/backend/customers/people-v2/${encodeURIComponent(entityId)}`,
    )
  })

  it('resolves catalog_product_variant with product_id route context', async () => {
    const productId = 'pppppppp-aaaa-bbbb-cccc-dddddddddddd'
    const variantId = 'vvvvvvvv-1111-2222-3333-444444444444'

    ;(window as WindowWithOriginalFetch).__omOriginalFetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          items: [
            {
              value: variantId,
              label: 'Variant XL Red',
              routeContext: { product_id: productId },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const fields: CrudField[] = [
      {
        id: 'cf_variant_ref',
        label: 'Product Variant',
        type: 'select',
        options: [],
        loadOptions: async () => [],
      },
    ]
    const definitions: CustomFieldDefDto[] = [
      {
        key: 'variant_ref',
        kind: 'relation',
        label: 'Product Variant',
        optionsUrl: '/api/entities/relations/options?entityId=catalog%3Acatalog_product_variant&labelField=title',
      },
    ]

    renderWithProviders(
      <CustomDataSection
        entityId="customers:customer_entity"
        values={{ cf_variant_ref: variantId }}
        onSubmit={async () => {}}
        title="Custom fields"
        loadFields={async () => ({ fields, definitions })}
        labels={{
          loading: 'Loading custom data\u2026',
          emptyValue: 'No value',
          noFields: 'No fields',
          saveShortcut: 'Save now',
          edit: 'Edit',
          cancel: 'Cancel',
        }}
      />,
    )

    const link = await screen.findByRole('link', { name: 'Variant XL Red' })
    expect(link).toHaveAttribute(
      'href',
      `/backend/catalog/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
    )
  })

  it('falls back gracefully on API error', async () => {
    ;(window as WindowWithOriginalFetch).__omOriginalFetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
    })

    const fields: CrudField[] = [
      {
        id: 'cf_some_relation',
        label: 'Some Relation',
        type: 'select',
        options: [],
        loadOptions: async () => [],
      },
    ]
    const definitions: CustomFieldDefDto[] = [
      {
        key: 'some_relation',
        kind: 'relation',
        label: 'Some Relation',
        optionsUrl: '/api/entities/relations/options?entityId=virtual%3Aexample&labelField=title',
      },
    ]

    renderWithProviders(
      <CustomDataSection
        entityId="customers:customer_entity"
        values={{ cf_some_relation: relationId }}
        onSubmit={async () => {}}
        title="Custom fields"
        loadFields={async () => ({ fields, definitions })}
        labels={{
          loading: 'Loading custom data\u2026',
          emptyValue: 'No value',
          noFields: 'No fields',
          saveShortcut: 'Save now',
          edit: 'Edit',
          cancel: 'Cancel',
        }}
      />,
    )

    const fallbackText = await screen.findByText(relationId)
    expect(fallbackText).toBeInTheDocument()
  })

  it('resolves multi-value relation fields (array of UUIDs)', async () => {
    const id1 = 'aaaaaaaa-1111-2222-3333-444444444444'
    const id2 = 'bbbbbbbb-1111-2222-3333-444444444444'

    ;(window as WindowWithOriginalFetch).__omOriginalFetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          items: [
            { value: id1, label: 'Record Alpha' },
            { value: id2, label: 'Record Beta' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const fields: CrudField[] = [
      {
        id: 'cf_multi_relation',
        label: 'Multi Relation',
        type: 'multiselect',
        options: [],
        loadOptions: async () => [],
      },
    ]
    const definitions: CustomFieldDefDto[] = [
      {
        key: 'multi_relation',
        kind: 'relation',
        label: 'Multi Relation',
        optionsUrl: '/api/entities/relations/options?entityId=virtual%3Aexample&labelField=title',
      },
    ]

    renderWithProviders(
      <CustomDataSection
        entityId="customers:customer_entity"
        values={{ cf_multi_relation: [id1, id2] }}
        onSubmit={async () => {}}
        title="Custom fields"
        loadFields={async () => ({ fields, definitions })}
        labels={{
          loading: 'Loading custom data\u2026',
          emptyValue: 'No value',
          noFields: 'No fields',
          saveShortcut: 'Save now',
          edit: 'Edit',
          cancel: 'Cancel',
        }}
      />,
    )

    const linkAlpha = await screen.findByRole('link', { name: 'Record Alpha' })
    expect(linkAlpha).toBeInTheDocument()
    const linkBeta = await screen.findByRole('link', { name: 'Record Beta' })
    expect(linkBeta).toBeInTheDocument()
  })
})
