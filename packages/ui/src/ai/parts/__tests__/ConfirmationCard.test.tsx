/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('../useAiPendingActionPolling', () => ({
  useAiPendingActionPolling: jest.fn(),
}))

jest.mock('../pending-action-api', () => ({
  confirmPendingAction: jest.fn(),
  cancelPendingAction: jest.fn(),
}))

import { useAiPendingActionPolling } from '../useAiPendingActionPolling'
import { cancelPendingAction } from '../pending-action-api'
import { ConfirmationCard } from '../ConfirmationCard'
import type { AiPendingActionCardAction } from '../types'

const dict = {
  'ai_assistant.chat.mutation_cards.confirmation.title': 'Applying action...',
  'ai_assistant.chat.mutation_cards.confirmation.cancel': 'Cancel',
  'ai_assistant.chat.mutation_cards.confirmation.defaultSummary': 'Applying the requested changes...',
  'ai_assistant.chat.mutation_cards.confirmation.staleVersionTitle': 'Re-propose required',
  'ai_assistant.chat.mutation_cards.confirmation.staleVersionBody':
    'One or more records changed since this preview was generated. Ask the assistant to re-propose the change.',
  'ai_assistant.chat.mutation_cards.confirmation.schemaDriftTitle': 'Schema changed',
  'ai_assistant.chat.mutation_cards.confirmation.schemaDriftBody':
    'The tool signature changed since this preview was generated. Ask the assistant to re-propose the change.',
  'ai_assistant.chat.mutation_cards.confirmation.invalidStatusTitle': 'Action already resolved',
  'ai_assistant.chat.mutation_cards.confirmation.invalidStatusBody':
    'This action has already been confirmed, cancelled, or executed.',
  'ai_assistant.chat.mutation_cards.confirmation.errorTitle': 'Confirm failed',
  'ui.spinner.ariaLabel': 'Loading',
}

function baseAction(
  overrides: Partial<AiPendingActionCardAction> = {},
): AiPendingActionCardAction {
  return {
    id: 'pa-1',
    agentId: 'customers.account_assistant',
    toolName: 'customers.update_person',
    status: 'pending',
    fieldDiff: [],
    records: null,
    failedRecords: null,
    sideEffectsSummary: 'Rename Alice to Alicia',
    attachmentIds: [],
    targetEntityType: 'customers.person',
    targetRecordId: 'p-1',
    recordVersion: '1',
    executionResult: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  }
}

function installPollingMock(action: AiPendingActionCardAction | null) {
  ;(useAiPendingActionPolling as jest.Mock).mockReturnValue({
    action,
    status: action?.status ?? null,
    isPolling: action?.status === 'pending' || action?.status === 'executing',
    error: null,
    refresh: jest.fn().mockResolvedValue(action),
  })
}

describe('ConfirmationCard', () => {
  beforeEach(() => {
    ;(useAiPendingActionPolling as jest.Mock).mockReset()
    ;(cancelPendingAction as jest.Mock).mockReset()
    ;(cancelPendingAction as jest.Mock).mockResolvedValue({
      ok: true,
      data: { ok: true, pendingAction: baseAction({ status: 'cancelled' }) },
    })
  })

  it('renders spinner + side effects copy in pending state', () => {
    installPollingMock(baseAction({ status: 'pending' }))
    renderWithProviders(
      <ConfirmationCard componentId="confirmation-card" pendingActionId="pa-1" />,
      { dict },
    )
    expect(screen.getByText('Applying action...')).toBeInTheDocument()
    expect(screen.getByText('Rename Alice to Alicia')).toBeInTheDocument()
    // The cancel button must be enabled while status is pending.
    const cancelButton = document.querySelector(
      '[data-ai-confirmation-cancel]',
    ) as HTMLButtonElement
    expect(cancelButton.disabled).toBe(false)
  })

  it('disables Cancel once the server flips status to executing', () => {
    installPollingMock(baseAction({ status: 'executing' }))
    renderWithProviders(
      <ConfirmationCard componentId="confirmation-card" pendingActionId="pa-1" />,
      { dict },
    )
    const cancelButton = document.querySelector(
      '[data-ai-confirmation-cancel]',
    ) as HTMLButtonElement
    expect(cancelButton.disabled).toBe(true)
  })

  it('renders the stale_version "Re-propose required" alert with failed record ids', () => {
    installPollingMock(baseAction({ status: 'pending' }))
    renderWithProviders(
      <ConfirmationCard
        componentId="confirmation-card"
        pendingActionId="pa-1"
        payload={{
          confirmError: {
            status: 412,
            code: 'stale_version',
            message: 'Record version changed since preview.',
            extra: { failedRecords: [{ recordId: 'r-1' }, { recordId: 'r-2' }] },
          },
        }}
      />,
      { dict },
    )
    expect(
      document.querySelector('[data-ai-confirmation-error="stale_version"]'),
    ).not.toBeNull()
    expect(screen.getByText('Re-propose required')).toBeInTheDocument()
    expect(
      document.querySelectorAll('[data-ai-confirmation-stale-record]').length,
    ).toBe(2)
    expect(document.querySelectorAll('p p').length).toBe(0)
    expect(document.querySelectorAll('p ul').length).toBe(0)
  })

  it('renders the schema_drift "Schema changed" alert', () => {
    installPollingMock(baseAction({ status: 'pending' }))
    renderWithProviders(
      <ConfirmationCard
        componentId="confirmation-card"
        pendingActionId="pa-1"
        payload={{
          confirmError: {
            status: 412,
            code: 'schema_drift',
            message: 'Tool schema changed.',
          },
        }}
      />,
      { dict },
    )
    expect(
      document.querySelector('[data-ai-confirmation-error="schema_drift"]'),
    ).not.toBeNull()
    expect(screen.getByText('Schema changed')).toBeInTheDocument()
  })

  it.each([
    ['tool_features_denied', 403, 'Permission required'],
  ])('renders a translated alert for %s instead of the raw server message', (code, status, title) => {
    installPollingMock(baseAction({ status: 'pending' }))
    renderWithProviders(
      <ConfirmationCard
        componentId="confirmation-card"
        pendingActionId="pa-1"
        payload={{
          confirmError: {
            status,
            code,
            message: 'raw server diagnostic',
          },
        }}
      />,
      { dict },
    )
    expect(document.querySelector(`[data-ai-confirmation-error="${code}"]`)).not.toBeNull()
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.queryByText('raw server diagnostic')).toBeNull()
  })

  it('drops the spinner and Cancel once the action is unavailable to the viewer', () => {
    ;(useAiPendingActionPolling as jest.Mock).mockReturnValue({
      action: null,
      status: null,
      isPolling: false,
      error: null,
      unavailable: true,
      refresh: jest.fn().mockResolvedValue(null),
    })
    renderWithProviders(
      <ConfirmationCard componentId="confirmation-card" pendingActionId="pa-foreign" />,
      { dict },
    )
    const card = document.querySelector('[data-ai-confirmation-card]')
    expect(card?.getAttribute('aria-busy')).toBe('false')
    expect(card?.getAttribute('data-ai-confirmation-status')).toBe('unavailable')
    expect(document.querySelector('[data-ai-confirmation-cancel]')).toBeNull()
  })

  it('treats a pending_action_not_found confirm error as unavailable', () => {
    installPollingMock(baseAction({ status: 'pending' }))
    renderWithProviders(
      <ConfirmationCard
        componentId="confirmation-card"
        pendingActionId="pa-foreign"
        payload={{
          confirmError: { status: 404, code: 'pending_action_not_found', message: 'raw server diagnostic' },
        }}
      />,
      { dict },
    )
    const card = document.querySelector('[data-ai-confirmation-card]')
    expect(card?.getAttribute('data-ai-confirmation-status')).toBe('unavailable')
    expect(screen.getByText('Proposal not available')).toBeInTheDocument()
    expect(screen.queryByText('Applying action...')).toBeNull()
    expect(screen.queryByText('raw server diagnostic')).toBeNull()
    expect(document.querySelector('[data-ai-confirmation-cancel]')).toBeNull()
  })

  it('dispatches cancelPendingAction on Cancel click', async () => {
    installPollingMock(baseAction({ status: 'pending' }))
    renderWithProviders(
      <ConfirmationCard componentId="confirmation-card" pendingActionId="pa-1" />,
      { dict },
    )
    fireEvent.click(document.querySelector('[data-ai-confirmation-cancel]')!)
    await waitFor(() => expect(cancelPendingAction).toHaveBeenCalledWith('pa-1', expect.any(Object)))
  })
})
