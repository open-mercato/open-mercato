/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

/**
 * Regression coverage for the `202 confirmation_in_progress` response the
 * confirm route returns when another request already holds the atomic
 * execution claim (a double-click, or a client retry — exactly the case the
 * claim exists to make safe).
 *
 * `202` is a 2xx, so `apiCall` reports `ok: true` and the preview card lands
 * on its HTTP-200 branch. There the body's `ok: false` with a null
 * `mutationResult` used to collapse into the generic `execution_failed`
 * mapping, telling the operator "the mutation handler reported an error"
 * while the winning request was in fact succeeding.
 *
 * The assertion is made on the props handed to {@link ConfirmationCard}
 * rather than on rendered DOM: the card mounts before the confirm promise
 * resolves, so a `confirmError` arriving afterwards does not reach its
 * alert on its own. Asserting the DOM would pass whether or not the guard
 * exists, which is no regression test at all.
 */

jest.mock('../useAiPendingActionPolling', () => ({
  useAiPendingActionPolling: jest.fn(),
}))

jest.mock('../pending-action-api', () => ({
  confirmPendingAction: jest.fn(),
  cancelPendingAction: jest.fn(),
}))

const confirmationCardProps: Array<Record<string, unknown>> = []

jest.mock('../ConfirmationCard', () => ({
  ConfirmationCard: (props: Record<string, unknown>) => {
    confirmationCardProps.push(props)
    return <div data-testid="confirmation-card-stub" />
  },
}))

import { useAiPendingActionPolling } from '../useAiPendingActionPolling'
import { confirmPendingAction } from '../pending-action-api'
import { MutationPreviewCard } from '../MutationPreviewCard'
import type { AiPendingActionCardAction } from '../types'

const dict = {
  'ai_assistant.chat.mutation_cards.preview.title': 'Review proposed changes',
  'ai_assistant.chat.mutation_cards.preview.confirm': 'Confirm',
  'ai_assistant.chat.mutation_cards.preview.cancel': 'Cancel',
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

function lastConfirmError(): unknown {
  const props = confirmationCardProps[confirmationCardProps.length - 1]
  const payload = props?.payload as { confirmError?: unknown } | undefined
  return payload?.confirmError
}

async function clickConfirm() {
  ;(useAiPendingActionPolling as jest.Mock).mockReturnValue({
    action: makeAction(),
    status: 'pending',
    isPolling: false,
    error: null,
    refresh: jest.fn().mockResolvedValue(makeAction()),
  })
  renderWithProviders(
    <MutationPreviewCard
      componentId="mutation-preview-card"
      pendingActionId="pa-1"
    />,
    { dict },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(confirmPendingAction).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByTestId('confirmation-card-stub')).toBeInTheDocument())
}

describe('MutationPreviewCard — 202 confirmation_in_progress', () => {
  beforeEach(() => {
    confirmationCardProps.length = 0
    ;(useAiPendingActionPolling as jest.Mock).mockReset()
    ;(confirmPendingAction as jest.Mock).mockReset()
  })

  it('does not raise a confirm error when another request owns the claim', async () => {
    ;(confirmPendingAction as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        ok: false,
        code: 'confirmation_in_progress',
        pendingAction: makeAction({ status: 'executing' }),
        mutationResult: null,
      },
    })

    await clickConfirm()

    await waitFor(() => expect(confirmationCardProps.length).toBeGreaterThan(0))
    expect(lastConfirmError()).toBeUndefined()
  })

  it('still raises a confirm error for a genuine handler failure (guard is not blanket)', async () => {
    // Contrast case that proves the assertion above discriminates: the same
    // `ok: false` + null `mutationResult` shape WITHOUT the 202 code is a
    // real failure and must still surface the generic execution error.
    ;(confirmPendingAction as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        ok: false,
        pendingAction: makeAction({ status: 'failed' }),
        mutationResult: null,
      },
    })

    await clickConfirm()

    await waitFor(() =>
      expect(lastConfirmError()).toMatchObject({ status: 200, code: 'execution_failed' }),
    )
  })
})
