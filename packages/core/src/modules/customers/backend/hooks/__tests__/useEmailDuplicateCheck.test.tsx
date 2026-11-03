/**
 * @jest-environment jsdom
 */
const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { useEmailDuplicateCheck } from '../useEmailDuplicateCheck'

type ProbeProps = {
  email: string
  recordId?: string | null
  matchMode?: 'exact' | 'prefix'
}

function Probe({ email, recordId, matchMode = 'prefix' }: ProbeProps) {
  const { duplicate } = useEmailDuplicateCheck(email, { recordId, matchMode, debounceMs: 0 })
  return <div data-testid="duplicate">{duplicate ? duplicate.displayName : ''}</div>
}

const respondWith = (items: Array<Record<string, unknown>>) => {
  apiCallMock.mockResolvedValue({ ok: true, result: { items } })
}

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

const requestedUrl = (): string => String(apiCallMock.mock.calls.at(-1)?.[0] ?? '')

const duplicateText = () => screen.getByTestId('duplicate').textContent

describe('useEmailDuplicateCheck', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('excludes the edited record from the lookup query', async () => {
    respondWith([])
    render(<Probe email="mia.johnson@example.com" recordId="person-1" />)
    await settle()

    expect(requestedUrl()).toContain('excludeIds=person-1')
    expect(requestedUrl()).toContain('emailStartsWith=mia.johnson%40example.com')
  })

  it('never reports the edited record as a duplicate of itself', async () => {
    respondWith([
      { id: 'person-1', display_name: 'Mia Johnson', primary_email: 'mia.johnson@example.com' },
    ])
    render(<Probe email="mia.johnson@example.com" recordId="person-1" />)
    await settle()

    expect(duplicateText()).toBe('')
  })

  it('still reports a duplicate owned by another record', async () => {
    respondWith([
      { id: 'person-1', display_name: 'Mia Johnson', primary_email: 'mia.johnson@example.com' },
      { id: 'person-2', display_name: 'Noah Berg', primary_email: 'mia.johnson@example.com' },
    ])
    render(<Probe email="mia.johnson@example.com" recordId="person-1" />)
    await settle()

    expect(duplicateText()).toBe('Noah Berg')
  })

  it('omits the exclusion when creating a record', async () => {
    respondWith([])
    render(<Probe email="mia.johnson@example.com" recordId={null} />)
    await settle()

    expect(requestedUrl()).not.toContain('excludeIds')
  })

  it('excludes the edited record in exact match mode too', async () => {
    respondWith([
      { id: 'person-1', display_name: 'Mia Johnson', primary_email: 'mia.johnson@example.com' },
    ])
    render(<Probe email="mia.johnson@example.com" recordId="person-1" matchMode="exact" />)
    await settle()

    expect(requestedUrl()).toContain('email=mia.johnson%40example.com')
    expect(requestedUrl()).toContain('excludeIds=person-1')
    expect(duplicateText()).toBe('')
  })
})
