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
import type { CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import {
  buildPersonEditPayload,
  createPersonEditGroups,
  createPersonFormGroups,
  createPersonPersonalDataGroups,
  type PersonEditFormValues,
  type Translator,
} from '../formConfig'

const t: Translator = (key, fallback) => fallback ?? key

const PERSON_ID = '44444444-4444-4444-8444-444444444444'

type FormValues = Record<string, unknown>

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

describe('person display name on the detail page', () => {
  const detailGroup = () => findGroup(createPersonPersonalDataGroups(t), 'personalDataDisplay')
  const stalePerson = { id: PERSON_ID, displayName: 'Dr. J. Doe', firstName: 'John', lastName: 'Doe' }

  it('hosts the sync in a bare group without any name editor', () => {
    const group = detailGroup()
    expect(group.bare).toBe(true)
    const { container } = renderGroup(group, stalePerson)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps a persisted custom name while the names are untouched', () => {
    const { change, latest } = renderGroup(detailGroup(), stalePerson)
    change('primaryEmail', 'john@example.com')
    expect(latest.values.displayName).toBe('Dr. J. Doe')
    expect(buildPersonEditPayload(latest.values as PersonEditFormValues).displayName).toBe('Dr. J. Doe')
  })

  it('follows the new names and stops sending the stale value once a name changes', () => {
    const { change, latest } = renderGroup(detailGroup(), stalePerson)
    change('firstName', 'Jon')
    expect(latest.values.displayName).toBe('Jon Doe')
    expect(buildPersonEditPayload(latest.values as PersonEditFormValues).displayName).toBe('Jon Doe')
    change('lastName', 'Smith')
    expect(buildPersonEditPayload(latest.values as PersonEditFormValues).displayName).toBe('Jon Smith')
  })

  it('keeps following when a derived name changes', () => {
    const { change, latest } = renderGroup(detailGroup(), {
      id: PERSON_ID,
      displayName: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
    })
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
