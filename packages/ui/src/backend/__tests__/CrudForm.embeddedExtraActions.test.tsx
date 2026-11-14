/** @jest-environment jsdom */

/**
 * An embedded CrudForm is the body of a dialog: its footer is the only action
 * row the user sees, and hosts put the dialog's Cancel button there by passing
 * it through `extraActions`. Rendering that same node again in the embedded
 * header strip produced two Cancel buttons in one dialog (issue #6750).
 *
 * The contract pinned here:
 *
 *   1. embedded + a rendered footer  -> `extraActions` appear once, in the footer,
 *   2. embedded + no footer          -> they fall back to the header strip rather
 *                                       than disappearing, and
 *   3. not embedded                  -> the intentional FormHeader/FormFooter
 *                                       mirroring is untouched.
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
import { Button } from '../../primitives/button'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]
const groups: CrudFormGroup[] = [{ id: 'basic', title: 'Basic', column: 1, fields: ['name'] }]

type FormOptions = {
  embedded?: boolean
  hideFooterActions?: boolean
  readOnly?: boolean
}

function renderForm({ embedded = true, hideFooterActions, readOnly }: FormOptions = {}) {
  const { container } = renderWithProviders(
    <CrudForm
      fields={fields}
      groups={groups}
      initialValues={{ name: 'x' }}
      onSubmit={jest.fn()}
      submitLabel="Apply"
      embedded={embedded}
      hideFooterActions={hideFooterActions}
      readOnly={readOnly}
      extraActions={(
        <Button type="button" variant="ghost">Cancel</Button>
      )}
    />,
  )
  return container
}

function cancelButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('button')).filter(
    (button) => button.textContent?.trim() === 'Cancel',
  )
}

describe('CrudForm embedded extraActions', () => {
  it('renders a single Cancel action, in the footer beside the submit button', () => {
    const container = renderForm()
    const cancels = cancelButtons(container)

    expect(cancels).toHaveLength(1)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form!.contains(cancels[0])).toBe(true)

    const submit = container.querySelector<HTMLElement>('button[type="submit"]')
    expect(submit?.textContent).toContain('Apply')
    expect(cancels[0].parentElement).toBe(submit?.parentElement)
  })

  it('keeps the actions visible in the header strip when the footer is hidden', () => {
    const container = renderForm({ hideFooterActions: true })
    const cancels = cancelButtons(container)

    expect(cancels).toHaveLength(1)
    expect(container.querySelector('form')?.contains(cancels[0])).toBe(false)
  })

  it('keeps the actions visible in the header strip when the form is read-only', () => {
    const container = renderForm({ readOnly: true })
    const cancels = cancelButtons(container)

    expect(cancels).toHaveLength(1)
    expect(container.querySelector('form')?.contains(cancels[0])).toBe(false)
  })

  it('leaves the non-embedded header/footer mirroring in place', () => {
    const container = renderForm({ embedded: false })

    expect(cancelButtons(container)).toHaveLength(2)
  })
})
