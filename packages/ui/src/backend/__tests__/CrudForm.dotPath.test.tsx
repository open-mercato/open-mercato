/** @jest-environment jsdom */
jest.setTimeout(15000)

// Regression coverage for issue #2503 ("Latent framework gap"): CrudForm must
// honor dot-path ids for declared base fields — hydrate the flat key from nested
// initial values on load, and project the flat key back into a nested object
// before schema.safeParse on submit. The fix coexists with forms whose schema
// declares the flat dot-path key directly (the module-local remedy shipped in
// PR #2513), because the non-strict parse keeps whichever shape the schema declares.

const triggerEventMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerEventMock }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { z } from 'zod'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const dict = { 'ui.forms.actions.save': 'Save' }

const dotPathFields: CrudField[] = [
  { id: 'workflowName', label: 'Name', type: 'text' },
  { id: 'metadata.category', label: 'Category', type: 'text' },
]

function flushMicrotasks() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('CrudForm dot-path base fields (issue #2503)', () => {
  beforeEach(() => {
    triggerEventMock.mockReset()
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'onBeforeSave') return { ok: true }
      if (event === 'onAfterSave') return { ok: true }
      return { ok: true, data }
    })
    window.history.replaceState({}, '', '/current')
  })

  it('hydrates a declared dot-path field from nested initial values on load', async () => {
    renderWithProviders(
      <CrudForm
        title="Edit"
        fields={dotPathFields}
        initialValues={{ id: 'wf-1', workflowName: 'Pipeline', metadata: { category: 'Sales' } } as any}
        onSubmit={() => {}}
      />,
      { dict },
    )

    await flushMicrotasks()

    // The Category input reads values['metadata.category'], hydrated from the
    // nested metadata.category in initialValues.
    expect(screen.queryByDisplayValue('Sales')).toBeInTheDocument()
  })

  it('collapses the flat dot-path key into a nested object for a nested schema on save', async () => {
    const schema = z.object({
      workflowName: z.string(),
      metadata: z
        .object({ category: z.string().optional() })
        .optional()
        .nullable(),
    })

    function Harness() {
      const [submitted, setSubmitted] = React.useState<Record<string, unknown> | null>(null)
      return (
        <>
          <CrudForm
            title="Edit"
            fields={dotPathFields}
            schema={schema as any}
            initialValues={{ id: 'wf-1', workflowName: 'Pipeline', metadata: { category: 'Sales' } } as any}
            onSubmit={(values) => setSubmitted(values as Record<string, unknown>)}
          />
          <div data-testid="submitted">{JSON.stringify(submitted)}</div>
        </>
      )
    }

    const { container } = renderWithProviders(<Harness />, { dict })
    await flushMicrotasks()

    const categoryInput = container.querySelector(
      '[data-crud-field-id="metadata.category"] input[type="text"]',
    ) as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.change(categoryInput, { target: { value: 'qa-category-2466' } })
      fireEvent.blur(categoryInput)
    })

    await act(async () => {
      fireEvent.submit(form)
      await Promise.resolve()
      await Promise.resolve()
    })

    const submitted = JSON.parse(screen.getByTestId('submitted').textContent || 'null')
    expect(submitted).not.toBeNull()
    // Edited value is reassembled into the nested metadata object the schema declares.
    expect(submitted.metadata).toEqual({ category: 'qa-category-2466' })
    // The flat dot-path key is stripped by the non-strict parse for a nested schema.
    expect(submitted['metadata.category']).toBeUndefined()
  })

  it('preserves the flat dot-path key for a schema that declares it directly (PR #2513 coexistence)', async () => {
    const schema = z.object({
      workflowName: z.string(),
      'metadata.category': z.string().optional(),
    })

    function Harness() {
      const [submitted, setSubmitted] = React.useState<Record<string, unknown> | null>(null)
      return (
        <>
          <CrudForm
            title="Edit"
            fields={dotPathFields}
            schema={schema as any}
            initialValues={{ id: 'wf-1', workflowName: 'Pipeline', metadata: { category: 'Sales' } } as any}
            onSubmit={(values) => setSubmitted(values as Record<string, unknown>)}
          />
          <div data-testid="submitted">{JSON.stringify(submitted)}</div>
        </>
      )
    }

    const { container } = renderWithProviders(<Harness />, { dict })
    await flushMicrotasks()

    const categoryInput = container.querySelector(
      '[data-crud-field-id="metadata.category"] input[type="text"]',
    ) as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.change(categoryInput, { target: { value: 'qa-category-2466' } })
      fireEvent.blur(categoryInput)
    })

    await act(async () => {
      fireEvent.submit(form)
      await Promise.resolve()
      await Promise.resolve()
    })

    const submitted = JSON.parse(screen.getByTestId('submitted').textContent || 'null')
    expect(submitted).not.toBeNull()
    // A flat-key schema keeps the flat representation untouched.
    expect(submitted['metadata.category']).toBe('qa-category-2466')
    expect(submitted.metadata).toBeUndefined()
  })

  it('does not flag a required nested field on blur once the dot-path input is filled', async () => {
    const schema = z.object({
      workflowName: z.string(),
      metadata: z.object({ category: z.string().min(1) }),
    })

    const { container } = renderWithProviders(
      <CrudForm
        title="Edit"
        fields={dotPathFields}
        schema={schema as any}
        initialValues={{ id: 'wf-1', workflowName: 'Pipeline', metadata: { category: 'Sales' } } as any}
        onSubmit={() => {}}
      />,
      { dict },
    )

    await flushMicrotasks()

    const categoryInput = container.querySelector(
      '[data-crud-field-id="metadata.category"] input[type="text"]',
    ) as HTMLInputElement

    await act(async () => {
      fireEvent.change(categoryInput, { target: { value: 'qa-category-2466' } })
      fireEvent.blur(categoryInput)
      await Promise.resolve()
      await Promise.resolve()
    })

    // Blur validation collapses the flat key before schema.safeParse, so the
    // required nested metadata.category is seen as satisfied — no error surfaces.
    const fieldContainer = container.querySelector('[data-crud-field-id="metadata.category"]') as HTMLElement
    expect(fieldContainer.querySelector('.text-status-error-text')).toBeNull()
  })

  it('merges multiple dot-path fields sharing a parent into one nested object', async () => {
    const fields: CrudField[] = [
      { id: 'workflowName', label: 'Name', type: 'text' },
      { id: 'metadata.category', label: 'Category', type: 'text' },
      { id: 'metadata.icon', label: 'Icon', type: 'text' },
    ]
    const schema = z.object({
      workflowName: z.string(),
      metadata: z
        .object({ category: z.string().optional(), icon: z.string().optional() })
        .optional(),
    })

    function Harness() {
      const [submitted, setSubmitted] = React.useState<Record<string, unknown> | null>(null)
      return (
        <>
          <CrudForm
            title="Edit"
            fields={fields}
            schema={schema as any}
            initialValues={{
              id: 'wf-1',
              workflowName: 'Pipeline',
              metadata: { category: 'Sales', icon: 'shopping-cart' },
            } as any}
            onSubmit={(values) => setSubmitted(values as Record<string, unknown>)}
          />
          <div data-testid="submitted">{JSON.stringify(submitted)}</div>
        </>
      )
    }

    const { container } = renderWithProviders(<Harness />, { dict })
    await flushMicrotasks()

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      fireEvent.submit(form)
      await Promise.resolve()
      await Promise.resolve()
    })

    const submitted = JSON.parse(screen.getByTestId('submitted').textContent || 'null')
    expect(submitted.metadata).toEqual({ category: 'Sales', icon: 'shopping-cart' })
  })

  it('does not pollute Object.prototype via a prototype-polluting dot-path field id', async () => {
    const maliciousFields: CrudField[] = [
      { id: 'workflowName', label: 'Name', type: 'text' },
      { id: '__proto__.polluted', label: 'Evil', type: 'text' },
    ]
    const schema = z.object({ workflowName: z.string() }).passthrough()

    function Harness() {
      const [submitted, setSubmitted] = React.useState<Record<string, unknown> | null>(null)
      return (
        <>
          <CrudForm
            title="Edit"
            fields={maliciousFields}
            schema={schema as any}
            initialValues={{ id: 'wf-1', workflowName: 'Pipeline', '__proto__.polluted': 'pwned' } as any}
            onSubmit={(values) => setSubmitted(values as Record<string, unknown>)}
          />
          <div data-testid="submitted">{JSON.stringify(submitted)}</div>
        </>
      )
    }

    const { container } = renderWithProviders(<Harness />, { dict })
    await flushMicrotasks()

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      fireEvent.submit(form)
      await Promise.resolve()
      await Promise.resolve()
    })

    // The collapse step must skip prototype-polluting segments entirely, so
    // neither a fresh object nor Object.prototype gains the injected key.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined()
    // The submit still completes for the legitimate fields.
    const submitted = JSON.parse(screen.getByTestId('submitted').textContent || 'null')
    expect(submitted).not.toBeNull()
    expect(submitted.workflowName).toBe('Pipeline')
  })
})
