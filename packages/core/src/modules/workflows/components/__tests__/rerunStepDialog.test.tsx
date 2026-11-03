/**
 * @jest-environment jsdom
 *
 * Rerun-from-step dialog (spec §8.4, "optionally with edited context").
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RerunStepDialog } from '../run/RerunStepDialog'

function renderDialog(overrides: Partial<React.ComponentProps<typeof RerunStepDialog>> = {}) {
  const onConfirm = jest.fn()
  const onOpenChange = jest.fn()
  renderWithProviders(
    <RerunStepDialog
      open
      onOpenChange={onOpenChange}
      stepId="charge"
      stepLabel="Charge card"
      onConfirm={onConfirm}
      {...overrides}
    />
  )
  return { onConfirm, onOpenChange }
}

describe('RerunStepDialog', () => {
  it('confirms with no patch when the field is left empty', () => {
    const { onConfirm } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /rerun step/i }))
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })

  it('parses a JSON object patch', () => {
    const { onConfirm } = renderDialog()
    fireEvent.change(screen.getByLabelText(/context patch/i), {
      target: { value: '{"amount": 250}' },
    })
    fireEvent.click(screen.getByRole('button', { name: /rerun step/i }))
    expect(onConfirm).toHaveBeenCalledWith({ amount: 250 })
  })

  it('refuses unparseable JSON instead of sending a silently dropped edit', () => {
    const { onConfirm } = renderDialog()
    fireEvent.change(screen.getByLabelText(/context patch/i), { target: { value: '{amount: 250' } })
    fireEvent.click(screen.getByRole('button', { name: /rerun step/i }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/not valid json/i)).toBeInTheDocument()
  })

  it('refuses a JSON array or scalar — the patch must be an object to merge', () => {
    const { onConfirm } = renderDialog()
    fireEvent.change(screen.getByLabelText(/context patch/i), { target: { value: '[1,2,3]' } })
    fireEvent.click(screen.getByRole('button', { name: /rerun step/i }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/must be a json object/i)).toBeInTheDocument()
  })

  it('submits on Cmd/Ctrl+Enter, per the platform dialog contract', () => {
    const { onConfirm } = renderDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true })
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })

  it('names the step it is about to replay', () => {
    renderDialog()
    expect(screen.getByText(/charge card/i)).toBeInTheDocument()
  })

  it('disables submission while the request is in flight', () => {
    renderDialog({ isSubmitting: true })
    expect(screen.getByRole('button', { name: /rerun step/i })).toBeDisabled()
  })
})
