/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FilterOverlay, type FilterDef, type FilterValues } from '../FilterOverlay'

function renderOverlay({
  filters,
  initialValues = {},
  onApply = jest.fn(),
  onClear = jest.fn(),
}: {
  filters: FilterDef[]
  initialValues?: FilterValues
  onApply?: (v: FilterValues) => void
  onClear?: () => void
}) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <FilterOverlay
        open={true}
        onOpenChange={() => {}}
        filters={filters}
        initialValues={initialValues}
        onApply={onApply}
        onClear={onClear}
      />
    </I18nProvider>,
  )
}

describe('FilterOverlay tooltip rendering', () => {
  const filterWithTooltip: FilterDef = {
    id: 'hasObjects',
    label: 'Has related records',
    tooltip: 'Shows messages that have Open Mercato records attached — such as orders, quotes, or customers.',
    type: 'select',
    options: [
      { value: '', label: 'All' },
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ],
  }

  const filterWithoutTooltip: FilterDef = {
    id: 'hasAttachments',
    label: 'Has attachments',
    type: 'select',
    options: [
      { value: '', label: 'All' },
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ],
  }

  it('renders Info icon when tooltip is set on a FilterDef', () => {
    renderOverlay({ filters: [filterWithTooltip] })
    expect(screen.getByLabelText('More information')).toBeInTheDocument()
  })

  it('does not render Info icon when tooltip is absent', () => {
    renderOverlay({ filters: [filterWithoutTooltip] })
    expect(screen.queryByLabelText('More information')).toBeNull()
  })

  it('renders label text alongside the tooltip icon', () => {
    renderOverlay({ filters: [filterWithTooltip] })
    expect(screen.getByText('Has related records')).toBeInTheDocument()
    expect(screen.getByLabelText('More information')).toBeInTheDocument()
  })

  it('filter without tooltip still renders label correctly', () => {
    renderOverlay({ filters: [filterWithoutTooltip] })
    expect(screen.getByText('Has attachments')).toBeInTheDocument()
    expect(screen.queryByLabelText('More information')).toBeNull()
  })

  it('renders tooltip icon for each filter that has tooltip set (multiple filters)', () => {
    const actionFilter: FilterDef = {
      id: 'hasActions',
      label: 'Has action requests',
      tooltip: 'Shows messages where one or more attached records require a response.',
      type: 'select',
      options: [
        { value: '', label: 'All' },
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ],
    }
    renderOverlay({ filters: [filterWithTooltip, filterWithoutTooltip, actionFilter] })
    const infoIcons = screen.getAllByLabelText('More information')
    expect(infoIcons).toHaveLength(2)
  })
})
