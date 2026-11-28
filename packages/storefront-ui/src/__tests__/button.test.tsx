import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../primitives/button'

describe('Button', () => {
  it('renders a native button with type="button" by default', () => {
    render(<Button>Add to cart</Button>)
    const button = screen.getByRole('button', { name: 'Add to cart' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('data-slot', 'button')
  })

  it('keeps the label in the DOM and marks busy while loading', () => {
    render(<Button loading>Add to cart</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Add to cart')
  })

  it('renders the trailing price slot', () => {
    render(<Button trailing="129,00 zł">Add to cart</Button>)
    expect(screen.getByRole('button')).toHaveTextContent('Add to cart129,00 zł')
  })

  it('renders as a link with asChild', async () => {
    render(<Button asChild><a href="#coffee">Browse</a></Button>)
    const link = screen.getByRole('link', { name: 'Browse' })
    expect(link).toHaveAttribute('data-slot', 'button')
    expect(link).not.toHaveAttribute('type')
  })

  it('does not fire when disabled', async () => {
    const onClick = jest.fn()
    render(<Button disabled onClick={onClick}>Add</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
