/** @jest-environment jsdom */

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { CrudFormProps } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { E } from '#generated/entities.ids.generated'
import type { PersonFormValues } from '../../../../../components/formConfig'
import CreatePersonPage from '../page'

const pushMock = jest.fn()
let capturedProps: CrudFormProps<PersonFormValues>

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: () => null }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CrudFormProps<PersonFormValues>) => {
    capturedProps = props
    return <div />
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1' }),
  useOrganizationScopeVersion: () => 0,
}))

describe('person create extension flow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('preserves the legacy host and custom-field identities alongside the semantic person host', () => {
    renderWithProviders(<CreatePersonPage />)

    expect(capturedProps.injectionSpotId).toBe('crud-form:customers.person')
    expect(capturedProps.legacyInjectionSpotId).toBe('crud-form:customers.customer_entity')
    expect(capturedProps.entityId).toBe('customers.person')
    expect(capturedProps.resourceKind).toBe('customers.person')
    expect(capturedProps.entityIds).toEqual([
      E.customers.customer_entity,
      E.customers.customer_person_profile,
    ])
  })

  it('returns the new record identity before the post-lifecycle navigation callback', async () => {
    jest.mocked(createCrud).mockResolvedValue({ result: { id: 'new-person' }, response: {} as Response })
    renderWithProviders(<CreatePersonPage />)
    const values: PersonFormValues = {
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      _example: { priority: 'high' },
      '_example.priority': 'critical',
    }

    const result = await capturedProps.onSubmit?.(values)

    expect(result).toEqual({ resourceId: 'new-person' })
    expect(pushMock).not.toHaveBeenCalled()
    expect(createCrud).toHaveBeenCalledTimes(1)
    const nativePayload = jest.mocked(createCrud).mock.calls[0][1]
    expect(nativePayload).not.toHaveProperty('_example')
    expect(nativePayload).not.toHaveProperty('_example.priority')

    await capturedProps.onSubmitSuccess?.(values, result)

    expect(pushMock).toHaveBeenCalledWith('/backend/customers/people-v2/new-person')
    expect(createCrud).toHaveBeenCalledTimes(1)
  })
})
