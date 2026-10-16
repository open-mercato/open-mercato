/**
 * @jest-environment jsdom
 *
 * Step 8.8 (QA F8, F4): `BenefitCard`'s benefit-type picker had the same
 * `ComboboxInput` bug as `RuleCard`'s rule-type picker (QA F5) — pre-filled with the
 * selected type's own label, filtering the suggestion list down to one match. A
 * benefit meant to be `cart_discount` could silently stay `product_discount` because
 * the tester never saw the other options. This pins the `Select` swap: opening the
 * picker lists all five Release 4 shipped benefit types, and choosing one calls
 * `onTypeChange` with the right value.
 *
 * It also covers the `LabelsEditor` locale picker (QA F4): the free-text locale
 * `Input` (which silently accepted a typo like `eng`) is now a `Select` constrained to
 * `getSupportedLocales()`, deduplicated against locales the benefit already carries a
 * row for.
 */
import * as React from 'react'
import { fireEvent, screen, within, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { BenefitCard } from '../BenefitCard'
import { createEmptyBenefit, BENEFIT_TYPE_OPTIONS, type BenefitTypeId } from '../ruleTreeTypes'

jest.mock('@open-mercato/shared/lib/i18n/locale-set', () => ({
  getSupportedLocales: () => ['en', 'pl', 'es'],
}))

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

function Harness({
  onTypeChange,
  onLabelsChange,
}: {
  onTypeChange?: (next: BenefitTypeId) => void
  onLabelsChange?: (next: Record<string, string>) => void
}) {
  const [benefit, setBenefit] = React.useState(() => createEmptyBenefit(0))
  return (
    <DndContext>
      <SortableContext items={[benefit.clientId]} strategy={verticalListSortingStrategy}>
        <BenefitCard
          benefit={benefit}
          onTypeChange={(next) => {
            onTypeChange?.(next)
            setBenefit((current) => ({ ...current, benefitType: next }))
          }}
          onAppliesToChange={() => {}}
          onConfigChange={() => {}}
          onLabelsChange={(next) => {
            onLabelsChange?.(next)
            setBenefit((current) => ({ ...current, labels: next }))
          }}
          onDelete={() => {}}
        />
      </SortableContext>
    </DndContext>
  )
}

function openBenefitTypePicker() {
  const label = screen.getByText('Benefit type').closest('label') as HTMLElement
  fireEvent.click(within(label).getByRole('combobox'))
  return label
}

describe('BenefitCard benefit-type picker', () => {
  it('lists all five Release 4 shipped benefit types when opened', async () => {
    renderWithProviders(<Harness />)
    openBenefitTypePicker()

    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(BENEFIT_TYPE_OPTIONS.length)
    })
    expect(screen.getByRole('option', { name: 'Cart discount' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tiered discount' })).toBeInTheDocument()
  })

  it('calls onTypeChange with the selected benefit type', async () => {
    const onTypeChange = jest.fn()
    renderWithProviders(<Harness onTypeChange={onTypeChange} />)
    openBenefitTypePicker()

    await waitFor(() => expect(screen.getByRole('option', { name: 'Cart discount' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: 'Cart discount' }))

    expect(onTypeChange).toHaveBeenCalledWith('cart_discount')
  })
})

describe('BenefitCard labels editor locale picker', () => {
  it('offers only the mocked supported locales, not free text', async () => {
    renderWithProviders(<Harness />)

    // A new benefit starts with no labels, so the Labels section auto-expands.
    const localeLabel = screen.getByText('Locale code (e.g. en)')
    fireEvent.click(localeLabel)

    await waitFor(() => {
      const options = screen.getAllByRole('option').map((option) => option.textContent)
      expect(options).toEqual(['en', 'pl', 'es'])
    })
    expect(screen.queryByPlaceholderText('Locale code (e.g. en)')).not.toBeInTheDocument()
  })

  it('adds a locale row and excludes that locale from the picker afterwards', async () => {
    const onLabelsChange = jest.fn()
    renderWithProviders(<Harness onLabelsChange={onLabelsChange} />)

    fireEvent.click(screen.getByText('Locale code (e.g. en)'))
    await waitFor(() => expect(screen.getByRole('option', { name: 'pl' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: 'pl' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add locale' }))
    expect(onLabelsChange).toHaveBeenCalledWith({ pl: '' })

    fireEvent.click(screen.getByText('Locale code (e.g. en)'))
    await waitFor(() => {
      const options = screen.getAllByRole('option').map((option) => option.textContent)
      expect(options).toEqual(['en', 'es'])
    })
  })
})
