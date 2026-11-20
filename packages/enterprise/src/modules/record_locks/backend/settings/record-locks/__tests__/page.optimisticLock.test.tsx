/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../../../../lib/config'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(async (_headers: Record<string, string>, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/core/generated-shims/entities.ids.generated', () => ({
  E: { sales: { sales_order: 'sales:order' } },
}))

import RecordLockingSettingsPage from '../page'

const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const LOADED_AT = '2026-11-20T10:00:00.000Z'
const SAVED_AT = '2026-11-20T10:05:00.000Z'

function renderPage() {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <RecordLockingSettingsPage />
    </I18nProvider>,
  )
}

async function clickSave() {
  const button = await screen.findByRole('button', { name: 'Save settings' })
  fireEvent.click(button)
}

describe('record locking settings page optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(apiCall).mockResolvedValue({
      ok: true,
      status: 200,
      result: { settings: DEFAULT_RECORD_LOCK_SETTINGS, updatedAt: LOADED_AT },
    } as Awaited<ReturnType<typeof apiCall>>)
  })

  it('sends the loaded version and adopts the saved version for the next save', async () => {
    jest.mocked(apiCallOrThrow).mockResolvedValue({
      ok: true,
      status: 200,
      result: { settings: DEFAULT_RECORD_LOCK_SETTINGS, updatedAt: SAVED_AT },
    } as Awaited<ReturnType<typeof apiCallOrThrow>>)
    renderPage()

    await clickSave()
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Settings saved', 'success'))
    expect(withScopedApiRequestHeaders).toHaveBeenNthCalledWith(1, { [LOCK_HEADER]: LOADED_AT }, expect.any(Function))

    await clickSave()
    await waitFor(() => expect(withScopedApiRequestHeaders).toHaveBeenCalledTimes(2))
    expect(withScopedApiRequestHeaders).toHaveBeenNthCalledWith(2, { [LOCK_HEADER]: SAVED_AT }, expect.any(Function))
  })

  it('surfaces a stale-save conflict instead of reporting success', async () => {
    const conflict = Object.assign(new Error('record_modified'), {
      status: 409,
      body: {
        error: 'record_modified',
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: SAVED_AT,
        expectedUpdatedAt: LOADED_AT,
      },
    })
    jest.mocked(apiCallOrThrow).mockRejectedValue(conflict)
    jest.mocked(surfaceRecordConflict).mockReturnValue(true)
    renderPage()

    await clickSave()
    await waitFor(() => expect(surfaceRecordConflict).toHaveBeenCalledWith(conflict, expect.any(Function), expect.objectContaining({
      onRefresh: expect.any(Function),
    })))
    expect(flash).not.toHaveBeenCalled()
  })
})
