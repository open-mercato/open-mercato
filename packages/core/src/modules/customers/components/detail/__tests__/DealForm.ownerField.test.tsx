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
