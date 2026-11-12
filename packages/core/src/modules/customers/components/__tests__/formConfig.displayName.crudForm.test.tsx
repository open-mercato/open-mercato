/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import {
  buildPersonEditPayload,
  createPersonEditFields,
  createPersonPersonalDataGroups,
  type PersonEditFormValues,
  type Translator,
} from '../formConfig'

const mockChrome = { payload: { grantedFeatures: [] }, isReady: true }

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => mockChrome,
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/fields/registry', () => ({
  loadGeneratedFieldRegistrations: async () => {},
}))
jest.mock('../AddressTiles', () => ({ CustomerAddressTiles: () => null }))
jest.mock('../detail/RolesSection', () => ({ RolesSection: () => null }))

const t: Translator = (key, fallback) => fallback ?? key
const NAME_FIELDS = ['displayName', 'firstName', 'lastName']
const PERSON_ID = '44444444-4444-4444-8444-444444444444'

function renderDetailForm(onSubmit: (values: Record<string, unknown>) => Promise<void>) {
  const realGroup = createPersonPersonalDataGroups(t).find((group) => group.id === 'personalData')
  const fields = createPersonEditFields(t).filter((field) => NAME_FIELDS.includes(field.id))
  return renderWithProviders(
    <CrudForm<Record<string, unknown>>
      injectionSpotId="crud-form:test.person"
      fields={fields}
      groups={[{ id: 'personalData', title: realGroup?.title, fields: realGroup?.fields?.filter((entry) => typeof entry === 'string' && NAME_FIELDS.includes(entry)) }]}
      initialValues={{ id: PERSON_ID, displayName: 'Dr. J. Doe', firstName: 'John', lastName: 'Doe' }}
      onSubmit={onSubmit}
      submitLabel="Save person"
    />,
  )
}

function fieldInput(id: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`[data-crud-field-id="${id}"] input`)
  if (!input) throw new Error(`[internal] missing input for ${id}`)
  return input
}

describe('person display name through the real CrudForm', () => {
  it('saves a custom name unchanged after a first name edit, and the derived name after a reset', async () => {
    const onSubmit = jest.fn(async () => undefined)
    renderDetailForm(onSubmit)
    await waitFor(() => expect(fieldInput('displayName').value).toBe('Dr. J. Doe'))

    fireEvent.change(fieldInput('firstName'), { target: { value: 'Jon' } })
    await waitFor(() => expect(fieldInput('firstName').value).toBe('Jon'))
    expect(fieldInput('displayName').value).toBe('Dr. J. Doe')

    fireEvent.click(screen.getAllByRole('button', { name: 'Save person' })[0])
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const firstSave = onSubmit.mock.calls[0] as unknown as [PersonEditFormValues]
    expect(buildPersonEditPayload(firstSave[0])).toMatchObject({ displayName: 'Dr. J. Doe', firstName: 'Jon' })

    fireEvent.click(await screen.findByRole('button', { name: 'customers.people.form.displayName.reset' }))
    await waitFor(() => expect(fieldInput('displayName').value).toBe('Jon Doe'))

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save person' })[0]).toBeEnabled())
    fireEvent.click(screen.getAllByRole('button', { name: 'Save person' })[0])
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    const secondSave = onSubmit.mock.calls[1] as unknown as [PersonEditFormValues]
    expect(buildPersonEditPayload(secondSave[0])).toMatchObject({ displayName: 'Jon Doe', firstName: 'Jon' })
  })
})
