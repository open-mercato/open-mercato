/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  crudFormExtensionSpotId,
  extensionSpotChildId,
} from '@open-mercato/shared/modules/widgets/extension-points'
import { extensionPoints } from '@open-mercato/core/modules/customers/extension-points'
import { E } from '#generated/entities.ids.generated'
import CreateCompanyPage from '../page'

type CapturedCrudFormProps = {
  injectionSpotId?: string
  entityIds?: string[]
}

const capturedCrudFormProps: CapturedCrudFormProps[] = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedCrudFormProps) => {
    capturedCrudFormProps.push(props)
    return <div data-testid="crud-form" />
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1' }),
  useOrganizationScopeVersion: () => 0,
}))

function renderCreatePage(): CapturedCrudFormProps {
  capturedCrudFormProps.length = 0
  renderWithProviders(<CreateCompanyPage />)
  expect(capturedCrudFormProps).toHaveLength(1)
  return capturedCrudFormProps[0]
}

describe('company create page injection host', () => {
  it('binds the canonical company CrudForm spot declared by the module', () => {
    const props = renderCreatePage()

    expect(props.injectionSpotId).toBe(extensionPoints.hosts.companyForm.spotId)
    expect(props.injectionSpotId).toBe('crud-form:customers.company')
  })

  it('does not fall back to the spot derived from the first entity id', () => {
    const props = renderCreatePage()

    const entityIdFallbackSpotId = crudFormExtensionSpotId(
      String(E.customers.customer_entity).replace(/[:]+/g, '.'),
    )

    expect(entityIdFallbackSpotId).toBe('crud-form:customers.customer_entity')
    expect(typeof props.injectionSpotId).toBe('string')
    expect(props.injectionSpotId).not.toBe(entityIdFallbackSpotId)
  })

  it('exposes the same field-widget slot that the company edit surface exposes', () => {
    const props = renderCreatePage()

    expect(extensionSpotChildId(props.injectionSpotId as string, 'fields')).toBe(
      'crud-form:customers.company:fields',
    )
  })

  it('keeps the existing entity ids so custom fields resolve unchanged', () => {
    const props = renderCreatePage()

    expect(props.entityIds).toEqual([
      E.customers.customer_entity,
      E.customers.customer_company_profile,
    ])
  })
})
