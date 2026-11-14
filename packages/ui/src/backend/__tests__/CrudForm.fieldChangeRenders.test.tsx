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

const mockControlRender = jest.fn()
jest.mock('../../primitives/textarea', () => {
  const actual = jest.requireActual('../../primitives/textarea')
  const ReactActual = jest.requireActual('react')
  return {
    ...actual,
    Textarea: ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockControlRender('textarea')
      return ReactActual.createElement(actual.Textarea, { ...props, ref })
    }),
  }
})
jest.mock('../../primitives/checkbox', () => {
  const actual = jest.requireActual('../../primitives/checkbox')
  const ReactActual = jest.requireActual('react')
  return {
    ...actual,
    Checkbox: ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockControlRender('checkbox')
      return ReactActual.createElement(actual.Checkbox, { ...props, ref })
    }),
  }
})

import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

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

  it('leaves the other fields alone while one field is being typed in', async () => {
    const fields: CrudField[] = [
      { id: 'title', label: 'Title', type: 'text', required: true },
      { id: 'notes', label: 'Notes', type: 'textarea' },
      { id: 'flag', label: 'Flag', type: 'checkbox' },
    ]
    const rendered = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ title: '', notes: 'keep', flag: false }} injectionSpotId="example:field-change" onSubmit={() => {}} />,
      { dict: { 'ui.forms.actions.save': 'Save', 'ui.forms.errors.required': 'Required' } },
    )
    const input = rendered.container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement
    const edit = async (value: string) => {
      await act(async () => {
        fireEvent.change(input, { target: { value } })
        await Promise.resolve()
      })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(mockControlRender).toHaveBeenCalledWith('textarea')
    expect(mockControlRender).toHaveBeenCalledWith('checkbox')
    await edit('a')
    mockControlRender.mockClear()
    await edit('ab')
    await edit('abc')
    expect(input).toHaveValue('abc')
    expect(mockControlRender).not.toHaveBeenCalled()

    // The stable blur callback must still validate against the latest values.
    await act(async () => { fireEvent.blur(input) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(screen.queryByText('Required')).not.toBeInTheDocument()
    await edit('')
    await act(async () => { fireEvent.blur(input) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(await screen.findByText('Required')).toBeInTheDocument()
  })
})
