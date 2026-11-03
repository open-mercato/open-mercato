import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from '../button'
import { FieldLabel, Label } from '../label'
import { FormField } from '../form-field'
import { Input } from '../input'
import { HintText } from '../hint-text'
import { ContentLabel } from '../content-label'
import { ContentCard } from '../content-card'
import { KeyIcon, KeyIconGlyph } from '../key-icon'
import { PaymentIcon } from '../payment-icon'
import { ChartLegend, ChartLegendDot } from '../chart-legend'

describe('Key Components', () => {
  it('keeps field help actions outside the label and connects the label to its input', () => {
    const help = jest.fn()
    const { container } = render(<><FieldLabel htmlFor="name" required sublabel="Optional" action={<Button type="button" onClick={help}>Help</Button>}>Name</FieldLabel><Input id="name" /></>)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
    expect(container.querySelector('label button')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(help).toHaveBeenCalledTimes(1)
    expect(container.querySelector('label [aria-hidden="true"]')).toHaveTextContent('*')
  })

  it('preserves ordinary Label and FormField behavior unless source slots are requested', () => {
    const { container } = render(<><Label htmlFor="legacy">Legacy</Label><Input id="legacy" /><FormField label="Original" disabled><Input /></FormField><FormField label="Source" sourceLabel labelSublabel="Optional" disabled><Input /></FormField></>)
    expect(screen.getByLabelText('Legacy')).toBeInTheDocument()
    expect(screen.getByLabelText('Original')).toBeDisabled()
    expect(screen.getByLabelText('Source')).toBeDisabled()
    expect(container.querySelectorAll('[data-slot="field-label"]')).toHaveLength(1)
    expect(container.querySelector('[data-slot="field-label"]')).toHaveClass('text-text-disabled')
  })

  it('links source FormField required, description and errors to the input', () => {
    render(<FormField label="Email" sourceLabel required error="Please enter an email"><Input /></FormField>)
    const input = screen.getByRole('textbox', { name: 'Email' })
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Please enter an email')
  })

  it('announces error hints and allows consumers to select announcement behavior', () => {
    const { rerender } = render(<HintText state="error" leading={<KeyIconGlyph name="information" />}>Invalid code</HintText>)
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid code')
    rerender(<HintText state="error" role="status">Retrying</HintText>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Retrying')
  })

  it('retains independent content title, sublabel, description and control slots', () => {
    render(<ContentLabel label="Notifications" sublabel="Weekly" description="Delivery preferences" size={48} badge={<span>New</span>} trailing={<Button type="button">Configure</Button>} />)
    expect(screen.getByText('Notifications')).toHaveClass('text-base', 'leading-6')
    expect(screen.getByText('Delivery preferences')).toHaveClass('text-sm', 'leading-5')
    expect(screen.getByText('Weekly')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument()
  })

  it('dismisses cards through a named native button and blocks disabled dismissal', () => {
    const dismiss = jest.fn()
    const { rerender } = render(<ContentCard label="Plan" onDismiss={dismiss} dismissLabel="Remove plan" />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove plan' }))
    expect(dismiss).toHaveBeenCalledTimes(1)
    rerender(<ContentCard label="Plan" onDismiss={dismiss} dismissLabel="Remove plan" disabled />)
    expect(screen.getByRole('button', { name: 'Remove plan' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove plan' }))
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('omits dismissal when no handler exists', () => {
    render(<ContentCard label="Read only" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('makes icons decorative by default and supports an explicit accessible name', () => {
    const { container } = render(<><KeyIcon><KeyIconGlyph /></KeyIcon><KeyIcon size={64} color="blue" aria-label="Team"><KeyIconGlyph /></KeyIcon></>)
    expect(container.querySelector('[data-slot="key-icon"]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('img', { name: 'Team' })).toHaveClass('size-16')
    expect(screen.getByRole('img', { name: 'Team' }).querySelector('[data-slot="key-icon-glyph"]')).toHaveClass('size-8')
  })

  it('keeps the smallest icon glyph at 20px and accepts custom glyphs', () => {
    const { container } = render(<KeyIcon size={32}><span>Custom</span></KeyIcon>)
    expect(container.querySelector('[data-slot="key-icon-glyph"]')).toHaveClass('size-5')
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('accepts an accessible name from adjacent text', () => {
    render(<><span id="category">Team category</span><KeyIcon aria-labelledby="category"><KeyIconGlyph /></KeyIcon></>)
    expect(screen.getByRole('img', { name: 'Team category' })).not.toHaveAttribute('aria-hidden')
  })

  it('uses the source utility glyph for each payment category without image requests', () => {
    const { container } = render(<PaymentIcon category="water" aria-label="Water bill" />)
    expect(screen.getByRole('img', { name: 'Water bill' })).toHaveAttribute('data-category', 'water')
    expect(container.querySelector('[style]')?.getAttribute('style')).toContain('data:image/svg+xml')
  })

  it('keeps the legend text visible independently of its color and disabled marker', () => {
    render(<ChartLegend color="blue" disabled>Archived</ChartLegend>)
    const legend = screen.getByText('Archived')
    expect(legend).toHaveAttribute('aria-disabled', 'true')
    expect(legend.querySelector('[data-slot="chart-legend-dot"]')).toHaveAttribute('data-color', 'light-gray')
  })

  it.each([16, 20] as const)('keeps legend dots decorative at %spx', size => {
    const { container } = render(<ChartLegendDot size={size} color="teal" />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstChild).toHaveAttribute('data-size', String(size))
    expect(container.querySelector('span span')).toHaveClass('size-3', 'border-2')
  })
})
