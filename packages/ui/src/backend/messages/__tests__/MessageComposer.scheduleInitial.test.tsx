/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MessageComposer } from '../MessageComposer'
import { apiCall } from '../../utils/apiCall'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => unknown) => run()),
}))

jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../../confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('../../detail/AttachmentsSection', () => ({
  AttachmentsSection: () => null,
}))

jest.mock('../../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({
    widgets: [],
    isLoading: false,
  }),
}))

jest.mock('../../injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({
    widgets: [],
    isLoading: false,
  }),
  useInjectionSpotEvents: () => ({
    triggerEvent: jest.fn(async () => ({ ok: true })),
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))

const dialogProps: Array<{ initialValue?: Date | null }> = []

jest.mock('../ScheduleSendDialog', () => ({
  ScheduleSendDialog: (props: { initialValue?: Date | null }) => {
    dialogProps.push(props)
    return null
  },
}))

describe('MessageComposer schedule dialog', () => {
  it('seeds the picker with the stored scheduledAt in edit mode', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
    renderWithProviders(
      <MessageComposer
        variant="compose"
        inline
        messageId="message-1"
        scheduling={{ available: true, maxDays: 30 }}
        defaultValues={{ visibility: 'public', externalEmails: ['a@example.com'], scheduledAt: '2030-01-01T10:00:00.000Z' }}
      />,
    )
    await waitFor(() => {
      expect(dialogProps[dialogProps.length - 1]?.initialValue?.toISOString()).toBe('2030-01-01T10:00:00.000Z')
    })
  })
})
