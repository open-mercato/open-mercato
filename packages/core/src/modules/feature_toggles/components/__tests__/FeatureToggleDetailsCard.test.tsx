/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { FeatureToggleDetailsCard } from '@open-mercato/core/modules/feature_toggles/components/FeatureToggleDetailsCard'
import type { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/validators'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

function baseToggle(overrides: Partial<FeatureToggle>): FeatureToggle {
  return {
    identifier: 'sample_flag',
    name: 'Sample flag',
    description: 'A sample flag',
    category: 'ui',
    type: 'string',
    defaultValue: 'value',
    ...overrides,
  } as FeatureToggle
}

describe('FeatureToggleDetailsCard — default value rendering (#3241)', () => {
  it('renders boolean false default as "False", not "-"', () => {
    render(<FeatureToggleDetailsCard featureToggleItem={baseToggle({ type: 'boolean', defaultValue: false })} />)
    expect(screen.getByText('False')).toBeInTheDocument()
    expect(screen.queryByText('-')).toBeNull()
  })

  it('renders boolean true default as "True"', () => {
    render(<FeatureToggleDetailsCard featureToggleItem={baseToggle({ type: 'boolean', defaultValue: true })} />)
    expect(screen.getByText('True')).toBeInTheDocument()
  })

  it('renders numeric 0 default as "0", not "-"', () => {
    render(<FeatureToggleDetailsCard featureToggleItem={baseToggle({ type: 'number', defaultValue: 0 })} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('renders empty string default as an empty value, not "-"', () => {
    const { container } = render(
      <FeatureToggleDetailsCard featureToggleItem={baseToggle({ type: 'string', defaultValue: '' })} />,
    )
    // The default-value paragraph exists but is empty; it must not fall back to "-".
    expect(screen.queryByText('-')).toBeNull()
    expect(container.querySelector('.font-semibold')).not.toBeNull()
  })

  it('renders JSON object default as formatted JSON', () => {
    render(
      <FeatureToggleDetailsCard
        featureToggleItem={baseToggle({ type: 'json', defaultValue: { enabled: true } })}
      />,
    )
    expect(screen.getByText(/"enabled": true/)).toBeInTheDocument()
  })

  it('renders "-" only when the default value is missing (null/undefined)', () => {
    const { rerender } = render(
      <FeatureToggleDetailsCard featureToggleItem={baseToggle({ type: 'string', defaultValue: null })} />,
    )
    expect(screen.getByText('-')).toBeInTheDocument()

    rerender(
      <FeatureToggleDetailsCard featureToggleItem={baseToggle({ type: 'string', defaultValue: undefined })} />,
    )
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('does not change hook order when re-rendering from no data to a boolean toggle', () => {
    // Reproduces the conditional-useT() hook-order failure: first render with no
    // record (card renders "-" via the early return), then a re-render with a
    // truthy boolean toggle. A conditional hook would throw on this transition.
    const { rerender } = render(<FeatureToggleDetailsCard featureToggleItem={undefined} />)
    expect(screen.getAllByText('-').length).toBeGreaterThan(0)

    expect(() => {
      rerender(
        <FeatureToggleDetailsCard featureToggleItem={baseToggle({ type: 'boolean', defaultValue: true })} />,
      )
    }).not.toThrow()
    expect(screen.getByText('True')).toBeInTheDocument()
  })
})
