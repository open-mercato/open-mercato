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

  it('Review details toggles the expanded diff section', async () => {
    installPollingMock(makeAction())
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
})
