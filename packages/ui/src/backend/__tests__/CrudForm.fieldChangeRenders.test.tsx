/** @jest-environment jsdom */
const triggerEventMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
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
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudFormGroup } from '../CrudForm'

describe('CrudForm field-change render cost', () => {
  beforeEach(() => {
    triggerEventMock.mockReset()
    triggerEventMock.mockImplementation(async (_event: string, data: Record<string, unknown>) => ({ ok: true, data }))
  })

  it('renders the form once per steady-state edit when no widget answers the field-change event', async () => {
    const groupRender = jest.fn()
    const groups: CrudFormGroup[] = [{
      id: 'details',
      bare: true,
      component: ({ values, setValue }) => {
        groupRender()
        return <input aria-label="Draft title" value={String(values.title ?? '')} onChange={(event) => setValue('title', event.target.value)} />
      },
    }]
    renderWithProviders(
      <CrudForm embedded fields={[]} groups={groups} initialValues={{ title: '' }} injectionSpotId="example:field-change" onSubmit={() => {}} />,
    )
    await act(async () => { await Promise.resolve() })
    const rendersPerEdit: number[] = []
    for (const value of ['a', 'ab', 'abc', 'abcd']) {
      groupRender.mockClear()
      triggerEventMock.mockClear()
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Draft title'), { target: { value } })
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(screen.getByLabelText('Draft title')).toHaveValue(value)
      expect(triggerEventMock.mock.calls.filter(([event]) => event === 'onFieldChange')).toHaveLength(1)
      rendersPerEdit.push(groupRender.mock.calls.length)
    }
    expect(rendersPerEdit.slice(1)).toEqual([1, 1, 1])
  })
})
