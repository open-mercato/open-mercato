/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { SalesOptionField } from '../components/settings/SalesOptionField'

type Deferred = {
  promise: Promise<CrudFieldOption[]>
  resolve: (value: CrudFieldOption[]) => void
  reject: (reason: Error) => void
}

function deferred(): Deferred {
  let resolve: (value: CrudFieldOption[]) => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<CrudFieldOption[]>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

function renderField(loadOptions: () => Promise<CrudFieldOption[]>, value = '') {
  return renderWithProviders(
    <SalesOptionField
      id="channelId"
      value={value}
      setValue={jest.fn()}
      label="Sales channel"
      loadOptions={loadOptions}
      emptyMessage="No channels"
      emptyActionLabel="Create one"
      emptyHref="/backend/sales/channels"
    />,
  )
}

async function retryWhileFocused(loadOptions: jest.Mock) {
  const retry = await screen.findByTestId('pm-settings-channelId-retry')
  act(() => retry.focus())
  fireEvent.click(retry)
  await waitFor(() => expect(loadOptions).toHaveBeenCalledTimes(2))
  expect(screen.getByTestId('pm-settings-channelId-retry')).toBe(retry)
  expect(retry).toHaveAttribute('aria-disabled', 'true')
  expect(retry).toHaveAttribute('aria-busy', 'true')
  expect(retry).toHaveFocus()
  fireEvent.click(retry)
  expect(loadOptions).toHaveBeenCalledTimes(2)
  return retry
}

describe('SalesOptionField retry focus', () => {
  it('moves focus to the select trigger once a retried load succeeds', async () => {
    const reload = deferred()
    const loadOptions = jest.fn<Promise<CrudFieldOption[]>, []>()
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockReturnValueOnce(reload.promise)
    renderField(loadOptions)
    await retryWhileFocused(loadOptions)

    await act(async () => {
      reload.resolve([{ value: 'channel-1', label: 'Online' }])
      await reload.promise
    })

    expect(screen.queryByTestId('pm-settings-channelId-retry')).not.toBeInTheDocument()
    const trigger = document.getElementById('pm-settings-channelId')
    expect(trigger).not.toBeNull()
    expect(trigger).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('keeps focus on the retry button when the retried load fails again', async () => {
    const reload = deferred()
    const loadOptions = jest.fn<Promise<CrudFieldOption[]>, []>()
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockReturnValueOnce(reload.promise)
    renderField(loadOptions)
    const retry = await retryWhileFocused(loadOptions)

    await act(async () => {
      reload.reject(new Error('still forbidden'))
      await reload.promise.catch(() => undefined)
    })

    await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled'))
    expect(screen.getByTestId('pm-settings-channelId-retry')).toBe(retry)
    expect(retry).toHaveFocus()
  })
})

describe('SalesOptionField saved value label', () => {
  it('labels a saved value as unverified when the options could not be loaded', async () => {
    const loadOptions = jest.fn<Promise<CrudFieldOption[]>, []>().mockRejectedValueOnce(new Error('forbidden'))
    renderField(loadOptions, 'channel-saved')
    await screen.findByTestId('pm-settings-channelId-retry')
    const trigger = document.getElementById('pm-settings-channelId')
    expect(trigger).toHaveTextContent('Current value (options could not be loaded)')
    expect(trigger).not.toHaveTextContent('Saved option (not listed)')
  })

  it('labels a saved value as not listed when the options loaded without it', async () => {
    const loadOptions = jest.fn<Promise<CrudFieldOption[]>, []>().mockResolvedValueOnce([{ value: 'channel-1', label: 'Online' }])
    renderField(loadOptions, 'channel-saved')
    const trigger = document.getElementById('pm-settings-channelId')
    await waitFor(() => expect(trigger).toHaveTextContent('Saved option (not listed)'))
    expect(trigger).not.toHaveTextContent('Current value (options could not be loaded)')
    expect(screen.queryByTestId('pm-settings-channelId-retry')).not.toBeInTheDocument()
  })
})
