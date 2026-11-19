/** @jest-environment jsdom */

/**
 * `density` exists for narrow hosts — a docked inspector rail, a side panel —
 * where the page-width rhythm reads as airy and costs the host a third of its
 * column.
 *
 * The contract under test is deliberately narrow, because this prop lands on a
 * component every form in the product renders through:
 *
 *   1. omitting it changes NOTHING (the default renders the same class strings
 *      that were inline before the prop existed), and
 *   2. `compact` changes SPACING only — the same fields, labels, helper text and
 *      controls, one step down the DS scale.
 */

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))
jest.mock('../custom-fields/FieldDefinitionsManager', () => {
  const React = require('react')
  return { __esModule: true, FieldDefinitionsManager: React.forwardRef(() => <div />) }
})
jest.mock('../utils/customFieldForms', () => ({
  __esModule: true,
  buildFormFieldFromCustomFieldDef: jest.fn(),
  buildFormFieldsFromCustomFields: jest.fn(() => []),
  fetchCustomFieldFormStructure: jest.fn(),
}))

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text', description: 'What to call it' },
  { id: 'notes', label: 'Notes', type: 'text' },
]

const groups: CrudFormGroup[] = [{ id: 'basic', title: 'Basic', column: 1, fields: ['name', 'notes'] }]

function renderForm(density?: 'default' | 'compact') {
  const { container } = renderWithProviders(
    <CrudForm
      fields={fields}
      groups={groups}
      initialValues={{ name: 'x' }}
      onSubmit={jest.fn()}
      embedded
      {...(density ? { density } : {})}
    />,
  )
  return container
}

function classesOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('*')).map((node) => node.className.toString())
}

describe('CrudForm density', () => {
  it('renders identically whether the prop is omitted or set to its default', () => {
    // React's `useId` counter advances between renders in one file, so the
    // generated form id is normalised away; everything else must match exactly.
    const normalise = (html: string) => html.replace(/_r_[0-9a-z]+_/g, '_r_id_')
    const omitted = normalise(renderForm().innerHTML)
    const explicit = normalise(renderForm('default').innerHTML)

    expect(explicit).toBe(omitted)
  })

  it('steps the form rhythm down one DS step when compact', () => {
    const form = renderForm().querySelector('form')
    const compactForm = renderForm('compact').querySelector('form')

    expect(form?.className).toContain('space-y-4')
    expect(compactForm?.className).toContain('space-y-3')
    expect(compactForm?.className).not.toContain('space-y-4')
  })

  it('tightens the group card padding when compact', () => {
    const defaultCard = renderForm().querySelector('.rounded-lg.border')
    const compactCard = renderForm('compact').querySelector('.rounded-lg.border')

    expect(defaultCard?.className).toContain('px-4')
    expect(defaultCard?.className).toContain('py-3')
    expect(compactCard?.className).toContain('px-3')
    expect(compactCard?.className).toContain('py-2')
  })

  it('never reaches for an arbitrary Tailwind value', () => {
    // The DS ban is on values like `p-[13px]`; density must stay on the scale.
    for (const className of classesOf(renderForm('compact'))) {
      expect(className).not.toMatch(/\b(?:p|px|py|m|mx|my|space-[xy])-\[/)
    }
  })

  it('changes spacing only — the same fields, labels and helper text survive', () => {
    const compact = renderForm('compact')

    expect(compact.textContent).toContain('Name')
    expect(compact.textContent).toContain('Notes')
    expect(compact.textContent).toContain('What to call it')
    expect(compact.querySelectorAll('[data-crud-field-id]')).toHaveLength(
      renderForm().querySelectorAll('[data-crud-field-id]').length,
    )
  })
})
