/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ListView } from '../ListView'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: false, status: 500, result: null, response: {} })),
  apiCallOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const apiCallOrThrowMock = apiCallOrThrow as unknown as jest.Mock
const surfaceRecordConflictMock = surfaceRecordConflict as unknown as jest.Mock
const flashMock = flash as unknown as jest.Mock

const ENTRY = {
  id: 'entry-1',
  date: '2026-06-19',
  durationMinutes: 60,
  projectId: 'project-1',
  projectName: 'Project One',
  projectCode: null,
  projectColor: null,
  notes: null,
  source: 'manual',
  startedAt: null,
  endedAt: null,
}

function startEditingAndSubmit(newValue: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add description' }))
  const input = screen.getByRole('textbox') as HTMLInputElement
  fireEvent.change(input, { target: { value: newValue } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('timesheet inline description save', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    surfaceRecordConflictMock.mockReturnValue(false)
  })

  it('does not treat a failed PUT as success: keeps the editor open, flashes an error, and never calls onEntryUpdated', async () => {
    apiCallOrThrowMock.mockRejectedValue(Object.assign(new Error('Server error'), { status: 500 }))
    const onEntryUpdated = jest.fn()

    render(<ListView entries={[ENTRY]} onEntryUpdated={onEntryUpdated} />)
    startEditingAndSubmit('Updated note')

    await waitFor(() => {
      expect(flashMock).toHaveBeenCalledWith(
        'Failed to save description. Please try again.',
        'error',
      )
    })
    expect(onEntryUpdated).not.toHaveBeenCalled()
    // Editor stays open so the user can retry — the input is still present.
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('treats a 2xx PUT as success: closes the editor and calls onEntryUpdated', async () => {
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true }, response: {} })
    const onEntryUpdated = jest.fn()

    render(<ListView entries={[ENTRY]} onEntryUpdated={onEntryUpdated} />)
    startEditingAndSubmit('Updated note')

    await waitFor(() => {
      expect(onEntryUpdated).toHaveBeenCalledTimes(1)
    })
    expect(flashMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('surfaces the conflict bar on a 409 conflict instead of a generic error and does not call onEntryUpdated', async () => {
    apiCallOrThrowMock.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }))
    surfaceRecordConflictMock.mockReturnValue(true)
    const onEntryUpdated = jest.fn()

    render(<ListView entries={[ENTRY]} onEntryUpdated={onEntryUpdated} />)
    startEditingAndSubmit('Updated note')

    await waitFor(() => {
      expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    })
    expect(flashMock).not.toHaveBeenCalled()
    expect(onEntryUpdated).not.toHaveBeenCalled()
  })
})
