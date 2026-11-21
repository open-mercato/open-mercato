/**
 * @jest-environment jsdom
 *
 * Phase 3 (#5232): the Addresses tab renders the shared ui `AddressesSection`, so the recipient name
 * and phone only reach the user if the customers adapter reads and writes them AND the section opts
 * the shared editor into rendering them. The list adapter used to drop both columns.
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import type { AddressDataAdapter } from '@open-mercato/ui/backend/detail'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const apiCallOrThrowMock = jest.fn(async (..._args: unknown[]) => ({ ok: true, response: new Response(), result: {} }))
const readApiResultOrThrowMock = jest.fn(async (..._args: unknown[]): Promise<unknown> => ({ items: [] }))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: {} })),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

let capturedProps: Record<string, unknown> | null = null
jest.mock('@open-mercato/ui/backend/detail', () => ({
  AddressesSection: (props: Record<string, unknown>) => {
    capturedProps = props
    return null
  },
}))

import { AddressesSection } from '../AddressesSection'

function renderSection() {
  capturedProps = null
  render(
    React.createElement(AddressesSection, {
      entityId: 'entity-1',
      emptyLabel: 'empty',
      addActionLabel: 'add',
      emptyState: { title: 't', actionLabel: 'a' },
    }),
  )
  if (!capturedProps) throw new Error('[internal] shared section props not captured')
  return capturedProps as { dataAdapter: AddressDataAdapter; showRecipientNameField?: boolean; showPhoneField?: boolean }
}

beforeEach(() => {
  apiCallOrThrowMock.mockClear()
  readApiResultOrThrowMock.mockReset()
})

describe('customers AddressesSection — recipient name + phone', () => {
  it('opts the shared section into rendering both fields', () => {
    const props = renderSection()
    expect(props.showRecipientNameField).toBe(true)
    expect(props.showPhoneField).toBe(true)
  })

  it('list adapter maps recipient_name and phone from the API row', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        { id: 'a1', address_line1: '1 Main St', recipient_name: 'Alice', phone: '+48 600 100 200' },
        { id: 'a2', address_line1: '2 Main St', recipientName: 'Bob', phone: null },
        { id: 'a3', address_line1: '3 Main St' },
      ],
    })
    const { dataAdapter } = renderSection()

    const rows = await dataAdapter.list({ entityId: 'entity-1' })

    expect(rows[0]).toMatchObject({ recipientName: 'Alice', phone: '+48 600 100 200' })
    expect(rows[1]).toMatchObject({ recipientName: 'Bob', phone: null })
    expect(rows[2]).toMatchObject({ recipientName: null, phone: null })
  })

  it('create and update forward recipientName and phone in the request body', async () => {
    const { dataAdapter } = renderSection()
    const payload = { addressLine1: '1 Main St', recipientName: 'Alice', phone: '+48 600 100 200' }

    await dataAdapter.create({ entityId: 'entity-1', payload })
    await dataAdapter.update({ id: 'a1', payload })

    const bodies = apiCallOrThrowMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body))
    expect(bodies[0]).toMatchObject({ entityId: 'entity-1', recipientName: 'Alice', phone: '+48 600 100 200' })
    expect(bodies[1]).toMatchObject({ id: 'a1', recipientName: 'Alice', phone: '+48 600 100 200' })
  })
})
