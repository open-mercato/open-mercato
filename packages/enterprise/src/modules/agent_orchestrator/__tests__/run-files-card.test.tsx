/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ForbiddenError } from '@open-mercato/ui/backend/utils/api'
import en from '../i18n/en.json'
import { RunFilesCard } from '../components/trace/RunFilesCard'
import { OffloadStatusNote, readOffloadFailureStatus } from '../components/trace/OffloadStatusNote'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const dict = en as Record<string, string>
const RUN_ID = '22222222-2222-4222-8222-222222222222'

function respond(result: unknown) {
  mockedApiCall.mockResolvedValueOnce({ ok: true, status: 200, result } as Awaited<ReturnType<typeof apiCall>>)
}

beforeEach(() => {
  mockedApiCall.mockReset()
})

describe('RunFilesCard', () => {
  it('explains why files were not stored even when no file was captured', async () => {
    respond({ items: [], captureFailure: { count: 2, reason: 'encryption_unavailable' } })

    renderWithProviders(<RunFilesCard runId={RUN_ID} />, { dict })

    const notice = await screen.findByTestId('run-files-capture-failure')
    expect(notice.textContent).toContain(
      '2 file(s) produced by the agent were not stored: tenant data encryption was unavailable.',
    )
    expect(mockedApiCall).toHaveBeenCalledWith(
      `/api/agent_orchestrator/runs/${RUN_ID}/artifacts`,
      undefined,
      expect.anything(),
    )
  })

  it('shows the storage reason next to the files that were stored', async () => {
    respond({
      items: [
        {
          id: 'a1',
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          fileSize: 2048,
          caption: null,
          promotedAttachmentId: null,
          createdAt: '2026-11-18T10:00:00.000Z',
        },
      ],
      captureFailure: { count: 1, reason: 'storage_unavailable' },
    })

    renderWithProviders(<RunFilesCard runId={RUN_ID} />, { dict })

    expect(await screen.findByText('report.pdf')).toBeTruthy()
    expect(screen.getByTestId('run-files-capture-failure').textContent).toContain(
      '1 file(s) produced by the agent were not stored: file storage was unavailable.',
    )
  })

  it('renders nothing when the run produced no files and none failed', async () => {
    respond({ items: [], captureFailure: null })

    const { container } = renderWithProviders(<RunFilesCard runId={RUN_ID} />, { dict })

    await waitFor(() => expect(mockedApiCall).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})

describe('OffloadStatusNote', () => {
  it('hides the card instead of loading forever when the request is refused', async () => {
    mockedApiCall.mockResolvedValueOnce({ ok: false, status: 500, result: { items: [], captureFailure: null } } as Awaited<ReturnType<typeof apiCall>>)

    const { container } = renderWithProviders(<RunFilesCard runId={RUN_ID} />, { dict })

    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('hides the card when apiFetch throws ForbiddenError', async () => {
    mockedApiCall.mockRejectedValueOnce(new ForbiddenError('Forbidden'))

    const { container } = renderWithProviders(<RunFilesCard runId={RUN_ID} />, { dict })

    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByText(dict['agent_orchestrator.artifacts.loading'])).toBeNull()
  })

  it('explains a truncated summary whose full payload was not stored', () => {
    renderWithProviders(
      <OffloadStatusNote summary={{ _truncated: true, offloaded: false, offloadStatus: 'encryption_unavailable', preview: '{' }} />,
      { dict },
    )

    expect(screen.getByTestId('trace-offload-status').textContent).toContain(
      dict['agent_orchestrator.trace.contentStatus.encryption_unavailable'],
    )
  })

  it('stays silent for stored, inline and legacy summaries', () => {
    expect(readOffloadFailureStatus({ _truncated: true, offloaded: true, preview: '' })).toBeNull()
    expect(readOffloadFailureStatus({ _truncated: true, offloaded: false, preview: '' })).toBeNull()
    expect(readOffloadFailureStatus({ ok: true })).toBeNull()
    expect(readOffloadFailureStatus('text')).toBeNull()
    expect(readOffloadFailureStatus({ _truncated: true, offloaded: false, offloadStatus: 'bogus' })).toBeNull()
  })
})
