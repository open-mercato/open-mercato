/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PermissionPicker } from '../backend/processes/definitions/PermissionPicker'
import dictionary from '../i18n/en.json'

test('only suggests permissions on focus and does not grant a search fragment on blur', () => {
  const onChange = jest.fn()
  renderWithProviders(
    <PermissionPicker
      value={['orders.view']}
      onChange={onChange}
      catalog={[
        { id: 'orders.view', title: 'View orders' },
        { id: 'orders.manage', title: 'Manage orders' },
      ]}
    />,
    { dict: dictionary },
  )
  expect(screen.queryByRole('button', { name: /Manage orders/ })).toBeNull()
  const input = screen.getByRole('textbox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'orders.manage' } })
  expect(screen.getByRole('button', { name: /Manage orders/ })).toBeTruthy()
  fireEvent.blur(input)
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.focus(input)
  fireEvent.click(screen.getByRole('button', { name: /Manage orders/ }))
  expect(onChange).toHaveBeenCalledWith(['orders.view', 'orders.manage'])
})
