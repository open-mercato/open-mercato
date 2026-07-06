/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'

import type { RowActionItem } from '@open-mercato/ui/backend/RowActions'

import { DealCard, type DealCardData } from '../DealCard'

const mockTranslations: Record<string, string> = {
  'customers.deals.kanban.card.action.call': 'Zadzwoń',
  'customers.deals.kanban.card.action.email': 'Wyślij e-mail',
  'customers.deals.kanban.card.action.note': 'Notatka',
  'customers.deals.kanban.card.action.disabledNoCompany': 'Najpierw przypisz firmę do deala',
  'customers.deals.kanban.card.menu.ariaLabel': 'Akcje deala',
}

jest.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    isDragging: false,
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => mockTranslations[key] ?? fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  translateWithFallback: (
    _translate: unknown,
    key: string,
    fallback: string,
    params?: Record<string, unknown>,
  ) => {
    const template = mockTranslations[key] ?? fallback

    return template.replace(/\{(\w+)\}/g, (_match, paramKey: string) => {
      const value = params?.[paramKey]

      return value == null ? '' : String(value)
    })
  },
}))

jest.mock('@open-mercato/ui/primitives/tooltip', () => {
  const ReactRuntime = require('react') as typeof import('react')

  return {
    SimpleTooltip({
      content,
      children,
    }: {
      content: React.ReactNode
      children: React.ReactElement<Record<string, unknown>>
    }) {
      if (!ReactRuntime.isValidElement(children) || typeof content !== 'string') {
        return children
      }

      return ReactRuntime.cloneElement(children, {
        'data-tooltip-content': content,
      })
    },
  }
})

jest.mock('../DealCardMenu', () => {
  const ReactRuntime = require('react') as typeof import('react')

  return {
    DealCardMenu({ ariaLabel }: { ariaLabel: string }) {
      return ReactRuntime.createElement(
        'button',
        {
          type: 'button',
          'data-card-action': 'true',
          'aria-label': ariaLabel,
        },
        'Menu',
      )
    },
  }
})

const baseDeal: DealCardData = {
  id: 'deal-1',
  title: 'Redwood Residences Solar Rollout',
  status: 'open',
  owner: null,
  primaryCompany: {
    id: 'company-1',
    label: 'Brightside Solar',
  },
  valueAmount: 185_000,
  valueCurrency: 'USD',
  probability: 55,
  expectedCloseAt: '2026-03-30',
  createdAt: '2026-03-01',
  updatedAt: '2026-03-10',
  pipelineState: {
    openActivitiesCount: 0,
    daysInCurrentStage: 0,
    isStuck: false,
    isOverdue: false,
  },
}

function renderDealCard(deal: DealCardData = baseDeal) {
  const onComposeActivity = jest.fn()
  const onOpenDetail = jest.fn()
  const buildMenuItems = (_deal: DealCardData): RowActionItem[] => []

  render(
    <DealCard
      deal={deal}
      selected={false}
      buildMenuItems={buildMenuItems}
      onToggleSelect={jest.fn()}
      onComposeActivity={onComposeActivity}
      onOpenDetail={onOpenDetail}
    />,
  )

  return { onComposeActivity, onOpenDetail }
}

describe('DealCard quick actions', () => {
  it('renders localized quick actions as accessible icon buttons without visible inline labels', () => {
    renderDealCard()

    const callButton = screen.getByRole('button', { name: 'Zadzwoń' })
    const actionRow = callButton.closest('[data-card-action="true"]')

    expect(actionRow).not.toBeNull()

    const row = within(actionRow as HTMLElement)
    const emailButton = row.getByRole('button', { name: 'Wyślij e-mail' })
    const emailIcon = emailButton.querySelector('svg')

    expect(actionRow).toHaveClass('justify-center')
    expect(row.getByRole('button', { name: 'Zadzwoń' })).toBeInTheDocument()
    expect(emailButton).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Notatka' })).toBeInTheDocument()
    expect(emailButton).toHaveClass('size-8')
    expect(emailIcon).toHaveClass('size-5')

    expect(row.queryByText('Zadzwoń')).not.toBeInTheDocument()
    expect(row.queryByText('Wyślij e-mail')).not.toBeInTheDocument()
    expect(row.queryByText('Notatka')).not.toBeInTheDocument()
  })

  it('keeps quick action clicks from opening the deal detail', () => {
    const { onComposeActivity, onOpenDetail } = renderDealCard()

    fireEvent.click(screen.getByRole('button', { name: 'Wyślij e-mail' }))

    expect(onComposeActivity).toHaveBeenCalledWith('deal-1', 'email')
    expect(onOpenDetail).not.toHaveBeenCalled()
  })

  it('keeps no-company quick actions disabled and exposes the disabled explanation through tooltips', () => {
    renderDealCard({
      ...baseDeal,
      primaryCompany: null,
    })

    const callButton = screen.getByRole('button', { name: 'Zadzwoń' })

    expect(callButton).toBeDisabled()
    expect(callButton).not.toHaveAttribute('title')
    expect(callButton.closest('[data-tooltip-content]')).toHaveAttribute(
      'data-tooltip-content',
      'Najpierw przypisz firmę do deala',
    )
  })
})
