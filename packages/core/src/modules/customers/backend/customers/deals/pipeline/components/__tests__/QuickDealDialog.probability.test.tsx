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
  getComponentEntry,
  registerComponentOverrides,
  resolveRegisteredComponent,
} from '@open-mercato/shared/modules/widgets/component-registry'

// `t` accepts either (key, fallback, params) or (key, params) — mirror the real
// translator's overload so params never leak into the rendered output.
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: unknown) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

let capturedInitialValues: Record<string, unknown> | null = null
let capturedOnSubmit: ((values: Record<string, unknown>) => Promise<void>) | null = null
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  __esModule: true,
  CrudForm: (props: {
    initialValues?: Record<string, unknown>
    onSubmit?: (values: Record<string, unknown>) => Promise<void>
  }) => {
    capturedInitialValues = props.initialValues ?? null
    capturedOnSubmit = props.onSubmit ?? null
    return null
  },
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))
const mockCreateCrud = jest.fn().mockResolvedValue({})
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
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
    capturedOnSubmit = null
    mockCreateCrud.mockClear()
    registerComponentOverrides([])
  })

  it('keeps the historic default when the host passes no override', () => {
    renderDialog()
    expect(capturedInitialValues?.probability).toBe(DEFAULT_QUICK_DEAL_PROBABILITY)
  })

  it('honors an explicit numeric default', () => {
    renderDialog({ defaultProbability: 60 })
    expect(capturedInitialValues?.probability).toBe(60)
  })

  it('leaves the field empty when the default is null', () => {
    renderDialog({ defaultProbability: null })
    expect(capturedInitialValues?.probability).toBeNull()
  })

  it('omits probability from the create payload when the default is null', async () => {
    renderDialog({ defaultProbability: null })

    await capturedOnSubmit?.({
      ...capturedInitialValues,
      title: 'Derived probability deal',
    })

    expect(mockCreateCrud).toHaveBeenCalledWith(
      'customers/deals',
      expect.not.objectContaining({ probability: expect.anything() }),
      expect.any(Object),
    )
  })

  it('includes an explicit numeric probability in the create payload', async () => {
    renderDialog({ defaultProbability: 60 })

    await capturedOnSubmit?.({
      ...capturedInitialValues,
      title: 'Explicit probability deal',
    })

    expect(mockCreateCrud).toHaveBeenCalledWith(
      'customers/deals',
      expect.objectContaining({ probability: 60 }),
      expect.any(Object),
    )
  })

  it('is registered so apps can override it without forking the kanban page', () => {
    // Importing the module runs its registerComponent call.
    expect(getComponentEntry(QUICK_DEAL_DIALOG_COMPONENT_ID)).not.toBeNull()
    expect(getComponentEntry(QUICK_DEAL_DIALOG_COMPONENT_ID)?.component).toBe(QuickDealDialog)
  })

  it('allows a propsTransform override to clear the default probability', () => {
    registerComponentOverrides([
      {
        target: { componentId: QUICK_DEAL_DIALOG_COMPONENT_ID },
        priority: 50,
        metadata: { module: 'test' },
        propsTransform: (props: React.ComponentProps<typeof QuickDealDialog>) => ({
          ...props,
          defaultProbability: null,
        }),
      },
    ])
    const Resolved = resolveRegisteredComponent(
      QUICK_DEAL_DIALOG_COMPONENT_ID,
      QuickDealDialog,
    )

    render(
      <Resolved
        open
        context={context}
        onClose={jest.fn()}
        onCreated={jest.fn()}
        currencies={[{ code: 'PLN', isBase: true }]}
      />,
    )

    expect(capturedInitialValues?.probability).toBeNull()
  })
})
