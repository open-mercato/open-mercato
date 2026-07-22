/** @jest-environment jsdom */
import * as React from 'react'
import { renderHook } from '@testing-library/react'
import { useDialogKeyHandler } from '../useDialogKeyHandler'

function makeEvent(key: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}): React.KeyboardEvent {
  return {
    key,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    preventDefault: jest.fn(),
  } as unknown as React.KeyboardEvent
}

describe('useDialogKeyHandler', () => {
  it('calls onCancel and prevents default on Escape', () => {
    const onCancel = jest.fn()
    const { result } = renderHook(() => useDialogKeyHandler({ onCancel }))
    const event = makeEvent('Escape')
    result.current(event)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('calls onConfirm and prevents default on Cmd+Enter', () => {
    const onConfirm = jest.fn()
    const { result } = renderHook(() => useDialogKeyHandler({ onConfirm }))
    const event = makeEvent('Enter', { metaKey: true })
    result.current(event)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('calls onConfirm and prevents default on Ctrl+Enter', () => {
    const onConfirm = jest.fn()
    const { result } = renderHook(() => useDialogKeyHandler({ onConfirm }))
    const event = makeEvent('Enter', { ctrlKey: true })
    result.current(event)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not intercept at all when disabled — no preventDefault, no callback', () => {
    const onConfirm = jest.fn()
    const { result } = renderHook(() => useDialogKeyHandler({ onConfirm, disabled: true }))
    const event = makeEvent('Enter', { metaKey: true })
    result.current(event)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not prevent default on Escape when onCancel is omitted', () => {
    const { result } = renderHook(() => useDialogKeyHandler({}))
    const event = makeEvent('Escape')
    result.current(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not prevent default on Cmd+Enter when onConfirm is omitted', () => {
    const { result } = renderHook(() => useDialogKeyHandler({}))
    const event = makeEvent('Enter', { metaKey: true })
    result.current(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not call onConfirm on plain Enter without modifier', () => {
    const onConfirm = jest.fn()
    const { result } = renderHook(() => useDialogKeyHandler({ onConfirm }))
    result.current(makeEvent('Enter'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not call onCancel on other keys', () => {
    const onCancel = jest.fn()
    const { result } = renderHook(() => useDialogKeyHandler({ onCancel }))
    result.current(makeEvent('Tab'))
    expect(onCancel).not.toHaveBeenCalled()
  })
})
