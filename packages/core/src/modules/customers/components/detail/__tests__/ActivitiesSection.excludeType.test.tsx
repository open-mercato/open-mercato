/**
 * @jest-environment jsdom
 *
 * Guards issue #4372: the profile activity timeline hides tasks by default,
 * but the hidden type must be configurable — `excludeInteractionType` prop
 * overrides it and `null` disables the exclusion entirely.
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { ActivitiesSection } from '../ActivitiesSection'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const requestedUrls: string[] = []
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: async (url: string) => {
    requestedUrls.push(url)
    return { items: [] }
  },
  apiCallOrThrow: async () => ({}),
}))

function renderSection(excludeInteractionType?: string | null) {
  return render(
    <ActivitiesSection
      entityId="entity-1"
      useCanonicalInteractions
      addActionLabel="Add"
      emptyState={{ title: 'No activities', actionLabel: 'Add' }}
      {...(excludeInteractionType !== undefined ? { excludeInteractionType } : {})}
    />,
  )
}

async function interactionsRequest(): Promise<URLSearchParams> {
  await waitFor(() => {
    expect(requestedUrls.some((url) => url.startsWith('/api/customers/interactions?'))).toBe(true)
  })
  const url = requestedUrls.find((entry) => entry.startsWith('/api/customers/interactions?')) as string
  return new URLSearchParams(url.split('?')[1])
}

describe('ActivitiesSection excludeInteractionType', () => {
  beforeEach(() => {
    requestedUrls.length = 0
  })

  it('hides tasks by default', async () => {
    renderSection()
    const params = await interactionsRequest()
    expect(params.get('excludeInteractionType')).toBe('task')
  })

  it('hides the configured type instead when overridden', async () => {
    renderSection('note')
    const params = await interactionsRequest()
    expect(params.get('excludeInteractionType')).toBe('note')
  })

  it('hides nothing when the prop is null', async () => {
    renderSection(null)
    const params = await interactionsRequest()
    expect(params.get('excludeInteractionType')).toBeNull()
  })
})
