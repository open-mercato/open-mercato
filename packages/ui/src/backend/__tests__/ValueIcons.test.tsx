import { render, screen } from '@testing-library/react'
import { BooleanIcon } from '../ValueIcons'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

describe('BooleanIcon', () => {
  it.each([
    [true, 'Yes'],
    [false, 'No'],
  ])('exposes the %s value to assistive technology', (value, label) => {
    render(<BooleanIcon value={value} />)

    expect(screen.getByText(label)).toHaveClass('sr-only')
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps explicit labels visible without duplicating accessible text', () => {
    render(<BooleanIcon value trueLabel="Active" falseLabel="Inactive" />)

    expect(screen.getByText('Active')).not.toHaveClass('sr-only')
    expect(screen.queryByText('Yes')).not.toBeInTheDocument()
  })
})
