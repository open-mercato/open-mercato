/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { RiskConclusionCriteriaWarning, countAnsweredCriteria } from '../RiskCriteriaField'
import { EUDR_RISK_CRITERIA_GROUPS } from '../../lib/reference-data'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const stableTranslate = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${params.answered}/${params.total}` : key
  return { useT: () => stableTranslate }
})

jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children, status }: { children: React.ReactNode; status?: string }) => (
    <div data-testid={`alert-${status}`}>{children}</div>
  ),
}))

const ALL_CRITERIA = EUDR_RISK_CRITERIA_GROUPS.flatMap((group) => [...group.criteria])

function answeredCriteria(count: number): Record<string, { answer: string }> {
  return Object.fromEntries(ALL_CRITERIA.slice(0, count).map((key) => [key, { answer: 'no_concern' }]))
}

describe('countAnsweredCriteria', () => {
  it('counts only recognized criteria answers', () => {
    const { answered, total } = countAnsweredCriteria({
      ...answeredCriteria(2),
      bogusKey: { answer: 'no_concern' },
    })
    expect(total).toBe(ALL_CRITERIA.length)
    expect(answered).toBe(2)
  })
})

describe('RiskConclusionCriteriaWarning', () => {
  it('warns when negligible is concluded with zero recorded criteria', () => {
    render(<RiskConclusionCriteriaWarning conclusion="negligible" criteria={{}} />)
    expect(screen.getByTestId('alert-warning')).toBeInTheDocument()
    expect(
      screen.getByText(`eudr.riskAssessments.form.negligibleCriteriaWarning:0/${ALL_CRITERIA.length}`),
    ).toBeInTheDocument()
  })

  it('stays silent when every criterion carries a stance', () => {
    const { container } = render(
      <RiskConclusionCriteriaWarning conclusion="negligible" criteria={answeredCriteria(ALL_CRITERIA.length)} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('stays silent for non-negligible conclusions', () => {
    const { container } = render(
      <RiskConclusionCriteriaWarning conclusion="high" criteria={{}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
