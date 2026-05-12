/** @jest-environment jsdom */
import * as React from 'react'
import { render } from '@testing-library/react'
import {
  SortableGroupHandle,
  SortableGroupHandleProvider,
  useSortableGroupHandle,
  type SortableGroupHandleProps,
} from '../SortableGroupHandle'

function makeHandleProps(overrides: Partial<SortableGroupHandleProps> = {}): SortableGroupHandleProps {
  return {
    ref: () => {},
    attributes: { role: 'button', tabIndex: 0 },
    listeners: { onKeyDown: () => {} },
    isDragging: false,
    disabled: false,
    ...overrides,
  }
}

describe('SortableGroupHandle', () => {
  it('returns null when context is absent', () => {
    const { container } = render(<SortableGroupHandle ariaLabel="Drag" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a button with the given aria-label when context is provided', () => {
    const { container } = render(
      <SortableGroupHandleProvider value={makeHandleProps()}>
        <SortableGroupHandle ariaLabel="Drag to reorder" />
      </SortableGroupHandleProvider>,
    )
    const button = container.querySelector('button[aria-label="Drag to reorder"]')
    expect(button).not.toBeNull()
  })

  it('forwards the ref callback from context to the underlying button', () => {
    const refCalls: Array<HTMLElement | null> = []
    const handleProps = makeHandleProps({
      ref: (node) => refCalls.push(node),
    })
    render(
      <SortableGroupHandleProvider value={handleProps}>
        <SortableGroupHandle ariaLabel="Drag" />
      </SortableGroupHandleProvider>,
    )
    expect(refCalls.length).toBeGreaterThanOrEqual(1)
    const node = refCalls.find((n) => n !== null)
    expect(node?.tagName).toBe('BUTTON')
  })

  it('renders disabled when context says disabled', () => {
    const { container } = render(
      <SortableGroupHandleProvider value={makeHandleProps({ disabled: true })}>
        <SortableGroupHandle ariaLabel="Drag" />
      </SortableGroupHandleProvider>,
    )
    const button = container.querySelector('button[aria-label="Drag"]') as HTMLButtonElement
    expect(button?.disabled).toBe(true)
  })
})

describe('useSortableGroupHandle', () => {
  function HookProbe({ onValue }: { onValue: (v: SortableGroupHandleProps | null) => void }) {
    const value = useSortableGroupHandle()
    onValue(value)
    return null
  }

  it('returns null outside provider', () => {
    let captured: SortableGroupHandleProps | null | undefined
    render(<HookProbe onValue={(v) => { captured = v }} />)
    expect(captured).toBeNull()
  })

  it('returns the provided context value', () => {
    const handleProps = makeHandleProps({ isDragging: true })
    let captured: SortableGroupHandleProps | null | undefined
    render(
      <SortableGroupHandleProvider value={handleProps}>
        <HookProbe onValue={(v) => { captured = v }} />
      </SortableGroupHandleProvider>,
    )
    expect(captured?.isDragging).toBe(true)
  })
})
