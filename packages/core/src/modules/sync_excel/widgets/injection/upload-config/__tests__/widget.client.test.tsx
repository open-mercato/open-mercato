/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import SyncExcelUploadConfigWidget from '../widget.client'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

const mockReplace = jest.fn()
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const mockRefreshLogs = jest.fn(async () => undefined)
const mockRefreshHealthSnapshot = jest.fn(async () => undefined)
const mockTranslate = (key: string, fallback?: string, values?: Record<string, unknown>) => {
  if (!fallback) return key
  return Object.entries(values ?? {}).reduce(
    (current, [name, value]) => current.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
    fallback,
  )
}

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: () => ({ data: [] }),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>
const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>
let currentSearchParams = new URLSearchParams('tab=logs&uploadId=upload-restore-1&runId=run-restore-1')

const previewResponse = {
  uploadId: 'upload-restore-1',
  filename: 'Leads.csv',
  mimeType: 'text/csv',
  fileSize: 1024,
  entityType: 'customers.person' as const,
  headers: ['Record Id', 'Email', 'Lead Name', 'Status'],
  sampleRows: [
    {
      'Record Id': 'lead-1',
      Email: 'ada@example.com',
      'Lead Name': 'Ada Lovelace',
      Status: 'Qualified',
    },
  ],
  totalRows: 1,
  suggestedMapping: {
    entityType: 'customers.person' as const,
    matchStrategy: 'externalId' as const,
    matchField: 'person.externalId',
    fields: [
      { externalField: 'Record Id', localField: 'person.externalId', mappingKind: 'external_id' },
      { externalField: 'Email', localField: 'person.primaryEmail', mappingKind: 'core', dedupeRole: 'secondary' },
      { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
    ],
    unmappedColumns: ['Status'],
  },
}

const completedRun = {
  id: 'run-restore-1',
  status: 'completed' as const,
  createdCount: 1,
  updatedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  lastError: null,
  progressJobId: 'job-restore-1',
  progressJob: {
    id: 'job-restore-1',
    status: 'completed' as const,
    progressPercent: 100,
    processedCount: 1,
    totalCount: 1,
    etaSeconds: null,
  },
}

describe('SyncExcelUploadConfigWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseRouter.mockReturnValue({ replace: mockReplace } as any)
    mockUsePathname.mockReturnValue('/backend/integrations/sync_excel')
    currentSearchParams = new URLSearchParams('tab=logs&uploadId=upload-restore-1&runId=run-restore-1')
    mockUseSearchParams.mockImplementation(() => currentSearchParams as any)
    window.sessionStorage.clear()
    window.sessionStorage.setItem('om:sync_excel:session:sync_excel', JSON.stringify({
      uploadId: 'upload-restore-1',
      filename: 'Leads.csv',
      preview: previewResponse,
      mappingRows: [
        { sourceColumn: 'Record Id', targetField: 'person.externalId' },
        { sourceColumn: 'Email', targetField: 'person.primaryEmail' },
        { sourceColumn: 'Lead Name', targetField: 'person.displayName' },
        { sourceColumn: 'Status', targetField: 'person.status' },
      ],
      matchStrategy: 'email',
      runId: 'run-restore-1',
      progressJobId: 'job-restore-1',
    }))
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sync_excel/preview?')) {
        return { ok: true, result: previewResponse } as any
      }
      if (url === '/api/data_sync/runs/run-restore-1') {
        return { ok: true, result: completedRun } as any
      }
      return { ok: false, result: null } as any
    })
  })

  it('restores preview, mapping, and run state from URL and session storage without dropping into the empty upload state', async () => {
    render(
      <SyncExcelUploadConfigWidget
        context={{
          integrationId: 'sync_excel',
          state: { isEnabled: true },
          refreshLogs: mockRefreshLogs,
          refreshHealthSnapshot: mockRefreshHealthSnapshot,
        }}
        data={{ state: { isEnabled: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Preview and mapping')).toBeTruthy())
    expect(screen.getByText('Import run status')).toBeTruthy()
    expect(screen.queryByText('Restoring the last CSV session...')).toBeNull()

    const statusRow = screen.getAllByText('Status').find((element) => element.tagName === 'TD')?.closest('tr')
    expect(statusRow).toBeTruthy()
    expect(within(statusRow as HTMLElement).getByRole('combobox')).toHaveValue('person.status')

    const matchStrategySelect = screen.getByLabelText('How to match existing people')
    expect(matchStrategySelect).toHaveValue('email')
    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/sync_excel/preview?uploadId=upload-restore-1&entityType=customers.person',
      undefined,
      { fallback: null },
    )
    expect(mockApiCall).toHaveBeenCalledWith('/api/data_sync/runs/run-restore-1', undefined, { fallback: null })
    expect(
      mockApiCall.mock.calls.filter(([url]) => url === '/api/sync_excel/preview?uploadId=upload-restore-1&entityType=customers.person'),
    ).toHaveLength(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('refreshes run status together with logs and health snapshot', async () => {
    render(
      <SyncExcelUploadConfigWidget
        context={{
          integrationId: 'sync_excel',
          state: { isEnabled: true },
          refreshLogs: mockRefreshLogs,
          refreshHealthSnapshot: mockRefreshHealthSnapshot,
        }}
        data={{ state: { isEnabled: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Import run status')).toBeTruthy())
    mockRefreshLogs.mockClear()
    mockRefreshHealthSnapshot.mockClear()
    mockApiCall.mockClear()
    mockApiCall.mockResolvedValue({ ok: true, result: completedRun } as any)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh run status' }))

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('/api/data_sync/runs/run-restore-1', undefined, { fallback: null }))
    expect(mockRefreshLogs).toHaveBeenCalledTimes(1)
    expect(mockRefreshHealthSnapshot).toHaveBeenCalledTimes(1)
  })

  it('shows duplicate-risk notices but still allows starting a risky re-import', async () => {
    window.sessionStorage.setItem('om:sync_excel:session:sync_excel', JSON.stringify({
      uploadId: 'upload-restore-1',
      filename: 'Leads.csv',
      preview: previewResponse,
      mappingRows: [
        { sourceColumn: 'Record Id', targetField: 'person.externalId' },
        { sourceColumn: 'Email', targetField: 'person.primaryEmail' },
        { sourceColumn: 'Lead Name', targetField: 'person.displayName' },
      ],
      matchStrategy: 'custom',
      runId: 'run-restore-1',
      progressJobId: 'job-restore-1',
    }))

    render(
      <SyncExcelUploadConfigWidget
        context={{ integrationId: 'sync_excel', state: { isEnabled: true } }}
        data={{ state: { isEnabled: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Preview and mapping')).toBeTruthy())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start import' })).not.toBeDisabled())

    expect(screen.getByText('This upload already has a run')).toBeTruthy()
    expect(screen.getByText('Duplicate risk')).toBeTruthy()
    expect(flash).not.toHaveBeenCalled()
  })

  it('does not refetch preview when the same upload stays mounted and only the runId query param changes', async () => {
    currentSearchParams = new URLSearchParams('tab=logs&uploadId=upload-restore-1')
    window.sessionStorage.setItem('om:sync_excel:session:sync_excel', JSON.stringify({
      uploadId: 'upload-restore-1',
      filename: 'Leads.csv',
      preview: previewResponse,
      mappingRows: [
        { sourceColumn: 'Record Id', targetField: 'person.externalId' },
        { sourceColumn: 'Email', targetField: 'person.primaryEmail' },
        { sourceColumn: 'Lead Name', targetField: 'person.displayName' },
      ],
      matchStrategy: 'externalId',
      runId: 'run-restore-1',
      progressJobId: 'job-restore-1',
    }))

    const { rerender } = render(
      <SyncExcelUploadConfigWidget
        context={{
          integrationId: 'sync_excel',
          state: { isEnabled: true },
          refreshLogs: mockRefreshLogs,
          refreshHealthSnapshot: mockRefreshHealthSnapshot,
        }}
        data={{ state: { isEnabled: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Preview and mapping')).toBeTruthy())
    expect(
      mockApiCall.mock.calls.filter(([url]) => url === '/api/sync_excel/preview?uploadId=upload-restore-1&entityType=customers.person'),
    ).toHaveLength(1)

    currentSearchParams = new URLSearchParams('tab=logs&uploadId=upload-restore-1&runId=run-restore-1')
    rerender(
      <SyncExcelUploadConfigWidget
        context={{
          integrationId: 'sync_excel',
          state: { isEnabled: true },
          refreshLogs: mockRefreshLogs,
          refreshHealthSnapshot: mockRefreshHealthSnapshot,
        }}
        data={{ state: { isEnabled: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Import run status')).toBeTruthy())
    expect(
      mockApiCall.mock.calls.filter(([url]) => url === '/api/sync_excel/preview?uploadId=upload-restore-1&entityType=customers.person'),
    ).toHaveLength(1)
  })

  it('restores persisted preview metadata immediately while the API revalidation is still pending', async () => {
    currentSearchParams = new URLSearchParams('tab=logs&uploadId=upload-restore-1')
    let resolvePreview: ((value: any) => void) | null = null
    mockApiCall.mockImplementation((async (url: string) => {
      if (url.startsWith('/api/sync_excel/preview?')) {
        return await new Promise((resolve) => {
          resolvePreview = resolve
        })
      }
      if (url === '/api/data_sync/runs/run-restore-1') {
        return { ok: true, result: completedRun } as any
      }
      return { ok: false, result: null } as any
    }) as any)

    render(
      <SyncExcelUploadConfigWidget
        context={{
          integrationId: 'sync_excel',
          state: { isEnabled: true },
          refreshLogs: mockRefreshLogs,
          refreshHealthSnapshot: mockRefreshHealthSnapshot,
        }}
        data={{ state: { isEnabled: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Preview and mapping')).toBeTruthy())
    expect(screen.getByText('Leads.csv')).toBeTruthy()
    expect(resolvePreview).toBeTruthy()

    resolvePreview?.({ ok: true, result: previewResponse })

    await waitFor(() => expect(screen.getByText('Ready to import')).toBeTruthy())
  })

  it('restores the persisted session even when uploadId disappeared from the URL after tab navigation', async () => {
    currentSearchParams = new URLSearchParams('tab=sync_excel.injection.upload-config')

    render(
      <SyncExcelUploadConfigWidget
        context={{
          integrationId: 'sync_excel',
          state: { isEnabled: true },
          refreshLogs: mockRefreshLogs,
          refreshHealthSnapshot: mockRefreshHealthSnapshot,
        }}
        data={{ state: { isEnabled: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Preview and mapping')).toBeTruthy())
    expect(screen.getByText('Import run status')).toBeTruthy()
    expect(mockReplace).toHaveBeenCalledWith(
      '/backend/integrations/sync_excel?tab=sync_excel.injection.upload-config&uploadId=upload-restore-1&runId=run-restore-1',
    )
    expect(screen.getByLabelText('How to match existing people')).toHaveValue('email')
  })
})
