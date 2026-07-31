/**
 * @jest-environment jsdom
 *
 * Definition metadata round trip: open → edit every field → save.
 *
 * The metadata form moved out of an inline band above the canvas and into a
 * right-side Drawer. Several past bugs in this module were fields silently
 * dropped on save, so this pins the payload rather than the layout: every
 * editable field has to reach the PUT body with its edited value, and every
 * pass-through key the editor does not edit (contextSchema, io, interpolation,
 * errorHandler, unknown metadata keys) has to survive untouched.
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const DEFINITION_ID = '11111111-1111-4111-8111-111111111111'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? DEFINITION_ID : null), toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

const LOADED_DEFINITION = {
  id: DEFINITION_ID,
  workflowId: 'checkout_workflow',
  workflowName: 'Checkout',
  description: 'Original description',
  version: 3,
  enabled: true,
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  source: 'user',
  updatedAt: '2026-07-01T00:00:00.000Z',
  metadata: {
    category: 'E-Commerce',
    tags: ['checkout'],
    icon: 'shopping-cart',
    // An unknown key the editor never renders — it must survive the round trip.
    thirdPartyBag: { keep: 'me' },
  },
  definition: {
    workflowId: 'checkout_workflow',
    workflowName: 'Checkout',
    steps: [
      { stepId: 'start_1', stepType: 'START', stepName: 'Start' },
      { stepId: 'end_1', stepType: 'END', stepName: 'End' },
    ],
    transitions: [
      { transitionId: 't_1', fromStepId: 'start_1', toStepId: 'end_1', trigger: 'auto', priority: 100 },
    ],
    contextSchema: { input: { fields: [{ name: 'dealId', type: 'text', required: true }] } },
    io: { inputs: [{ name: 'dealId', type: 'text', label: 'Deal ID' }] },
    interpolation: 'strict',
    errorHandler: { workflowId: 'incident_workflow' },
  },
}

type ApiCallArgs = [string, RequestInit | undefined]
const apiCalls: ApiCallArgs[] = []

const apiCallMock = jest.fn(async (url: string, init?: RequestInit) => {
  apiCalls.push([url, init])
  if (init?.method === 'PUT' && url.includes('/api/workflows/definitions/')) {
    return { ok: true, status: 200, result: { data: { id: DEFINITION_ID } } }
  }
  if (url.endsWith('/draft')) {
    return { ok: true, status: 200, result: { data: undefined } }
  }
  if (url === `/api/workflows/definitions/${DEFINITION_ID}`) {
    return { ok: true, status: 200, result: { data: LOADED_DEFINITION } }
  }
  return { ok: true, status: 200, result: { data: null } }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCallMock(...(args as ApiCallArgs)),
  }
})

jest.mock('@open-mercato/ui/backend/inputs/EventSelect', () => ({
  useAvailableEvents: () => ({ events: [], isLoading: false }),
  EventSelect: () => null,
}))

jest.mock('../../../../components/TemplateGalleryDialog', () => ({ TemplateGalleryDialog: () => null }))
jest.mock('../../../../components/NodeEditDialogCrudForm', () => ({ NodeEditDialogCrudForm: () => null }))
jest.mock('../../../../components/NodeEditDialog', () => ({ NodeEditDialog: () => null }))
jest.mock('../../../../components/EdgeEditDialogCrudForm', () => ({ EdgeEditDialogCrudForm: () => null }))
jest.mock('../../../../components/EdgeEditDialog', () => ({ EdgeEditDialog: () => null }))
jest.mock('../../../../components/WorkflowGraph', () => ({
  WorkflowGraph: () => <div data-testid="canvas" />,
  WorkflowGraphReadOnly: () => null,
}))

import VisualEditorPage from '../page'

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (<T,>(value: T): T => JSON.parse(JSON.stringify(value))) as typeof structuredClone
}

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

function field(id: string): HTMLInputElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`[internal] no field #${id}`)
  return element as HTMLInputElement
}

async function type(id: string, value: string) {
  await act(async () => {
    fireEvent.change(field(id), { target: { value } })
  })
}

function drawer(): HTMLElement {
  const content = document.querySelector('[data-slot="drawer-content"]')
  if (!content) throw new Error('[internal] drawer is not open')
  return content as HTMLElement
}

function lastPutBody(): Record<string, unknown> {
  const put = [...apiCalls].reverse().find(([url, init]) => init?.method === 'PUT' && url.includes('/definitions/'))
  if (!put) throw new Error('[internal] no PUT recorded')
  return JSON.parse(String(put[1]?.body))
}

describe('workflow definition metadata drawer', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
    apiCalls.length = 0
    apiCallMock.mockClear()
  })

  async function renderLoaded() {
    await act(async () => {
      renderWithProviders(<VisualEditorPage />)
    })
    await waitFor(() => expect(screen.getByTestId('canvas')).toBeTruthy())
  }

  async function openDrawer() {
    // Settings (the metadata drawer trigger) now lives in the toolbar's "More"
    // overflow menu.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^More$/i }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^Settings$/i }))
    })
  }

  test('the drawer is closed until asked for, so the canvas keeps the whole page', async () => {
    await renderLoaded()
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
    expect(document.getElementById('workflowName')).toBeNull()

    await openDrawer()
    expect(drawer()).toBeTruthy()
    expect(field('workflowName').value).toBe('Checkout')
  })

  test('the identity key is read-only on an existing definition', async () => {
    await renderLoaded()
    await openDrawer()
    expect(field('workflowId').disabled).toBe(true)
    expect(field('version').disabled).toBe(true)
  })

  test('Escape closes the drawer', async () => {
    await renderLoaded()
    await openDrawer()
    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Escape' })
    })
    await waitFor(() => expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull())
  })

  test('every edited field reaches the save payload, and pass-through keys survive', async () => {
    await renderLoaded()
    await openDrawer()

    await type('workflowName', 'Checkout v2')
    await type('description', 'A much longer description that the old band clipped mid-sentence.')
    await type('category', 'Retail')
    await type('effectiveFrom', '2027-02-01')
    await type('effectiveTo', '2027-11-30')
    // The icon picker keeps a free-text fallback behind its popover; that is
    // the field an unknown icon name is stored through.
    await act(async () => {
      fireEvent.click(field('icon'))
    })
    await type('icon-custom', 'package')
    await act(async () => {
      fireEvent.click(field('enabled'))
    })

    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Enter', metaKey: true })
    })

    await waitFor(() => expect(lastPutBody()).toBeTruthy())
    const body = lastPutBody()

    expect(body.workflowName).toBe('Checkout v2')
    expect(body.description).toBe('A much longer description that the old band clipped mid-sentence.')
    expect(body.version).toBe(3)
    expect(body.enabled).toBe(false)
    expect(body.effectiveFrom).toBe('2027-02-01')
    expect(body.effectiveTo).toBe('2027-11-30')

    const metadata = body.metadata as Record<string, unknown>
    expect(metadata.category).toBe('Retail')
    expect(metadata.icon).toBe('package')
    expect(metadata.tags).toEqual(['checkout'])
    expect(metadata.thirdPartyBag).toEqual({ keep: 'me' })

    const definition = body.definition as Record<string, unknown>
    expect(definition.contextSchema).toEqual(LOADED_DEFINITION.definition.contextSchema)
    expect(definition.io).toEqual(LOADED_DEFINITION.definition.io)
    expect(definition.interpolation).toBe('strict')
    expect(definition.errorHandler).toEqual(LOADED_DEFINITION.definition.errorHandler)
  })

  test('Cmd+Enter inside the nested trigger dialog does not save the workflow', async () => {
    await renderLoaded()
    await openDrawer()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add Trigger/i }))
    })

    const triggerDialog = screen.getByRole('dialog', { name: /Create Event Trigger/i })
    await act(async () => {
      fireEvent.keyDown(triggerDialog, { key: 'Enter', metaKey: true })
    })

    // Radix portals the dialog outside the drawer's DOM subtree but inside its
    // React tree, so without the guard this keystroke saved a workflow from a
    // half-filled trigger form.
    expect(apiCalls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  test('Cmd+Enter in the drawer saves, matching the project-wide dialog rule', async () => {
    await renderLoaded()
    await openDrawer()
    await type('workflowName', 'Saved by shortcut')

    await act(async () => {
      fireEvent.keyDown(drawer(), { key: 'Enter', metaKey: true })
    })

    await waitFor(() => expect(lastPutBody().workflowName).toBe('Saved by shortcut'))
  })
})
