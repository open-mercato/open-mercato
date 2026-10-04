import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { CompactButton } from '../compact-button'

describe('CompactButton', () => {
  it.each([[20, 'size-5', 'size-4.5'], [24, 'size-6', 'size-5']] as const)(
    'supports the audited %i px control and icon size', (size, controlClass, iconClass) => {
      render(<CompactButton size={size} aria-label="Add"><svg /></CompactButton>)
      const button = screen.getByRole('button', { name: 'Add' })
      expect(button).toHaveClass(controlClass, 'rounded-sm')
      expect(button.className).toContain(`]:${iconClass}`)
      expect(button).toHaveAttribute('type', 'button')
    },
  )

  it('supports a controlled pressed action without affecting disabled actions', () => {
    const disabledAction = jest.fn()
    function Example() {
      const [pressed, setPressed] = React.useState(false)
      return <>
        <CompactButton aria-label="Pin" aria-pressed={pressed} onClick={() => setPressed(!pressed)}><svg /></CompactButton>
        <CompactButton aria-label="Remove" disabled onClick={disabledAction}><svg /></CompactButton>
      </>
    }
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(disabledAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
  })

  it('forwards a ref and preserves the native style prop', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(<CompactButton ref={ref} aria-label="Add" fullRadius appearance="white" style={{ marginTop: 4 }}><svg /></CompactButton>)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Add' }))
    expect(ref.current).toHaveClass('rounded-full')
    expect(ref.current).toHaveStyle({ marginTop: '4px' })
  })

  it('can compose an accessible anchor without adding a button wrapper', () => {
    render(<CompactButton asChild aria-label="Help"><a href="#help"><svg /></a></CompactButton>)
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '#help')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
