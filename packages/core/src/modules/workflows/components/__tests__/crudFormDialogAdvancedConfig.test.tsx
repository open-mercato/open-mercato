/**
 * @jest-environment jsdom
 *
 * Regression guard for the Advanced Configuration value-contract mismatch
 * (PR #4532 review): JsonBuilder calls setValue with the PARSED OBJECT after a
 * valid edit, and saving the CrudForm dialogs used to crash with
 * `values.advancedConfig.trim is not a function`. Editing valid Advanced JSON
 * and submitting must produce the saved update on both dialogs.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NodeEditDialogCrudForm } from '../NodeEditDialogCrudForm'
import { EdgeEditDialogCrudForm } from '../EdgeEditDialogCrudForm'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

jest.mock('@open-mercato/ui/backend/JsonBuilder', () => ({
  JsonBuilder: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button
      type="button"
      data-testid="json-builder-emit"
      onClick={() => onChange({ retryPolicy: { maxAttempts: 7 } })}
    >
      emit advanced config
    </button>
  ),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/backend/workflows',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn().mockResolvedValue({ ok: true, status: 200, result: { items: [] }, response: {}, cacheStatus: null }),
}))

describe('NodeEditDialogCrudForm — Advanced Configuration submission', () => {
  it('saves the object JsonBuilder emits after a valid Advanced JSON edit', async () => {
    const onSave = jest.fn()
    renderWithProviders(
      <NodeEditDialogCrudForm
        node={{
          id: 'decision-1',
          type: 'decision',
          position: { x: 0, y: 0 },
          data: { stepName: 'Decide' },
        } as any}
        isOpen
        onClose={jest.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByTestId('json-builder-emit'))
    fireEvent.click(screen.getByRole('button', { name: 'workflows.form.saveStep' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'decision-1',
        expect.objectContaining({
          stepName: 'Decide',
          retryPolicy: { maxAttempts: 7 },
        }),
      )
    })
  })
})

describe('EdgeEditDialogCrudForm — Advanced Configuration submission', () => {
  it('saves the object JsonBuilder emits after a valid Advanced JSON edit', async () => {
    const onSave = jest.fn()
    renderWithProviders(
      <EdgeEditDialogCrudForm
        edge={{
          id: 'start_to_end',
          source: 'start',
          target: 'end',
          data: { transitionName: 'Proceed', trigger: 'auto', activities: [] },
        } as any}
        isOpen
        onClose={jest.fn()}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('json-builder-emit'))
    fireEvent.click(screen.getByRole('button', { name: 'workflows.edgeEditor.saveTransition' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'start_to_end',
        expect.objectContaining({
          transitionName: 'Proceed',
          retryPolicy: { maxAttempts: 7 },
        }),
      )
    })
  })
})
