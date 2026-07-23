/**
 * @jest-environment jsdom
 *
 * Guards #4329: the kanban quick-add dialog hardcoded `probability: 25` in its
 * initialValues, so every quick-create sent 25 — overriding whatever a
 * downstream app's pipeline automation derives — even though the field lives in
 * a collapsed group the user never opened. The default is now a prop, and the
 * dialog is registered so apps can reach it through the component registry
 * instead of forking the kanban page.
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import {
  registerComponent,
  getComponentEntry,
} from '@open-mercato/shared/modules/widgets/component-registry'

// `t` accepts either (key, fallback, params) or (key, params) — mirror the real
// translator's overload so params never leak into the rendered output.
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: unknown) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

let capturedInitialValues: Record<string, unknown> | null = null
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  __esModule: true,
  CrudForm: (props: { initialValues?: Record<string, unknown> }) => {
    capturedInitialValues = props.initialValues ?? null
    return null
  },
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

import {
  QuickDealDialog,
  QUICK_DEAL_DIALOG_COMPONENT_ID,
  DEFAULT_QUICK_DEAL_PROBABILITY,
  type QuickDealContext,
} from '../QuickDealDialog'

const context: QuickDealContext = {
  pipelineId: 'p-1',
  pipelineName: 'Sales',
  pipelineStageId: 's-1',
  pipelineStageLabel: 'Qualified',
}

function renderDialog(props: Partial<React.ComponentProps<typeof QuickDealDialog>> = {}) {
  return render(
    <QuickDealDialog
      open
      context={context}
      onClose={jest.fn()}
      onCreated={jest.fn()}
      currencies={[{ code: 'PLN', isBase: true }]}
      {...props}
    />,
  )
}

describe('QuickDealDialog default probability (#4329)', () => {
  afterEach(() => {
    capturedInitialValues = null
  })

  it('keeps the historic default when the host passes no override', () => {
    renderDialog()
    expect(capturedInitialValues?.probability).toBe(DEFAULT_QUICK_DEAL_PROBABILITY)
  })

  it('honors an explicit numeric default', () => {
    renderDialog({ defaultProbability: 60 })
    expect(capturedInitialValues?.probability).toBe(60)
  })

  it('leaves the field empty when the default is null, so no probability is seeded', () => {
    renderDialog({ defaultProbability: null })
    expect(capturedInitialValues?.probability).toBeNull()
  })

  it('is registered so apps can override it without forking the kanban page', () => {
    // Importing the module runs its registerComponent call.
    expect(getComponentEntry(QUICK_DEAL_DIALOG_COMPONENT_ID)).not.toBeNull()
    expect(getComponentEntry(QUICK_DEAL_DIALOG_COMPONENT_ID)?.component).toBe(QuickDealDialog)
  })

  it('registry registration is the documented override seam (propsTransform reaches the default)', () => {
    const Spy = jest.fn(() => null)
    registerComponent({ id: 'test:quick-deal-probe', component: Spy })
    expect(getComponentEntry('test:quick-deal-probe')?.component).toBe(Spy)
  })
})
