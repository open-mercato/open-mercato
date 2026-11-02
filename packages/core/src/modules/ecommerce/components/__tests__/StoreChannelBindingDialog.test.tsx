/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { StoreChannelBindingDialog } from '../StoreChannelBindingDialog'
import { ChannelBindingLiveCount } from '../ChannelBindingFormSections'
import type { AssortmentCountResult, ChannelBindingFormValues, ChannelBindingRecord } from '../storeChannels'

type CapturedField = {
  id: string
  type: string
  disabled?: boolean
  description?: string
  label: string
  options?: Array<{ value: string; label: string }>
}
type CapturedGroup = { id: string; title?: string; description?: string; component?: (ctx: { values: Record<string, unknown> }) => React.ReactNode }
type CapturedForm = {
  fields: CapturedField[]
  groups: CapturedGroup[]
  initialValues: ChannelBindingFormValues
  optimisticLockUpdatedAt?: string | null
  readOnly?: boolean
  onSubmit: (values: ChannelBindingFormValues) => Promise<void>
}

const apiCallMock = jest.fn()
const createCrudMock = jest.fn()
const updateCrudMock = jest.fn()
const flashMock = jest.fn()
const forms: CapturedForm[] = []

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string>) => {
    const text = fallback ?? key
    return params ? text.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '') : text
  },
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => createCrudMock(...args),
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedForm) => {
    forms.push(props)
    return (
      <div data-testid="binding-form">
        {props.groups.map((group) => (
          <div key={group.id} data-testid={`group-${group.id}`}>
            {group.component?.({ values: props.initialValues })}
          </div>
        ))}
      </div>
    )
  },
}))

const CATEGORY = '11111111-1111-4111-8111-111111111111'
const TAG = '22222222-2222-4222-8222-222222222222'

function existing(overrides: Partial<ChannelBindingRecord> = {}): ChannelBindingRecord {
  return {
    id: 'binding-1',
    storeId: 'store-1',
    salesChannelId: 'channel-1',
    priceKindId: null,
    assortmentScope: { categoryIds: [CATEGORY] },
    priceSortFallback: 'approximate',
    isDefault: false,
    requireAuthentication: false,
    createdAt: null,
    updatedAt: '2026-10-06T10:00:00.000Z',
    ...overrides,
  }
}

function countResult(overrides: Partial<AssortmentCountResult> = {}): AssortmentCountResult {
  return {
    count: 12,
    scopeSource: 'draft',
    requireAuthentication: false,
    reducedByAuthentication: false,
    countWithoutAuthentication: 12,
    unindexedCount: 0,
    ...overrides,
  }
}

function renderDialog(props: { binding?: ChannelBindingRecord | null; firstBinding?: boolean; readOnly?: boolean }) {
  const onSaved = jest.fn().mockResolvedValue(undefined)
  const onOpenChange = jest.fn()
  render(
    <StoreChannelBindingDialog
      open
      onOpenChange={onOpenChange}
      storeId="store-1"
      binding={props.binding ?? null}
      firstBinding={props.firstBinding ?? false}
      readOnly={props.readOnly ?? false}
      onSaved={onSaved}
    />,
  )
  return { form: forms[forms.length - 1], onSaved, onOpenChange }
}

function field(form: CapturedForm, id: string): CapturedField | undefined {
  return form.fields.find((candidate) => candidate.id === id)
}

describe('StoreChannelBindingDialog', () => {
  beforeEach(() => {
    apiCallMock.mockReset().mockResolvedValue({ ok: true, result: countResult() })
    createCrudMock.mockReset().mockResolvedValue({ ok: true })
    updateCrudMock.mockReset().mockResolvedValue({ ok: true })
    flashMock.mockReset()
    forms.length = 0
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('offers include pickers for categories and tags and exclude pickers for products, categories and tags', () => {
    const { form } = renderDialog({})
    const include = form.groups.find((group) => group.id === 'scopeInclude')
    const exclude = form.groups.find((group) => group.id === 'scopeExclude')
    expect(include).toMatchObject({ fields: ['categoryIds', 'tagIds'] })
    expect(exclude).toMatchObject({ fields: ['excludeProductIds', 'excludeCategoryIds', 'excludeTagIds'] })
    expect(include?.description).toMatch(/never hides everything/)
  })

  it('defaults require-authentication off and the fallback to approximate, and says what the switch governs', () => {
    const { form } = renderDialog({})
    expect(form.initialValues.requireAuthentication).toBe(false)
    expect(form.initialValues.priceSortFallback).toBe('approximate')
    expect(field(form, 'requireAuthentication')?.description).toMatch(/catalog visibility only, not the whole storefront/)
    expect(field(form, 'priceSortFallback')?.options?.map((option) => option.value)).toEqual(['approximate', 'unavailable'])
    expect(field(form, 'priceSortFallback')?.label).toBe('Price sorting past 5,000 products')
  })

  it('states the consequence of each fallback and names the 5,000 cap', () => {
    const { form } = renderDialog({})
    const consequence = form.groups.find((group) => group.id === 'priceSortConsequence')
    const approximate = render(<>{consequence?.component?.({ values: { priceSortFallback: 'approximate' } })}</>)
    expect(within(approximate.container).getByTestId('price-sort-fallback-consequence').textContent).toMatch(
      /more than 5,000 products match, the price order is computed from the default price kind/,
    )
    const unavailable = render(<>{consequence?.component?.({ values: { priceSortFallback: 'unavailable' } })}</>)
    expect(within(unavailable.container).getByTestId('price-sort-fallback-consequence').textContent).toMatch(
      /price ascending and descending are no longer offered.*default order rather than an error/,
    )
  })

  it('creates a binding whose cleared pickers send no restriction, with the require-authentication switch', async () => {
    const { form, onSaved, onOpenChange } = renderDialog({ firstBinding: true })
    expect(form.initialValues.isDefault).toBe(true)
    await form.onSubmit({ ...form.initialValues, salesChannelId: 'channel-9', requireAuthentication: true })
    expect(createCrudMock).toHaveBeenCalledWith(
      'ecommerce/store-channel-bindings',
      {
        storeId: 'store-1',
        salesChannelId: 'channel-9',
        priceKindId: null,
        assortmentScope: null,
        priceSortFallback: 'approximate',
        requireAuthentication: true,
        isDefault: true,
      },
      expect.objectContaining({ errorMessage: expect.any(String) }),
    )
    expect(flashMock).toHaveBeenCalledWith('Channel binding added', 'success')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSaved).toHaveBeenCalled()
  })

  it('updates with the binding version as the lock and sends null once every picker is cleared', async () => {
    const { form } = renderDialog({ binding: existing() })
    expect(form.optimisticLockUpdatedAt).toBe('2026-10-06T10:00:00.000Z')
    expect(form.initialValues.categoryIds).toEqual([CATEGORY])
    await form.onSubmit({ ...form.initialValues, categoryIds: [], priceSortFallback: 'unavailable' })
    expect(updateCrudMock.mock.calls[0][1]).toEqual({
      id: 'binding-1',
      salesChannelId: 'channel-1',
      priceKindId: null,
      assortmentScope: null,
      priceSortFallback: 'unavailable',
      requireAuthentication: false,
    })
  })

  it('keeps the current default locked, since un-marking it would leave the store without one', () => {
    const { form } = renderDialog({ binding: existing({ isDefault: true }) })
    expect(field(form, 'isDefault')?.disabled).toBe(true)
    expect(field(form, 'isDefault')?.description).toMatch(/make another binding the default/)
  })

  it('opens read-only for a viewer, with every field disabled', () => {
    const { form } = renderDialog({ binding: existing(), readOnly: true })
    expect(form.readOnly).toBe(true)
    expect(form.fields.every((candidate) => candidate.disabled === true)).toBe(true)
  })

  it('asks to save first for a new binding instead of counting', () => {
    renderDialog({})
    expect(screen.getByTestId('group-liveCount').textContent).toMatch(/Save the binding to see how many products it shows/)
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})

describe('ChannelBindingLiveCount', () => {
  beforeEach(() => {
    apiCallMock.mockReset().mockResolvedValue({ ok: true, result: countResult() })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('debounces the count and sends the unsaved scope and switch', async () => {
    jest.useFakeTimers()
    const { rerender } = render(<ChannelBindingLiveCount bindingId="binding-1" values={{ categoryIds: [CATEGORY] }} />)
    rerender(<ChannelBindingLiveCount bindingId="binding-1" values={{ categoryIds: [CATEGORY], tagIds: [TAG] }} />)
    rerender(
      <ChannelBindingLiveCount
        bindingId="binding-1"
        values={{ categoryIds: [CATEGORY], tagIds: [TAG], requireAuthentication: false }}
      />,
    )
    expect(apiCallMock).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(399)
    })
    expect(apiCallMock).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(apiCallMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(apiCallMock.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/ecommerce/store-channel-bindings/binding-1/assortment-count')
    expect(JSON.parse(url.searchParams.get('draftScope') ?? '')).toEqual({ categoryIds: [CATEGORY], tagIds: [TAG] })
    expect(url.searchParams.get('draftRequireAuthentication')).toBe('false')
    await waitFor(() => expect(screen.getByTestId('channel-assortment-count').textContent).toMatch(/Products matching this scope: 12\./))
  })

  it('shows the full catalog count when every picker is empty', async () => {
    render(<ChannelBindingLiveCount bindingId="binding-1" values={{ categoryIds: [] }} />)
    await waitFor(() =>
      expect(screen.getByTestId('channel-assortment-count').textContent).toMatch(/All products in this channel's catalog: 12\./),
    )
    const url = new URL(String(apiCallMock.mock.calls[0][0]), 'http://localhost')
    expect(url.searchParams.get('draftScope')).toBe('null')
  })

  it('explains a zero caused by the sign-in requirement and how many products it hides', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: countResult({ count: 0, requireAuthentication: true, reducedByAuthentication: true, countWithoutAuthentication: 40 }),
    })
    render(<ChannelBindingLiveCount bindingId="binding-1" values={{ requireAuthentication: true }} />)
    await waitFor(() =>
      expect(screen.getByTestId('channel-assortment-count').textContent).toMatch(
        /0 products for anonymous visitors because sign-in is required; 40 without that requirement\./,
      ),
    )
    const url = new URL(String(apiCallMock.mock.calls[0][0]), 'http://localhost')
    expect(url.searchParams.get('draftRequireAuthentication')).toBe('true')
  })

  it('hints at products not indexed yet', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: countResult({ unindexedCount: 3 }) })
    render(<ChannelBindingLiveCount bindingId="binding-1" values={{ tagIds: [TAG] }} />)
    await waitFor(() => expect(screen.getByTestId('channel-assortment-count').textContent).toMatch(/3 active products are not indexed/))
  })

  it('reports an unavailable count without breaking the form', async () => {
    apiCallMock.mockResolvedValue({ ok: false, result: null })
    render(<ChannelBindingLiveCount bindingId="binding-1" values={{}} />)
    await waitFor(() => expect(screen.getByText('The product count is unavailable right now.')).toBeTruthy())
  })
})
