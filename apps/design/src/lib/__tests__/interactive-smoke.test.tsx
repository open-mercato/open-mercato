/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WizardNavigationExample, EditableKeyValueExample } from '@open-mercato/core/modules/design_system/gallery/demos/block-interactions'
import dict from '@open-mercato/core/modules/design_system/i18n/en.json'

it('navigates between steps, preserves entered fields and finishes/restarts', async () => {
  renderWithProviders(<WizardNavigationExample initial="firstStep" />, { dict })
  const next = async (name: string) => {
    await waitFor(() => expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
  }
  const field = screen.getByRole('textbox', { name: 'Product name' }) as HTMLInputElement
  fireEvent.change(field, { target: { value: 'Improved name' } })
  await next('Next')
  expect(screen.getByRole('textbox', { name: 'Net price' })).toBeTruthy()
  await next('Back')
  expect((screen.getByRole('textbox', { name: 'Product name' }) as HTMLInputElement).value).toBe('Improved name')
  await next('Next')
  await next('Next')
  await next('Finish')
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('All steps completed.'))
  await next('Start again')
  expect(screen.getByRole('textbox', { name: 'Product name' })).toBeTruthy()
})
it('writes edits back into the record in the example', async () => {
  renderWithProviders(<EditableKeyValueExample />, { dict })
  fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Improved name' } })
  fireEvent.click(screen.getByRole('button', { name:'Save' }))
  await waitFor(() => expect(screen.getByText('Improved name')).toBeTruthy())
})
