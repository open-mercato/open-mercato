/** @jest-environment jsdom */

jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  const React = require('react')
  const { createPortal } = require('react-dom')

  return {
    CrudForm: () => (
      <>
        <button type="button" data-testid="task-form-field">Task field</button>
        {createPortal(<button type="button" data-testid="nested-popup">Popup option</button>, document.body)}
      </>
    ),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: () => ({ data: undefined }),
}))

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskForm } from '../TaskForm'

describe('TaskForm keyboard handling', () => {
  afterEach(cleanup)

  const renderForm = (onCancel = jest.fn()) => {
    render(<TaskForm mode="edit" onSubmit={jest.fn()} onCancel={onCancel} />)
    return onCancel
  }

  it('keeps the form open when Escape bubbles from portaled popup content', () => {
    const onCancel = renderForm()

    fireEvent.keyDown(screen.getByTestId('nested-popup'), { key: 'Escape' })

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('closes the form when Escape is pressed inside it after nested content closes', () => {
    const onCancel = renderForm()

    fireEvent.keyDown(screen.getByTestId('task-form-field'), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not handle Escape already handled by a nested control', () => {
    const onCancel = renderForm()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()

    fireEvent(screen.getByTestId('task-form-field'), event)

    expect(onCancel).not.toHaveBeenCalled()
  })
})
