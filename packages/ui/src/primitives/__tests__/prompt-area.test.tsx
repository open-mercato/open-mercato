import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from '../button'
import { PromptArea } from '../prompt-area'

const labels = { inputLabel: 'Message', submitLabel: 'Save draft' }

describe('PromptArea', () => {
  it('submits the trimmed controlled message using Enter and the native form', () => {
    const submit = jest.fn()
    const change = jest.fn()
    const { container } = render(<PromptArea {...labels} value="  Draft  " onValueChange={change} onSubmit={submit} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' })
    fireEvent.submit(container.querySelector('form')!)
    expect(submit.mock.calls).toEqual([['Draft'], ['Draft']])
    expect(change).not.toHaveBeenCalled()
  })

  it('keeps Shift+Enter and IME composition available without submitting', () => {
    const submit = jest.fn()
    render(<PromptArea {...labels} value="Draft" onValueChange={jest.fn()} onSubmit={submit} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(submit).not.toHaveBeenCalled()
  })

  it.each(['', '   ', '\n'])('rejects empty messages even when the form is submitted directly', value => {
    const submit = jest.fn()
    const { container } = render(<PromptArea {...labels} value={value} onValueChange={jest.fn()} onSubmit={submit} />)
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    fireEvent.submit(container.querySelector('form')!)
    expect(submit).not.toHaveBeenCalled()
  })

  it('disables editing and submission without losing the controlled value', () => {
    const submit = jest.fn()
    const { container } = render(<PromptArea {...labels} value="Saved" onValueChange={jest.fn()} onSubmit={submit} disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('textbox')).toHaveValue('Saved')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    fireEvent.submit(container.querySelector('form')!)
    expect(submit).not.toHaveBeenCalled()
  })

  it('forwards value changes while leaving attachment and toolbar actions independent', () => {
    const submit = jest.fn()
    const change = jest.fn()
    const remove = jest.fn()
    render(<PromptArea {...labels} value="Draft" onValueChange={change} onSubmit={submit} attachments={<Button type="button" onClick={remove}>Remove file</Button>} toolbar={<Button type="button">Add file</Button>} information={<span>Local draft</span>} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }))
    expect(change).toHaveBeenCalledWith('Updated')
    expect(remove).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText('Local draft')).toBeInTheDocument()
  })

  it('disables attachment and toolbar buttons through a native fieldset', () => {
    render(<PromptArea {...labels} value="Draft" onValueChange={jest.fn()} onSubmit={jest.fn()} disabled attachments={<Button type="button">Remove file</Button>} toolbar={<Button type="button">Add file</Button>} />)
    expect(screen.getByRole('button', { name: 'Remove file' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add file' })).toBeDisabled()
  })

  it('resizes to the current content height after controlled updates', () => {
    const props = { ...labels, onValueChange: jest.fn(), onSubmit: jest.fn() }
    const { rerender } = render(<PromptArea {...props} value="First" />)
    const input = screen.getByRole('textbox')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 72 })
    rerender(<PromptArea {...props} value="First\nSecond\nThird" compact />)
    expect(input.style.height).toBe('72px')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 20 })
    rerender(<PromptArea {...props} value="First" compact />)
    expect(input.style.height).toBe('20px')
  })
})
