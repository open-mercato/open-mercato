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

type StatusFieldComponent = (props: {
  value: string | undefined
  setValue: (next: string | undefined) => void
}) => React.ReactElement

type CapturedProps = {
  fields?: Array<{ id: string; component?: StatusFieldComponent }>
}

const captured: { props: CapturedProps | null } = { props: null }

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedProps) => {
    captured.props = props
    return null
  },
}))

import { DealForm, resetDealPipelineMetadataCacheForTests } from '../DealForm'

function getStatusFieldOrganizationId(): string | null | undefined {
  const statusField = captured.props?.fields?.find((field) => field.id === 'status')
  const element = statusField?.component?.({ value: undefined, setValue: () => {} })
  return (element?.props as { organizationId?: string | null } | undefined)?.organizationId
}

describe('DealForm dictionary organization scoping', () => {
  beforeEach(() => {
    resetDealPipelineMetadataCacheForTests()
    captured.props = null
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({ id: 'currency', entries: [] })
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  it("scopes the status dictionary to the deal's own organization in edit mode", async () => {
    renderWithProviders(
      <DealForm
        mode="edit"
        initialValues={{ title: 'Expansion renewal', organizationId: 'org-deal-1' }}
        onSubmit={async () => {}}
        onCancel={() => {}}
      />,
    )

    await waitFor(() => expect(captured.props).not.toBeNull())
    expect(getStatusFieldOrganizationId()).toBe('org-deal-1')
  })

  it('leaves the status dictionary unscoped when no organization is known (create mode)', async () => {
    renderWithProviders(
      <DealForm
        mode="create"
        initialValues={{ title: 'New deal' }}
        onSubmit={async () => {}}
        onCancel={() => {}}
      />,
    )

    await waitFor(() => expect(captured.props).not.toBeNull())
    expect(getStatusFieldOrganizationId()).toBeNull()
  })
})
