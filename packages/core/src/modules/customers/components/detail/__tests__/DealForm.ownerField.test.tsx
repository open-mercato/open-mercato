/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

let mockCurrentUserId = ''
jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({
  useCurrentUserId: () => mockCurrentUserId,
}))

const ownerSelectRenders: Array<{ value: string | null }> = []
jest.mock('../DealOwnerSelect', () => ({
  DealOwnerSelect: (props: { value: string | null }) => {
    ownerSelectRenders.push({ value: props.value })
    return null
  },
}))

type CapturedProps = {
  fields?: Array<{ id: string; layout?: string }>
  groups?: Array<{ id: string; fields?: string[] }>
  initialValues?: Record<string, unknown>
}

const captured: { props: CapturedProps | null } = { props: null }

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedProps) => {
    captured.props = props
    return null
  },
}))

import { DealForm, resetDealPipelineMetadataCacheForTests } from '../DealForm'

function renderDealForm(mode: 'create' | 'edit', extra: Record<string, unknown> = {}) {
  const { initialValues, ...rest } = extra
  return renderWithProviders(
    <DealForm
      mode={mode}
      initialValues={{ title: 'Expansion renewal', ...((initialValues as object) ?? {}) }}
      onSubmit={async () => {}}
      {...rest}
    />,
  )
}

describe('DealForm owner field', () => {
  beforeEach(() => {
    resetDealPipelineMetadataCacheForTests()
    captured.props = null
    ownerSelectRenders.length = 0
    mockCurrentUserId = ''
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({ id: 'currency', entries: [] })
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  // The form is shared: the deal detail page renders it in edit mode and the
  // person/company "create deal" flow renders it in create mode. Owner must be
  // offered in both — the field is deliberately not gated on `mode`.
  it.each(['edit', 'create'] as const)('offers the owner field in %s mode', async (mode) => {
    renderDealForm(mode)

    await waitFor(() => expect(captured.props).not.toBeNull())
    const ids = (captured.props?.fields ?? []).map((field) => field.id)
    expect(ids).toContain('ownerUserId')
  })

  it('places owner in the deal-details group next to the other half-width attributes', async () => {
    renderDealForm('edit')

    await waitFor(() => expect(captured.props).not.toBeNull())
    const detailsGroup = (captured.props?.groups ?? []).find((group) => group.id === 'details')
    expect(detailsGroup?.fields).toContain('ownerUserId')

    const ownerField = (captured.props?.fields ?? []).find((field) => field.id === 'ownerUserId')
    expect(ownerField?.layout).toBe('half')
  })

  it('seeds the stored owner from initialValues so an untouched save re-sends it', async () => {
    renderDealForm('edit', { initialValues: { ownerUserId: 'user-7' } })

    await waitFor(() => expect(captured.props).not.toBeNull())
    expect(captured.props?.initialValues?.ownerUserId).toBe('user-7')
  })
})

// D10: a create form self-assigns to the current user so the default creation path stops
// producing unowned deals. Edit mode must never self-assign — it shows the stored owner.
describe('DealForm create-mode owner default', () => {
  function renderOwnerControl(mode: 'create' | 'edit', initial?: Record<string, unknown>) {
    renderDealForm(mode, initial ? { initialValues: initial } : {})
  }

  it('self-assigns the current user on a create form', async () => {
    mockCurrentUserId = 'user-42'
    renderOwnerControl('create')

    await waitFor(() => expect(captured.props).not.toBeNull())
    const ownerField = (captured.props?.fields ?? []).find((field) => field.id === 'ownerUserId')
    expect(ownerField).toBeDefined()

    const setValue = jest.fn()
    const element = (ownerField as unknown as { component: (args: unknown) => React.ReactElement }).component({
      value: '',
      setValue,
    })
    renderWithProviders(element)

    await waitFor(() => expect(setValue).toHaveBeenCalledWith('user-42'))
  })

  it('does not self-assign on an edit form', async () => {
    mockCurrentUserId = 'user-42'
    renderOwnerControl('edit')

    await waitFor(() => expect(captured.props).not.toBeNull())
    const ownerField = (captured.props?.fields ?? []).find((field) => field.id === 'ownerUserId')
    const setValue = jest.fn()
    const element = (ownerField as unknown as { component: (args: unknown) => React.ReactElement }).component({
      value: '',
      setValue,
    })
    renderWithProviders(element)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(setValue).not.toHaveBeenCalled()
  })

  it('does not overwrite an owner already present on a create form', async () => {
    mockCurrentUserId = 'user-42'
    renderOwnerControl('create')

    await waitFor(() => expect(captured.props).not.toBeNull())
    const ownerField = (captured.props?.fields ?? []).find((field) => field.id === 'ownerUserId')
    const setValue = jest.fn()
    const element = (ownerField as unknown as { component: (args: unknown) => React.ReactElement }).component({
      value: 'user-chosen',
      setValue,
    })
    renderWithProviders(element)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(setValue).not.toHaveBeenCalled()
  })
})

// The submit payload is an explicit allow-list, exactly like embeddedInitialValues. A field
// missing from it is silently dropped before the API call — the owner selection appeared to
// work in the UI while never persisting. These lock both directions of that contract.
describe('DealForm owner submit payload', () => {
  async function submitWith(values: Record<string, unknown>) {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    renderDealForm('edit', { onSubmit })
    await waitFor(() => expect(captured.props).not.toBeNull())

    const handler = (captured.props as unknown as { onSubmit: (v: Record<string, unknown>) => Promise<void> }).onSubmit
    await handler({ title: 'Expansion renewal', personIds: [], companyIds: [], ...values })
    return onSubmit
  }

  it('sends the selected owner in the base payload', async () => {
    const onSubmit = await submitWith({ ownerUserId: 'user-7' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].base).toMatchObject({ ownerUserId: 'user-7' })
  })

  // Spec D5: an empty picker means "unassign", so it must send an explicit null. Omitting the
  // key would leave the stored owner in place, which is exactly what clearing must not do.
  it('sends null when the picker is empty, so clearing actually unassigns', async () => {
    const onSubmit = await submitWith({ ownerUserId: '' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].base.ownerUserId).toBeNull()
  })
})
