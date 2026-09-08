/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import CreatePersonPage from '../page'
import { extensionPoints } from '../../../../../extension-points'

const crudFormPropsCapture: { current: Record<string, unknown> | null } = { current: null }

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1' }),
}))

beforeEach(() => {
  crudFormPropsCapture.current = null
})

describe('person create page injection host (#5882)', () => {
  it('binds the canonical person form spot declared by the module', () => {
    render(<CreatePersonPage />)

    expect(crudFormPropsCapture.current?.injectionSpotId).toBe('crud-form:customers.person')
    expect(crudFormPropsCapture.current?.injectionSpotId).toBe(extensionPoints.hosts.personForm.spotId)
  })

  it('no longer publishes the legacy derived spot', () => {
    render(<CreatePersonPage />)

    // Asserted as a literal rather than by recomputing `CrudForm`'s derivation: the point
    // is that this specific published id is gone, and a test that re-derived it would keep
    // passing even if the framework's fallback changed shape.
    expect(crudFormPropsCapture.current?.injectionSpotId).not.toBe('crud-form:customers.customer_entity')
  })

  it('keeps the existing entityIds so custom-field resolution is unchanged', () => {
    render(<CreatePersonPage />)

    expect(crudFormPropsCapture.current?.entityIds).toEqual([
      'customers:customer_entity',
      'customers:customer_person_profile',
    ])
  })
})
