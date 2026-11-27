/** @jest-environment jsdom */
jest.setTimeout(15000)

// Regression guard for #7497: inside a `DialogContent` (`p-6` + `overflow-y-auto`)
// the sticky CrudForm footer must be pulled down by the dialog padding and paint
// that strip itself, otherwise scrolled fields stay visible below the buttons.
// A nested, unpadded scroller (`InlineRuleEditor`) keeps `bottom-0`, because the
// compensation would hang the footer below that scrollport.
// Geometry is covered by the browser spec TC-CRM-7497; this pins the class
// contract so a refactor cannot silently revert either branch.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn(async () => ({ ok: true, data: {} })) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]

const paddedScrollingDialog: React.CSSProperties = { overflowY: 'auto', padding: '24px' }
const unpaddedClippingDialog: React.CSSProperties = { overflowY: 'hidden', padding: 0 }
const unpaddedScroller: React.CSSProperties = { overflowY: 'auto', padding: 0 }

function renderForm(wrap: (form: React.ReactElement) => React.ReactElement = (form) => form) {
  const form = React.createElement(CrudForm as never, {
    title: 'Deal',
    entityId: 'customers:deal',
    fields,
    embedded: true,
    submitLabel: 'Save deal',
    onSubmit: () => {},
  })
  return renderWithProviders(wrap(form))
}

function footerOf(container: HTMLElement): HTMLElement {
  const submit = container.querySelector('button[type="submit"]')
  expect(submit).toBeTruthy()
  const footer = submit!.closest('form > div:last-child') as HTMLElement | null
  expect(footer).toBeTruthy()
  return footer!
}

describe('CrudForm dialog footer clipping (#7497)', () => {
  it('pulls the sticky footer flush with the dialog edge and paints the padding strip', async () => {
    const { container } = renderForm((form) => (
      <div data-dialog-content="" style={paddedScrollingDialog}>{form}</div>
    ))
    await waitFor(() => expect(container.querySelector('button[type="submit"]')).toBeTruthy())
    const footer = footerOf(container)
    const classes = footer.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['sticky', '-bottom-6', '-mb-6', 'pb-8', 'bg-card', '-mx-6', 'px-6']))
    expect(classes).not.toContain('bottom-0')
  })

  it('keeps the footer at bottom-0 under a nested unpadded scroller', async () => {
    const { container } = renderForm((form) => (
      <div data-dialog-content="" style={unpaddedClippingDialog}>
        <div style={unpaddedScroller}>{form}</div>
      </div>
    ))
    await waitFor(() => expect(container.querySelector('button[type="submit"]')).toBeTruthy())
    const classes = footerOf(container).className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['sticky', 'bottom-0', 'py-2', 'bg-card']))
    for (const compensation of ['-bottom-6', '-mb-6', 'pb-8']) {
      expect(classes).not.toContain(compensation)
    }
  })

  it('keeps the footer at bottom-0 when the scrolling dialog itself has no padding', async () => {
    const { container } = renderForm((form) => (
      <div data-dialog-content="" style={unpaddedScroller}>{form}</div>
    ))
    await waitFor(() => expect(container.querySelector('button[type="submit"]')).toBeTruthy())
    const classes = footerOf(container).className.split(/\s+/)
    expect(classes).toContain('bottom-0')
    expect(classes).not.toContain('-bottom-6')
  })

  it('leaves the footer unpositioned outside a dialog', async () => {
    const { container } = renderForm()
    await waitFor(() => expect(container.querySelector('button[type="submit"]')).toBeTruthy())
    const footer = footerOf(container)
    expect(footer.className.split(/\s+/)).not.toContain('sticky')
  })
})
