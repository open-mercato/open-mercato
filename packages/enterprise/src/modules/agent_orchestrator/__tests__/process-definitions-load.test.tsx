/** @jest-environment jsdom */

import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { APP_EVENT_DOM_NAME } from '@open-mercato/ui/backend/injection/useAppEvent'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import ProcessDefinitionsPage from '../backend/processes/definitions/page'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: jest.fn() }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: () => null }))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../backend/processes/definitions/TriggerEditor', () => ({ TriggerEditor: () => null }))
jest.mock('../backend/processes/definitions/MilestoneEditor', () => ({ MilestoneEditor: () => null }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data }: { data: Array<{ id: string; name: string }> }) => (
    <div role="table">{data.map((row) => <div key={row.id} role="row">{row.name}</div>)}</div>
  ),
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div role="status">{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div role="alert">{label}</div>,
}))

type ListCall = { ok: boolean; status: number; result: { items: Array<Record<string, unknown>> } }
const stored = { id: 'definition-1', name: 'Retained definition', workflow_id: 'workflow-1', enabled: false }
const success: ListCall = { ok: true, status: 200, result: { items: [stored] } }
const list = jest.fn<Promise<ListCall>, []>()
const reportError = jest.fn()

function pendingList() {
  let resolve!: (value: ListCall) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<ListCall>((complete, fail) => { resolve = complete; reject = fail })
  return { promise, resolve, reject }
}

async function refresh() {
  await act(async () => {
    jest.advanceTimersByTime(5000)
    window.dispatchEvent(new CustomEvent(APP_EVENT_DOM_NAME, {
      detail: { id: 'agent_orchestrator.process.execution.completed', payload: {} },
    }))
  })
}

describe.each([['en', en], ['pl', pl]] as const)('ProcessDefinitionsPage load (%s)', (locale, dict) => {
  beforeEach(() => {
    jest.useFakeTimers()
    list.mockReset().mockResolvedValue(success)
    reportError.mockReset()
    ;(getTelemetryRuntime as jest.Mock).mockReturnValue({ reportError })
    ;(apiCall as jest.Mock).mockImplementation((url: string) => (
      url.startsWith('/api/agent_orchestrator/processes?') ? list() : Promise.resolve({ ok: true, result: { items: [] } })
    ))
  })

  afterEach(() => { jest.useRealTimers() })

  it('contains transport rejection, retains rows through HTTP503, and recovers on200', async () => {
    const unhandled = jest.fn()
    window.addEventListener('unhandledrejection', unhandled)
    const view = renderWithProviders(<ProcessDefinitionsPage />, { locale, dict })
    try {
      await act(async () => {})
      expect(screen.getByRole('row').textContent).toBe(stored.name)
      const cause = new TypeError('Failed to fetch')
      list.mockRejectedValueOnce(cause)
      await refresh()
      expect(screen.getByRole('alert').textContent).toBe(dict['agent_orchestrator.processDefinitions.list.error'])
      expect(screen.queryByRole('status')).toBeNull()
      expect(reportError).toHaveBeenCalledWith(cause, {
        module: 'agent_orchestrator', code: 'agent_orchestrator.process_definitions_load_failed',
      })

      const unavailable = pendingList()
      list.mockReturnValueOnce(unavailable.promise)
      await refresh()
      expect(screen.getByRole('row').textContent).toBe(stored.name)
      expect(screen.queryByRole('status')).toBeNull()
      await act(async () => { unavailable.resolve({ ok: false, status: 503, result: { items: [] } }) })
      expect(screen.getByRole('alert').textContent).toBe(dict['agent_orchestrator.processDefinitions.list.error'])
      expect(reportError).toHaveBeenCalledTimes(1)

      const recovery = pendingList()
      list.mockReturnValueOnce(recovery.promise)
      await refresh()
      expect(screen.getByRole('row').textContent).toBe(stored.name)
      await act(async () => { recovery.resolve(success) })
      expect(screen.getByRole('row').textContent).toBe(stored.name)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()
      expect(unhandled).not.toHaveBeenCalled()
      expect(list).toHaveBeenCalledTimes(4)
    } finally {
      view.unmount()
      window.removeEventListener('unhandledrejection', unhandled)
    }
  })

  it.each(['transport rejection', 'HTTP503'])('restores foreground loading after %s and allows a later refresh', async (failure) => {
    const initial = pendingList()
    list.mockReturnValueOnce(initial.promise)
    renderWithProviders(<ProcessDefinitionsPage />, { locale, dict })
    expect(screen.getByRole('status')).toBeTruthy()
    await act(async () => {
      if (failure === 'transport rejection') initial.reject(new TypeError('Failed to fetch'))
      else initial.resolve({ ok: false, status: 503, result: { items: [] } })
    })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(dict['agent_orchestrator.processDefinitions.list.error'])
    await refresh()
    expect(screen.getByRole('row').textContent).toBe(stored.name)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
