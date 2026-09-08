/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { CreatePersonDialog } from '../CreatePersonDialog'
import { extensionPoints } from '../../../extension-points'

const crudFormPropsCapture: { current: Record<string, unknown> | null } = { current: null }

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1' }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({ createCrudFormError: jest.fn() }))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

beforeEach(() => {
  crudFormPropsCapture.current = null
})

describe('CreatePersonDialog injection host (#5915 review)', () => {
  it('binds the same declared person host as the person create page', () => {
    render(
      <CreatePersonDialog open onClose={() => {}} companyId="company-1" companyName="Copperleaf Design" />,
    )

    expect(crudFormPropsCapture.current?.injectionSpotId).toBe(extensionPoints.hosts.personForm.spotId)
    expect(crudFormPropsCapture.current?.injectionSpotId).toBe('crud-form:customers.person')
  })

  it('no longer publishes the legacy derived spot', () => {
    render(
      <CreatePersonDialog open onClose={() => {}} companyId="company-1" companyName="Copperleaf Design" />,
    )

    expect(crudFormPropsCapture.current?.injectionSpotId).not.toBe('crud-form:customers.customer_entity')
  })

  it('keeps the existing entityIds so custom-field resolution is unchanged', () => {
    render(
      <CreatePersonDialog open onClose={() => {}} companyId="company-1" companyName="Copperleaf Design" />,
    )

    expect(crudFormPropsCapture.current?.entityIds).toEqual([
      'customers:customer_entity',
      'customers:customer_person_profile',
    ])
  })
})
