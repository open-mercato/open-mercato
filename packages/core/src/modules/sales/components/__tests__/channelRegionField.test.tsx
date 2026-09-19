/**
 * @jest-environment jsdom
 *
 * The sales channel form's region control.
 *
 * It is a CrudForm `custom` field rather than a `select` / `text` branch because `fields` is
 * memoized once per render of `useChannelFields` and cannot change a field's `type` on a sibling's
 * value. These tests drive the component with the props CrudForm passes it, so what is pinned is the
 * thing that used to be impossible: the control reacting to the country in the same form.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { ChannelRegionField } from '../channels/channelFormFields'

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

const LABEL = 'State / region'

function render(over: Partial<CrudCustomFieldRenderProps> = {}) {
  const setValue = jest.fn()
  const props: CrudCustomFieldRenderProps = {
    id: 'region',
    value: '',
    values: { country: 'US' },
    setValue,
    ...over,
  }
  const view = renderWithProviders(<ChannelRegionField {...props} />)
  return { ...view, setValue }
}

function openSelect() {
  const trigger = screen.getByRole('combobox', { name: LABEL })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
  return trigger
}

describe('ChannelRegionField', () => {
  it('offers the 50 states plus DC when the form holds a US country', () => {
    render({ values: { country: 'US' } })
    openSelect()
    expect(screen.getAllByRole('option')).toHaveLength(51)
    expect(screen.getByRole('option', { name: 'California' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Puerto Rico' })).toBeNull()
  })

  it('renders a text input for a country with no list', () => {
    render({ values: { country: 'PL' }, value: 'Mazowieckie' })
    expect(screen.queryByRole('combobox', { name: LABEL })).toBeNull()
    expect(screen.getByRole('textbox', { name: LABEL })).toHaveValue('Mazowieckie')
  })

  it('renders a text input when the country field is still empty', () => {
    render({ values: {}, value: '' })
    expect(screen.getByRole('textbox', { name: LABEL })).toHaveValue('')
  })

  it('hands the two-letter code to setValue when a state is picked', () => {
    const { setValue } = render({ values: { country: 'US' } })
    openSelect()
    const option = screen.getByRole('option', { name: 'California' })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    expect(setValue).toHaveBeenCalledWith('CA')
  })

  it('hands the typed string to setValue on the text input', () => {
    const { setValue } = render({ values: { country: 'PL' }, value: '' })
    fireEvent.change(screen.getByRole('textbox', { name: LABEL }), { target: { value: 'Mazowieckie' } })
    expect(setValue).toHaveBeenCalledWith('Mazowieckie')
  })

  it('preselects the state a legacy full name denotes without rewriting the stored value', () => {
    const { setValue } = render({ values: { country: 'US' }, value: 'California' })
    expect(screen.getByRole('combobox', { name: LABEL })).toHaveTextContent('California')
    expect(setValue).not.toHaveBeenCalled()
  })

  it('leaves the placeholder showing for a value that denotes no state, and keeps it', () => {
    const { setValue } = render({ values: { country: 'US' }, value: 'Mazowieckie' })
    expect(screen.getByRole('combobox', { name: LABEL })).toHaveTextContent(LABEL)
    expect(setValue).not.toHaveBeenCalled()
  })

  it('marks the control invalid and keeps its accessible name when the form reports an error', () => {
    // R3 from the spec: the custom field must render the error affordance the `select` it replaced did.
    const { unmount } = render({ values: { country: 'US' }, error: 'Required' })
    expect(screen.getByRole('combobox', { name: LABEL })).toHaveAttribute('aria-invalid', 'true')
    unmount()

    render({ values: { country: 'PL' }, error: 'Required' })
    expect(screen.getByRole('textbox', { name: LABEL })).toHaveAttribute('aria-invalid', 'true')
  })

  it('carries the field id onto the rendered control in both shapes', () => {
    // CrudForm's `<label htmlFor="region">` points at this id; losing it would orphan the label.
    const { unmount } = render({ values: { country: 'US' } })
    expect(screen.getByRole('combobox', { name: LABEL })).toHaveAttribute('id', 'region')
    unmount()

    render({ values: { country: 'PL' } })
    expect(screen.getByRole('textbox', { name: LABEL })).toHaveAttribute('id', 'region')
  })

  it('disables the control with the rest of the form', () => {
    const { unmount } = render({ values: { country: 'US' }, disabled: true })
    expect(screen.getByRole('combobox', { name: LABEL })).toBeDisabled()
    unmount()

    render({ values: { country: 'PL' }, disabled: true })
    expect(screen.getByRole('textbox', { name: LABEL })).toBeDisabled()
  })
})
