/** @jest-environment jsdom */

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { CrudFormProps } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import type { PersonFormValues } from '../../formConfig'
import { CreatePersonDialog } from '../CreatePersonDialog'

let capturedProps: CrudFormProps<PersonFormValues>

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CrudFormProps<PersonFormValues>) => {
    capturedProps = props
    return <div />
  },
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1' }),
  useOrganizationScopeVersion: () => 0,
}))

describe('person dialog create extension flow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('waits for post-create lifecycle before notifying its parent and closing', async () => {
    jest.mocked(createCrud).mockResolvedValue({ result: { id: 'new-person' }, response: {} as Response })
    const onClose = jest.fn()
    const onPersonCreated = jest.fn()
    renderWithProviders(
      <CreatePersonDialog
        open
        companyId="company-1"
        companyName="Example Company"
        onClose={onClose}
        onPersonCreated={onPersonCreated}
      />,
    )
    const values: PersonFormValues = {
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      companyEntityId: 'company-1',
    }

    const result = await capturedProps.onSubmit?.(values)

    expect(capturedProps.injectionSpotId).toBe('crud-form:customers.person')
    expect(capturedProps.legacyInjectionSpotId).toBe('crud-form:customers.customer_entity')
    expect(capturedProps.entityId).toBe('customers.person')
    expect(result).toEqual({ resourceId: 'new-person' })
    expect(onClose).not.toHaveBeenCalled()
    expect(onPersonCreated).not.toHaveBeenCalled()

    await capturedProps.onSubmitSuccess?.(values, result)

    expect(onPersonCreated).toHaveBeenCalledWith({
      id: 'new-person',
      displayName: 'Ada Lovelace',
      companyId: 'company-1',
      companyName: 'Example Company',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(createCrud).toHaveBeenCalledTimes(1)
  })
})
