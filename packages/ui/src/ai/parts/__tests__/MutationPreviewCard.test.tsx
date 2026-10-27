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
import {
  confirmPendingAction,
  cancelPendingAction,
} from '../pending-action-api'
import { MutationPreviewCard } from '../MutationPreviewCard'
import type { AiPendingActionCardAction } from '../types'

const dict = {
  'ai_assistant.chat.mutation_cards.preview.title': 'Review proposed changes',
  'ai_assistant.chat.mutation_cards.preview.batchSummary': 'Batch update',
  'ai_assistant.chat.mutation_cards.preview.batchRecords': 'records',
  'ai_assistant.chat.mutation_cards.preview.confirm': 'Confirm',
  'ai_assistant.chat.mutation_cards.preview.cancel': 'Cancel',
  'ai_assistant.chat.mutation_cards.preview.reviewDetails': 'Review details',
  'ai_assistant.chat.mutation_cards.diff.fieldHeader': 'Field',
  'ai_assistant.chat.mutation_cards.diff.beforeHeader': 'Before',
  'ai_assistant.chat.mutation_cards.diff.afterHeader': 'After',
  'ai_assistant.chat.mutation_cards.diff.empty': 'No field changes for this record.',
  'ai_assistant.chat.mutation_cards.confirmation.staleVersionTitle': 'Re-propose required',
  'ai_assistant.chat.mutation_cards.confirmation.staleVersionBody': 'One or more records changed since this preview was generated.',
  'ai_assistant.chat.mutation_cards.confirmation.errorTitle': 'Confirm failed',
}

function makeAction(
  overrides: Partial<AiPendingActionCardAction> = {},
): AiPendingActionCardAction {
  return {
    id: 'pa-1',
    agentId: 'customers.account_assistant',
    toolName: 'customers.update_person',
    status: 'pending',
    fieldDiff: [{ field: 'name', before: 'Alice', after: 'Alicia' }],
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
    isPolling: false,
    error: null,
    refresh: jest.fn().mockResolvedValue(action),
  })
}

describe('MutationPreviewCard', () => {
  beforeEach(() => {
    ;(useAiPendingActionPolling as jest.Mock).mockReset()
    ;(confirmPendingAction as jest.Mock).mockReset()
    ;(cancelPendingAction as jest.Mock).mockReset()
    ;(confirmPendingAction as jest.Mock).mockResolvedValue({
      ok: true,
      data: { ok: true, pendingAction: makeAction({ status: 'confirmed' }) },
    })
    ;(cancelPendingAction as jest.Mock).mockResolvedValue({
      ok: true,
      data: { ok: true, pendingAction: makeAction({ status: 'cancelled' }) },
    })
  })

  it('renders fieldDiff mode with before/after cells', () => {
    installPollingMock(makeAction())
    renderWithProviders(
      <MutationPreviewCard
        componentId="mutation-preview-card"
        pendingActionId="pa-1"
      />,
      { dict },
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Alicia')).toBeInTheDocument()
    expect(document.querySelector('[data-ai-mutation-preview-mode]')?.getAttribute('data-ai-mutation-preview-mode')).toBe('single')
  })

  it('renders records[] batch mode with count + labels summary', () => {
    installPollingMock(
      makeAction({
        records: [
          { recordId: 'r-1', entityType: 'customers.person', label: 'Alice', fieldDiff: [] },
          { recordId: 'r-2', entityType: 'customers.person', label: 'Bob', fieldDiff: [] },
          { recordId: 'r-3', entityType: 'customers.person', label: 'Chris', fieldDiff: [] },
        ],
      }),
    )
    renderWithProviders(
      <MutationPreviewCard
        componentId="mutation-preview-card"
        pendingActionId="pa-1"
      />,
      { dict },
    )
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('records')).toBeInTheDocument()
    expect(screen.getByText(/Alice, Bob, Chris/)).toBeInTheDocument()
    expect(document.querySelector('[data-ai-mutation-preview-mode]')?.getAttribute('data-ai-mutation-preview-mode')).toBe('batch')
  })

  it('Cmd+Enter triggers confirm; Escape triggers cancel', async () => {
    installPollingMock(makeAction())
    renderWithProviders(
      <MutationPreviewCard
        componentId="mutation-preview-card"
        pendingActionId="pa-1"
      />,
      { dict },
    )
    const host = document.querySelector('[data-ai-mutation-preview]') as HTMLElement
    expect(host).not.toBeNull()

    fireEvent.keyDown(host, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(confirmPendingAction).toHaveBeenCalledWith('pa-1', expect.any(Object)))

    // Card flipped to confirming — reinstall mock with fresh action and mount again for Escape.
    ;(confirmPendingAction as jest.Mock).mockClear()
    installPollingMock(makeAction())
    const { unmount } = renderWithProviders(
      <MutationPreviewCard
        componentId="mutation-preview-card"
        pendingActionId="pa-2"
      />,
      { dict },
    )
    const hosts = document.querySelectorAll('[data-ai-mutation-preview]')
    const host2 = hosts[hosts.length - 1] as HTMLElement
    fireEvent.keyDown(host2, { key: 'Escape' })
    await waitFor(() => expect(cancelPendingAction).toHaveBeenCalledWith('pa-2', expect.any(Object)))
    unmount()
  })

  it('does not render Review details when the visible single-record diff is already complete', () => {
    installPollingMock(makeAction())
    renderWithProviders(
      <MutationPreviewCard
        componentId="mutation-preview-card"
        pendingActionId="pa-1"
      />,
      { dict },
    )
    expect(document.querySelector('[data-ai-mutation-preview-details]')).toBeNull()
    expect(screen.queryByRole('button', { name: /Review details/i })).toBeNull()
  })

  it('Review details toggles the expanded batch diff section', async () => {
    installPollingMock(
      makeAction({
        fieldDiff: [],
        records: [
          {
            recordId: 'r-1',
            entityType: 'customers.person',
            label: 'Alice',
            fieldDiff: [{ field: 'name', before: 'Alice', after: 'Alicia' }],
          },
        ],
      }),
    )
    renderWithProviders(
      <MutationPreviewCard
        componentId="mutation-preview-card"
        pendingActionId="pa-1"
      />,
      { dict },
    )
    expect(document.querySelector('[data-ai-mutation-preview-details]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Review details/i }))
    await waitFor(() => {
      expect(document.querySelector('[data-ai-mutation-preview-details]')).not.toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: /Review details/i }))
    await waitFor(() => {
      expect(document.querySelector('[data-ai-mutation-preview-details]')).toBeNull()
    })
  })

  it('shows the 412 stale_version refusal with the stale rows when every previewed row changed', async () => {
    installPollingMock(
      makeAction({
        fieldDiff: [],
        records: [
          { recordId: 'prod-a', entityType: 'catalog.product', label: 'Product A', fieldDiff: [] },
          { recordId: 'prod-b', entityType: 'catalog.product', label: 'Product B', fieldDiff: [] },
        ],
      }),
    )
    ;(confirmPendingAction as jest.Mock).mockResolvedValue({
      ok: false,
      error: {
        status: 412,
        code: 'stale_version',
        message: 'All pending records are stale; the model must re-propose the batch.',
        extra: { staleRecords: ['prod-a', 'prod-b'] },
      },
    })
    renderWithProviders(
      <MutationPreviewCard componentId="mutation-preview-card" pendingActionId="pa-1" />,
      { dict },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => {
      expect(document.querySelector('[data-ai-confirmation-error="stale_version"]')).not.toBeNull()
    })
    expect(document.querySelector('[data-ai-mutation-preview]')).not.toBeNull()
    expect(screen.getByText('Re-propose required')).toBeInTheDocument()
    const staleRows = Array.from(document.querySelectorAll('[data-ai-confirmation-stale-record]'))
    expect(staleRows.map((row) => row.getAttribute('data-ai-confirmation-stale-record'))).toEqual(['prod-a', 'prod-b'])
    expect(screen.getByText('Product A')).toBeInTheDocument()
    expect(screen.getByText('Product B')).toBeInTheDocument()
  })

  it('shows any other confirm error envelope on the preview card', async () => {
    installPollingMock(makeAction())
    ;(confirmPendingAction as jest.Mock).mockResolvedValue({
      ok: false,
      error: { status: 403, code: 'agent_features_denied', message: 'Caller lacks a required feature.' },
    })
    renderWithProviders(
      <MutationPreviewCard componentId="mutation-preview-card" pendingActionId="pa-1" />,
      { dict },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => {
      expect(document.querySelector('[data-ai-confirmation-error="agent_features_denied"]')).not.toBeNull()
    })
    expect(screen.getByText('Confirm failed')).toBeInTheDocument()
    expect(screen.getByText('Caller lacks a required feature.')).toBeInTheDocument()
  })
})
