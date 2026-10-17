/**
 * @jest-environment jsdom
 *
 * Step 8.8 (QA F5): `RuleCard`'s rule-type picker used to be a `ComboboxInput` — a
 * free-text-filterable field — pre-populated with the SELECTED type's own label text,
 * which filtered its own suggestion list down to one match. A tester could not find
 * "Product count" without first clearing the input by hand. Swapping to the `Select`
 * primitive opens a real dropdown that always lists every option. This pins: opening
 * the picker shows all eleven Release 4 shipped rule types, and choosing one calls
 * `onTypeChange` with the right value.
 */
import * as React from 'react'
import { fireEvent, screen, within, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RuleCard } from '../RuleCard'
import { createEmptyRule, RULE_TYPE_OPTIONS, type RuleTypeId } from '../ruleTreeTypes'

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

function Harness({ onTypeChange }: { onTypeChange: (next: RuleTypeId) => void }) {
  const rule = createEmptyRule(0)
  return (
    <DndContext>
      <SortableContext items={[rule.clientId]} strategy={verticalListSortingStrategy}>
        <RuleCard rule={rule} onTypeChange={onTypeChange} onConfigChange={() => {}} onDelete={() => {}} />
      </SortableContext>
    </DndContext>
  )
}

function openRuleTypePicker() {
  const label = screen.getByText('Rule type').closest('label') as HTMLElement
  fireEvent.click(within(label).getByRole('combobox'))
  return label
}

describe('RuleCard rule-type picker', () => {
  it('lists all eleven Release 4 shipped rule types when opened', async () => {
    renderWithProviders(<Harness onTypeChange={() => {}} />)
    openRuleTypePicker()

    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(RULE_TYPE_OPTIONS.length)
    })
    expect(screen.getByRole('option', { name: 'Product count' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Customer order history' })).toBeInTheDocument()
  })

  it('calls onTypeChange with the selected rule type', async () => {
    const onTypeChange = jest.fn()
    renderWithProviders(<Harness onTypeChange={onTypeChange} />)
    openRuleTypePicker()

    await waitFor(() => expect(screen.getByRole('option', { name: 'Product count' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: 'Product count' }))

    expect(onTypeChange).toHaveBeenCalledWith('product_count')
  })
})
