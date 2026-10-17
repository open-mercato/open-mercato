/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ConfidenceBadge } from '../ConfidenceBadge'
import { VerdictBadge } from '../VerdictBadge'
import { CauseChip } from '../CauseChip'
import { DICT, cause } from './fixtures'

function renderUi(ui: React.ReactElement) {
  return renderWithProviders(ui, { dict: DICT })
}

describe('ConfidenceBadge', () => {
  it.each([
    ['proven', 'Proven', 'bg-status-success-bg'],
    ['inferred', 'Inferred', 'bg-status-warning-bg'],
    ['unknown', 'Unknown', 'bg-status-neutral-bg'],
  ] as const)('renders %s with a text label, an icon and a status token', (confidence, label, token) => {
    const { container } = renderUi(<ConfidenceBadge confidence={confidence} />)
    const text = screen.getByText(label)
    expect(text).toHaveAttribute('data-confidence', confidence)
    const badge = text.parentElement as HTMLElement
    expect(badge.className).toContain(token)
    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(badge).toHaveTextContent(`Confidence: ${label}`)
  })
})

describe('VerdictBadge', () => {
  it('renders the verdict as text with an icon, never colour alone', () => {
    const { container } = renderUi(<VerdictBadge verdict="unexplained" />)
    expect(screen.getByText('No history record found')).toHaveAttribute('data-verdict', 'unexplained')
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('CauseChip', () => {
  it('links an available cause with a safe internal href', () => {
    renderUi(
      <CauseChip cause={cause({ kind: 'workflow', label: 'Order approval', href: '/backend/workflows/instances/wf-1' })} />,
    )
    const link = screen.getByRole('link', { name: 'Workflow: Order approval' })
    expect(link).toHaveAttribute('href', '/backend/workflows/instances/wf-1')
  })

  it('renders an unavailable cause as muted text with its kind only', () => {
    const { container } = renderUi(
      <CauseChip cause={cause({ kind: 'business_rule', label: 'Secret rule', href: '/backend/rules/1', available: false })} />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/Secret rule/)).toBeNull()
    expect(screen.getByText('Business rule')).toBeInTheDocument()
    expect(screen.getByText('(details not available)')).toBeInTheDocument()
    const chip = container.querySelector('[data-cause-kind="business_rule"]') as HTMLElement
    expect(chip).toHaveAttribute('data-cause-available', 'false')
    expect(chip.className).toContain('text-muted-foreground')
  })

  it.each(['//evil.example.com/x', '/\t/evil.example.com', '/\n/evil.example.com', '/\\evil.example.com', 'https://evil.example.com', 'javascript:alert(1)'])(
    'never links an unsafe href %j',
    (href) => {
      renderUi(<CauseChip cause={cause({ kind: 'workflow', label: 'Remote', href })} />)
      expect(screen.queryByRole('link')).toBeNull()
      expect(screen.getByText('Workflow: Remote')).toBeInTheDocument()
    },
  )
})
