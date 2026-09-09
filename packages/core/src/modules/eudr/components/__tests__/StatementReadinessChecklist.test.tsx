/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { StatementReadinessChecklist } from '../StatementReadinessChecklist'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const stableTranslate = (key: string) => key
  return { useT: () => stableTranslate }
})

jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children, status }: { children: React.ReactNode; status?: string }) => (
    <div data-testid={`alert-${status}`}>{children}</div>
  ),
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('StatementReadinessChecklist', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('lists unmet gate reasons for a draft statement without a submit attempt', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { status: 'draft', allowed: false, reasons: ['eudr.gate.noSubmissions', 'eudr.gate.riskConclusionMissing'] },
    })

    render(<StatementReadinessChecklist statementId="st-1" status="draft" updatedAt="2026-07-30T10:00:00Z" />)

    await waitFor(() => {
      expect(screen.getByText('eudr.gate.noSubmissions')).toBeInTheDocument()
    })
    expect(screen.getByText('eudr.gate.riskConclusionMissing')).toBeInTheDocument()
    expect(screen.getByText('eudr.lifecycle.readinessTitle')).toBeInTheDocument()
    expect(screen.getByTestId('alert-information')).toBeInTheDocument()
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/eudr/statements/st-1/readiness',
      undefined,
      { fallback: null },
    )
  })

  it('shows the ready line when the gate passes', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { status: 'draft', allowed: true, reasons: [] },
    })

    render(<StatementReadinessChecklist statementId="st-1" status="draft" updatedAt="2026-07-30T10:00:00Z" />)

    await waitFor(() => {
      expect(screen.getByText('eudr.lifecycle.readinessReady')).toBeInTheDocument()
    })
    expect(screen.getByTestId('alert-success')).toBeInTheDocument()
  })

  it('renders nothing for non-draft statements and never calls the API', () => {
    const { container } = render(
      <StatementReadinessChecklist statementId="st-1" status="available" updatedAt="2026-07-30T10:00:00Z" />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('refetches when the statement version changes', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: { status: 'draft', allowed: false, reasons: ['eudr.gate.noSubmissions'] } })
    const { rerender } = render(
      <StatementReadinessChecklist statementId="st-1" status="draft" updatedAt="2026-07-30T10:00:00Z" />,
    )
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))

    rerender(<StatementReadinessChecklist statementId="st-1" status="draft" updatedAt="2026-07-30T11:00:00Z" />)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))
  })
})
