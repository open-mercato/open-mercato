/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useAiShortcuts } from '../useAiShortcuts'

function Harness({
  onSubmit,
  onCancel,
  enabled,
}: {
  onSubmit?: () => void
  onCancel?: () => void
  enabled?: boolean
}) {
  const { handleKeyDown } = useAiShortcuts({ onSubmit, onCancel, enabled })
  return (
    <textarea aria-label="shortcuts harness" onKeyDown={handleKeyDown} />
  )
}

describe('useAiShortcuts', () => {
  it('calls onSubmit on plain Enter and prevents default', () => {
    const onSubmit = jest.fn()
    render(<Harness onSubmit={onSubmit} />)
    const textarea = screen.getByLabelText('shortcuts harness')

    const result = fireEvent.keyDown(textarea, { key: 'Enter' })
    // `fireEvent.keyDown` returns `false` when the handler called preventDefault.
    expect(result).toBe(false)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('calls onSubmit on Cmd+Enter (still works for power users)', () => {
    const onSubmit = jest.fn()
    render(<Harness onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByLabelText('shortcuts harness'), {
      key: 'Enter',
      metaKey: true,
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('calls onSubmit on Ctrl+Enter (still works for power users)', () => {
    const onSubmit = jest.fn()
    render(<Harness onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByLabelText('shortcuts harness'), {
      key: 'Enter',
      ctrlKey: true,
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not fire submit on Shift+Enter (native newline behavior preserved)', () => {
    const onSubmit = jest.fn()
    render(<Harness onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByLabelText('shortcuts harness'), {
      key: 'Enter',
      shiftKey: true,
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onCancel on Escape', () => {
    const onCancel = jest.fn()
    render(<Harness onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('shortcuts harness'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled', () => {
    const onSubmit = jest.fn()
    const onCancel = jest.fn()
    render(<Harness onSubmit={onSubmit} onCancel={onCancel} enabled={false} />)
    const textarea = screen.getByLabelText('shortcuts harness')
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('does not swallow Escape when no onCancel is bound', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('shortcuts harness')
    const result = fireEvent.keyDown(textarea, { key: 'Escape' })
    // preventDefault NOT called — native Escape bubbles.
    expect(result).toBe(true)
  })

  it('does not double-fire when keyDown is dispatched twice', () => {
    const onSubmit = jest.fn()
    render(<Harness onSubmit={onSubmit} />)
    const textarea = screen.getByLabelText('shortcuts harness')
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(textarea, { key: 'a' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
