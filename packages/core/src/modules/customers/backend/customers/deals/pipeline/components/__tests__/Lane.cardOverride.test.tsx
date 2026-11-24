/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { getComponentEntry, type ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentOverrideProvider } from '@open-mercato/ui/backend/injection/ComponentOverrideProvider'
import { DealCard, type DealCardData, type DealCardProps } from '../DealCard'
import { Lane } from '../Lane'

const componentId = 'section:customers.deals.pipelineCard'

const deal: DealCardData = {
  id: 'a12bcd34-0000-4000-8000-000000000001',
  title: 'Warehouse renewal',
  record: { cf_reference: 'SPD-12', cf_blank: '   ' },
  status: 'open',
  valueAmount: null,
  valueCurrency: null,
  probability: null,
  expectedCloseAt: null,
  createdAt: null,
  updatedAt: null,
  owner: null,
  primaryCompany: null,
  pipelineState: { openActivitiesCount: 0, daysInCurrentStage: 0, isStuck: false, isOverdue: false },
}

function referenceOverride(field: string): ComponentOverride {
  return {
    target: { componentId },
    priority: 10,
    propsTransform: (props) => {
      const card = props as DealCardProps
      const value = card.deal.record?.[field]
      return { ...card, referenceLabel: typeof value === 'string' ? value : undefined }
    },
  }
}

it.each(['cf_blank', 'cf_missing'])('shows the app reference, navigates by deal ID and falls back for %s', (emptyField) => {
  const onOpenDetail = jest.fn()
  const lane = (
    <Lane
      stage={{ id: 'qualified', label: 'Qualified', tone: null }}
      deals={[deal]}
      selectedDealIds={new Set()}
      buildMenuItems={() => []}
      onToggleSelect={jest.fn()}
      onComposeActivity={jest.fn()}
      onOpenDetail={onOpenDetail}
      onQuickAddClick={jest.fn()}
    />
  )
  const renderLane = (overrides: ComponentOverride[]) => (
    <I18nProvider locale="en" dict={{}}>
      <ComponentOverrideProvider overrides={overrides}>{lane}</ComponentOverrideProvider>
    </I18nProvider>
  )
  expect(getComponentEntry(componentId)?.component).toBe(DealCard)
  const { rerender } = render(renderLane([]))
  expect(screen.getByText('DEAL-A12BCD')).toBeVisible()

  rerender(renderLane([referenceOverride('cf_reference')]))
  expect(screen.queryByText('DEAL-A12BCD')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('SPD-12'))
  expect(onOpenDetail).toHaveBeenCalledWith(deal.id)

  rerender(renderLane([referenceOverride(emptyField)]))
  expect(screen.getByText('DEAL-A12BCD')).toBeVisible()
  expect(screen.queryByText('SPD-12')).not.toBeInTheDocument()
})
