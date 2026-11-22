/**
 * @jest-environment jsdom
 */

type CapturedProps = {
  initialValues?: Record<string, unknown>
  fields?: Array<{ id: string; type: string }>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
}

let captured: CapturedProps | null = null

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedProps) => {
    captured = props
    return null
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('../hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({
    data: { entries: [], defaultCode: null },
    isLoading: false,
    refetch: jest.fn(async () => ({ data: { entries: [], defaultCode: null } })),
  }),
  ensureCurrencyDictionary: jest.fn(async () => ({ entries: [], defaultCode: null })),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealForm } from '../DealForm'

const EXACT_VALUE = '25.123456789012345678'

function renderForm(initialValues: Record<string, unknown>, onSubmit: jest.Mock): CapturedProps {
  captured = null
  renderWithProviders(<DealForm mode="edit" initialValues={initialValues} onSubmit={onSubmit} />)
  if (!captured) throw new Error('[internal] CrudForm props were not captured')
  return captured
}

describe('DealForm — exact deal value', () => {
  it('edits the value as an exact decimal seeded from the exact sibling', () => {
    const props = renderForm(
      { id: 'deal-1', title: 'Renewal', valueAmount: Number(EXACT_VALUE), valueAmountExact: EXACT_VALUE },
      jest.fn(async () => {}),
    )
    expect(props.initialValues?.valueAmount).toBe(EXACT_VALUE)
    expect(props.fields?.find((field) => field.id === 'valueAmount')?.type).toBe('decimal')
  })

  it('submits every stored digit when only the title changes', async () => {
    const onSubmit = jest.fn(async () => {})
    const props = renderForm(
      { id: 'deal-1', title: 'Renewal', valueAmount: Number(EXACT_VALUE), valueAmountExact: EXACT_VALUE, valueCurrency: 'ETH' },
      onSubmit,
    )
    await props.onSubmit({ ...props.initialValues, title: 'Renewal 2027' })
    const base = onSubmit.mock.calls[0][0].base as Record<string, unknown>
    expect(base.title).toBe('Renewal 2027')
    expect(base.valueAmountExact).toBe(EXACT_VALUE)
    expect(base.valueAmount).toBe(Number(EXACT_VALUE))
  })

  it('falls back to the float copy for values mapped without an exact sibling', () => {
    const props = renderForm({ id: 'deal-1', title: 'Renewal', valueAmount: 1500.5 }, jest.fn(async () => {}))
    expect(props.initialValues?.valueAmount).toBe('1500.5')
  })

  it('rejects a negative value', async () => {
    const onSubmit = jest.fn(async () => {})
    const props = renderForm({ id: 'deal-1', title: 'Renewal' }, onSubmit)
    await expect(props.onSubmit({ title: 'Renewal', valueAmount: '-1' })).rejects.toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
