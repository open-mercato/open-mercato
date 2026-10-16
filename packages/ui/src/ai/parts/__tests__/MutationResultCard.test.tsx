/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('../useAiPendingActionPolling', () => ({
  useAiPendingActionPolling: jest.fn(),
}))

import { useAiPendingActionPolling } from '../useAiPendingActionPolling'
import { MutationResultCard } from '../MutationResultCard'
import type { AiPendingActionCardAction } from '../types'

const dict = {
  'ai_assistant.chat.mutation_cards.result.successTitle': 'Action applied',
  'ai_assistant.chat.mutation_cards.result.successBody': 'The requested change was saved successfully.',
  'ai_assistant.chat.mutation_cards.result.successWithCommand': 'Completed',
  'ai_assistant.chat.mutation_cards.result.viewRecord': 'View record',
  'ai_assistant.chat.mutation_cards.result.partialTitle': 'Action applied with failures',
  'ai_assistant.chat.mutation_cards.result.partialBody': 'Some records could not be updated.',
  'ai_assistant.chat.mutation_cards.result.ignoredEntriesBody': 'The change was saved. Some repeated entries were ignored:',
  'ai_assistant.chat.mutation_cards.result.failureTitle': 'Action failed',
  'ai_assistant.chat.mutation_cards.result.failureBody': 'The mutation could not be applied.',
  'ai_assistant.chat.mutation_cards.result.cancelledTitle': 'Proposal cancelled',
  'ai_assistant.chat.mutation_cards.result.cancelledBody': 'You cancelled this proposed change. No changes were made.',
}

function baseAction(
  overrides: Partial<AiPendingActionCardAction> = {},
): AiPendingActionCardAction {
  return {
    id: 'pa-1',
    agentId: 'customers.account_assistant',
    toolName: 'customers.update_person',
    status: 'confirmed',
    fieldDiff: [],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    attachmentIds: [],
    targetEntityType: 'customers.person',
    targetRecordId: 'p-1',
    recordVersion: '1',
    executionResult: { recordId: 'p-1', commandName: 'customers.updatePerson' },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    resolvedAt: new Date().toISOString(),
    resolvedByUserId: 'user-1',
    ...overrides,
  }
}

function installPollingMock(action: AiPendingActionCardAction | null) {
  ;(useAiPendingActionPolling as jest.Mock).mockReturnValue({
    action,
    status: action?.status ?? null,
    isPolling: false,
    error: null,
    refresh: jest.fn().mockResolvedValue(action),
  })
}

describe('MutationResultCard', () => {
  beforeEach(() => {
    ;(useAiPendingActionPolling as jest.Mock).mockReset()
  })

  it('renders the success variant + record link', () => {
    installPollingMock(baseAction())
    renderWithProviders(
      <MutationResultCard
        componentId="mutation-result-card"
        pendingActionId="pa-1"
        payload={{ recordHref: '/backend/customers/people/p-1' }}
      />,
      { dict },
    )
    expect(
      document.querySelector('[data-ai-mutation-result="success"]'),
    ).not.toBeNull()
    expect(
      document.querySelectorAll(
        '[data-ai-mutation-result="success"] [data-slot="alert-icon-badge"]',
      ),
    ).toHaveLength(1)
    expect(screen.getByText('Action applied')).toBeInTheDocument()
    const link = document.querySelector('[data-ai-mutation-result-link]') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('/backend/customers/people/p-1')
    expect(link.textContent).toBe('View record')
    expect(screen.queryByText(/customers\.updatePerson/)).toBeNull()
    expect(screen.queryByText(/p-1/)).toBeNull()
  })

  it('does not expose internal command names or record ids when no record link exists', () => {
    installPollingMock(baseAction())
    renderWithProviders(
      <MutationResultCard componentId="mutation-result-card" pendingActionId="pa-1" />,
      { dict },
    )
    expect(screen.getByText('The requested change was saved successfully.')).toBeInTheDocument()
    expect(screen.queryByText(/customers\.updatePerson/)).toBeNull()
    expect(screen.queryByText(/p-1/)).toBeNull()
    expect(document.querySelector('[data-ai-mutation-result-record-id]')).toBeNull()
  })

  it('renders the partial success variant + list of failed records', () => {
    installPollingMock(
      baseAction({
        failedRecords: [
          { recordId: 'r-1', error: { code: 'stale_version', message: 'changed' } },
          { recordId: 'r-2', error: { code: 'validation_error', message: 'bad name' } },
        ],
      }),
    )
    renderWithProviders(
      <MutationResultCard componentId="mutation-result-card" pendingActionId="pa-1" />,
      { dict },
    )
    expect(
      document.querySelector('[data-ai-mutation-result="partial"]'),
    ).not.toBeNull()
    expect(
      document.querySelectorAll('[data-ai-mutation-failed-record]').length,
    ).toBe(2)
  })

  it('renders the destructive failure variant with the error code', () => {
    installPollingMock(
      baseAction({
        status: 'failed',
        executionResult: {
          error: { code: 'tool_execution_failed', message: 'Internal error' },
        },
      }),
    )
    renderWithProviders(
      <MutationResultCard componentId="mutation-result-card" pendingActionId="pa-1" />,
      { dict },
    )
    expect(
      document.querySelector('[data-ai-mutation-result="failure"]'),
    ).not.toBeNull()
    const code = document.querySelector('[data-ai-mutation-result-code]')
    expect(code?.textContent).toBe('tool_execution_failed')
  })

  it('reads "Action applied" when the only reported rows are dropped duplicates', () => {
    installPollingMock(
      baseAction({
        failedRecords: [
          { recordId: 'r-1', error: { code: 'record_duplicate_dropped', message: 'listed more than once' } },
        ],
      }),
    )
    renderWithProviders(
      <MutationResultCard componentId="mutation-result-card" pendingActionId="pa-1" />,
      { dict },
    )
    expect(document.querySelector('[data-ai-mutation-result="success-with-notes"]')).not.toBeNull()
    expect(document.querySelector('[data-ai-mutation-result="partial"]')).toBeNull()
    expect(screen.getByText('Action applied')).toBeInTheDocument()
    expect(screen.getByText('The change was saved. Some repeated entries were ignored:')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-ai-mutation-failed-record]').length).toBe(1)
  })

  it('keeps "applied with failures" when a dropped duplicate comes with a real failure', () => {
    installPollingMock(
      baseAction({
        failedRecords: [
          { recordId: 'r-1', error: { code: 'record_duplicate_dropped', message: 'listed more than once' } },
          { recordId: 'r-2', error: { code: 'stale_version', message: 'changed' } },
        ],
      }),
    )
    renderWithProviders(
      <MutationResultCard componentId="mutation-result-card" pendingActionId="pa-1" />,
      { dict },
    )
    expect(document.querySelector('[data-ai-mutation-result="partial"]')).not.toBeNull()
    expect(screen.getByText('Action applied with failures')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-ai-mutation-failed-record]').length).toBe(2)
  })

  it('renders a neutral cancelled variant without an error code or Fix with AI button', () => {
    installPollingMock(
      baseAction({
        status: 'cancelled',
        executionResult: {
          error: { code: 'cancelled_by_user', message: '' },
        },
      }),
    )
    renderWithProviders(
      <MutationResultCard componentId="mutation-result-card" pendingActionId="pa-1" />,
      { dict },
    )
    expect(
      document.querySelector('[data-ai-mutation-result="cancelled"]'),
    ).not.toBeNull()
    expect(document.querySelector('[data-ai-mutation-result="failure"]')).toBeNull()
    expect(screen.getByText('Proposal cancelled')).toBeInTheDocument()
    expect(
      screen.getByText('You cancelled this proposed change. No changes were made.'),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-ai-mutation-result-code]')).toBeNull()
    expect(document.querySelector('[data-ai-mutation-result-fix]')).toBeNull()
    expect(screen.queryByText('cancelled_by_user')).toBeNull()
  })

  it('shows the operator-supplied cancellation reason on the cancelled variant', () => {
    installPollingMock(
      baseAction({
        status: 'cancelled',
        executionResult: {
          error: { code: 'cancelled_by_user', message: 'Customer changed their mind' },
        },
      }),
    )
    renderWithProviders(
      <MutationResultCard componentId="mutation-result-card" pendingActionId="pa-1" />,
      { dict },
    )
    expect(screen.getByText('Customer changed their mind')).toBeInTheDocument()
    expect(
      screen.queryByText('You cancelled this proposed change. No changes were made.'),
    ).toBeNull()
    expect(document.querySelector('[data-ai-mutation-result-fix]')).toBeNull()
  })
})
