/** @jest-environment jsdom */

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({}))
jest.mock('../AddressTiles', () => ({
  CustomerAddressTiles: () => null,
}))
jest.mock('../detail/RolesSection', () => ({
  RolesSection: () => null,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useOptionalLocale: () => undefined,
}))

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { CrudCustomFieldRenderProps, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import {
  buildPersonEditPayload,
  createPersonEditFields,
  createPersonEditGroups,
  createPersonFormGroups,
  createPersonPersonalDataGroups,
  type PersonEditFormValues,
  type Translator,
} from '../formConfig'

const t: Translator = (key, fallback) => fallback ?? key

const PERSON_ID = '44444444-4444-4444-8444-444444444444'

type FormValues = Record<string, unknown>
type CrudCustomField = { id: string; component: (props: CrudCustomFieldRenderProps) => React.ReactNode }

function findGroup(groups: CrudFormGroup[], id: string): CrudFormGroup {
  const group = groups.find((candidate) => candidate.id === id)
  if (!group) throw new Error(`[internal] missing group ${id}`)
  return group
}

function renderGroup(group: CrudFormGroup, initialValues: FormValues) {
  const latest: { values: FormValues; change: (id: string, value: unknown) => void } = {
    values: initialValues,
    change: () => {},
  }
  function Host() {
    const [values, setValues] = React.useState<FormValues>(initialValues)
    const setValue = React.useCallback((id: string, value: unknown) => {
      setValues((current) => ({ ...current, [id]: value }))
    }, [])
    latest.values = values
    latest.change = setValue
    return <>{group.component?.({ values, setValue, errors: {} })}</>
  }
  const view = render(<Host />)
  return {
    ...view,
    latest,
    change(id: string, value: unknown) {
      act(() => latest.change(id, value))
    },
  }
}

function renderDisplayNameField(initialValues: FormValues) {
  expect(findGroup(createPersonPersonalDataGroups(t), 'personalData').fields?.slice(0, 3)).toEqual(['firstName', 'lastName', 'displayName'])
  const field = createPersonEditFields(t).find((entry) => entry.id === 'displayName') as CrudCustomField | undefined
  if (!field) throw new Error('[internal] missing displayName field')
  const latest: { values: FormValues; change: (id: string, value: unknown) => void } = {
    values: initialValues,
    change: () => {},
  }
  function Host() {
    const [values, setValues] = React.useState<FormValues>(initialValues)
    const change = React.useCallback((id: string, value: unknown) => {
      setValues((current) => ({ ...current, [id]: value }))
    }, [])
    const setDisplayName = React.useCallback((value: unknown) => change('displayName', value), [change])
    latest.values = values
    latest.change = change
    return <>{field?.component({ id: 'displayName', value: values.displayName, values, setValue: setDisplayName })}</>
  }
  render(<Host />)
  return {
    latest,
    change(id: string, value: unknown) {
      act(() => latest.change(id, value))
    },
    payloadName: () => buildPersonEditPayload(latest.values as PersonEditFormValues).displayName,
  }
}

const RESET = 'customers.people.form.displayName.reset'

describe('person display name on the detail page', () => {
  const customNamePerson = { id: PERSON_ID, displayName: 'Dr. J. Doe', firstName: 'John', lastName: 'Doe' }
  const derivedNamePerson = { id: PERSON_ID, displayName: 'John Doe', firstName: 'John', lastName: 'Doe' }

  it('keeps the personalDataDisplay group id with nothing rendered in it', () => {
    const group = findGroup(createPersonPersonalDataGroups(t), 'personalDataDisplay')
    expect(group.bare).toBe(true)
    const { container } = renderGroup(group, customNamePerson)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps a custom name when first or last name changes, up to the save payload', () => {
    const { change, latest, payloadName } = renderDisplayNameField(customNamePerson)
    change('firstName', 'Jon')
    expect(latest.values.displayName).toBe('Dr. J. Doe')
    expect(payloadName()).toBe('Dr. J. Doe')
    change('lastName', 'Smith')
    expect(payloadName()).toBe('Dr. J. Doe')
  })

  it('keeps a custom name after a name is edited and changed back', () => {
    const { change, latest } = renderDisplayNameField(customNamePerson)
    change('firstName', 'John ')
    change('firstName', 'John')
    expect(latest.values.displayName).toBe('Dr. J. Doe')
  })

  it('lets the user enter a custom name, which then stays', () => {
    const { change, latest, payloadName } = renderDisplayNameField(derivedNamePerson)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Johnny' } })
    expect(latest.values.displayName).toBe('Johnny')
    change('firstName', 'Jon')
    expect(payloadName()).toBe('Johnny')
  })

  it('resets a custom name to first and last name, and it follows them again', () => {
    const { change, latest, payloadName } = renderDisplayNameField(customNamePerson)
    fireEvent.click(screen.getByRole('button', { name: RESET }))
    expect(payloadName()).toBe('John Doe')
    expect(screen.queryByRole('button', { name: RESET })).not.toBeInTheDocument()
    change('firstName', 'Jon')
    expect(latest.values.displayName).toBe('Jon Doe')
  })

  it('follows the names and offers no reset while the name is derived', () => {
    const { change, latest } = renderDisplayNameField(derivedNamePerson)
    expect(screen.queryByRole('button', { name: RESET })).not.toBeInTheDocument()
    change('lastName', 'Smith')
    expect(latest.values.displayName).toBe('John Smith')
  })
})

describe('person display name on surfaces without a header', () => {
  it.each([
    ['create', () => createPersonFormGroups(t)],
    ['edit', () => createPersonEditGroups(t)],
  ])('offers the name editor on the %s groups', (_surface, groups) => {
    renderGroup(findGroup(groups(), 'details'), { firstName: 'Ada', lastName: 'Lovelace' })
    expect(screen.getByText('customers.people.form.displayNamePreview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'customers.people.form.displayName.edit' })).toBeInTheDocument()
  })

  it('derives the name from first and last until a custom one is entered, and keeps that one', () => {
    const { change, latest } = renderGroup(findGroup(createPersonFormGroups(t), 'details'), {
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    expect(latest.values.displayName).toBe('Ada Lovelace')
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'customers.people.form.displayName.edit' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Countess of Lovelace' } })
    expect(latest.values.displayName).toBe('Countess of Lovelace')

    change('firstName', 'Augusta')
    expect(latest.values.displayName).toBe('Countess of Lovelace')

    fireEvent.click(screen.getByRole('button', { name: 'customers.people.form.displayName.reset' }))
    expect(latest.values.displayName).toBe('Augusta Lovelace')
  })
})
