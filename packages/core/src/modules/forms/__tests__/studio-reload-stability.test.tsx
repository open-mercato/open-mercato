/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../i18n/en.json'

const apiCallMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCallMock(...args),
  }
})

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => false,
  }),
}))

import { FormStudio } from '../backend/forms/[id]/FormStudio'

const FORM_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '22222222-2222-4222-8222-222222222222'

const formDetail = {
  id: FORM_ID,
  key: 'stability_form',
  name: 'Stability form',
  description: null,
  status: 'draft',
  defaultLocale: 'en',
  supportedLocales: ['en'],
  updatedAt: '2026-11-10T00:00:00.000Z',
  versions: [{ id: VERSION_ID, versionNumber: 1, status: 'draft' }],
}

const versionDetail = {
  id: VERSION_ID,
  versionNumber: 1,
  status: 'draft',
  updatedAt: '2026-11-10T00:00:00.000Z',
  roles: ['admin'],
  schema: {
    type: 'object',
    'x-om-roles': ['admin'],
    'x-om-default-actor-role': 'admin',
    'x-om-sections': [{ key: 'main', title: { en: 'Main' }, fieldKeys: ['details'] }],
    properties: {
      details: {
        type: 'string',
        'x-om-type': 'text',
        'x-om-label': { en: 'Conditional details' },
        'x-om-visible-to': ['admin'],
        'x-om-editable-by': ['admin'],
      },
    },
  },
}

function formDetailCalls(): number {
  return apiCallMock.mock.calls.filter(([url]) => url === `/api/forms/${FORM_ID}`).length
}

describe('FormStudio reload stability', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === `/api/forms/${FORM_ID}`) return { ok: true, status: 200, result: formDetail }
      if (url === `/api/forms/${FORM_ID}/versions/${VERSION_ID}`) return { ok: true, status: 200, result: versionDetail }
      return { ok: true, status: 200, result: {} }
    })
  })

  it('does not refetch and remount the studio when the guarded-mutation callback identity changes', async () => {
    function Harness() {
      const [tick, setTick] = React.useState(0)
      return (
        <>
          <button type="button" onClick={() => setTick((current) => current + 1)}>rerender {tick}</button>
          <FormStudio formId={FORM_ID} />
        </>
      )
    }
    renderWithProviders(<Harness />, { dict: enDict })

    await waitFor(() => expect(screen.getAllByText('Conditional details').length).toBeGreaterThan(0))
    expect(formDetailCalls()).toBe(1)

    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        screen.getByRole('button', { name: /^rerender/ }).click()
      })
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(formDetailCalls()).toBe(1)
  })
})
