/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ScheduleActivityDialog } from '../ScheduleActivityDialog'

const readApiResultOrThrowMock = jest.fn()
const setConflictMock = jest.fn()
const apiCallOrThrowMock = apiCallOrThrow as jest.Mock
const flashMock = flash as jest.Mock

function createScheduleState(overrides: Record<string, unknown> = {}) {
  return {
    activityType: 'meeting' as const,
    setActivityType: jest.fn(),
    title: 'Quarterly review',
    setTitle: jest.fn(),
    date: '2026-08-03',
    setDate: jest.fn(),
    startTime: '13:45',
    setStartTime: jest.fn(),
    duration: 45,
    setDuration: jest.fn(),
    allDay: false,
    setAllDay: jest.fn(),
    description: '',
    setDescription: jest.fn(),
    markdownEnabled: true,
    setMarkdownEnabled: jest.fn(),
    location: '',
    setLocation: jest.fn(),
    reminderMinutes: 15,
    setReminderMinutes: jest.fn(),
    visibility: 'team',
    setVisibility: jest.fn(),
    participants: [],
    setParticipants: jest.fn(),
    linkedEntities: [],
    setLinkedEntities: jest.fn(),
    recurrenceEnabled: false,
    setRecurrenceEnabled: jest.fn(),
    recurrenceDays: [true, false, false, false, false, false, false],
    setRecurrenceDays: jest.fn(),
    recurrenceEndType: 'never' as const,
    setRecurrenceEndType: jest.fn(),
    recurrenceCount: 8,
    setRecurrenceCount: jest.fn(),
    recurrenceEndDate: '',
    setRecurrenceEndDate: jest.fn(),
    conflict: null,
    setConflict: setConflictMock,
    saving: false,
    setSaving: jest.fn(),
    guestPermissions: { canInviteOthers: true, canModify: false, canSeeList: true },
    setGuestPermissions: jest.fn(),
    removeParticipant: jest.fn(),
    toggleRecurrenceDay: jest.fn(),
    ...overrides,
  }
}

let mockScheduleState = createScheduleState()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/icon-button', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  PhoneNumberField: ({
    id,
    value,
    onValueChange,
    externalError,
  }: {
    id?: string
    value?: string | null
    onValueChange: (next: string | undefined) => void
    externalError?: string | null
  }) => (
    <div>
      <input
        id={id}
        aria-label="Phone number"
        value={value ?? ''}
        onChange={(event) => onValueChange(event.target.value || undefined)}
      />
      {externalError ? <p>{externalError}</p> : null}
    </div>
  ),
  SwitchableMarkdownInput: () => null,
}))

jest.mock('../schedule', () => ({
  useScheduleFormState: () => mockScheduleState,
  FIELD_VISIBILITY: {
    meeting: new Set(['duration']),
    call: new Set(['duration']),
    task: new Set(['duration']),
    email: new Set(['duration']),
  },
  getFieldLabel: (_activityType: string, _fieldId: string, _t: unknown, _labelKey: string, fallback: string) => fallback,
  DateTimeFields: () => null,
  ParticipantsField: () => null,
  LocationField: () => null,
  FooterFields: () => null,
  LinkedEntitiesField: () => null,
}))

async function flushConflictCheck() {
  await act(async () => {
    jest.advanceTimersByTime(500)
  })
  await waitFor(() => {
    expect(readApiResultOrThrowMock).toHaveBeenCalled()
  })
}

describe('ScheduleActivityDialog', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    readApiResultOrThrowMock.mockReset()
    apiCallOrThrowMock.mockReset()
    flashMock.mockReset()
    setConflictMock.mockReset()
    mockScheduleState = createScheduleState()
    readApiResultOrThrowMock.mockResolvedValue({ hasConflicts: false, conflicts: [] })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('passes excludeId when checking conflicts for an edited activity', async () => {
    renderWithProviders(
      <ScheduleActivityDialog
        open
        onClose={() => undefined}
        entityId="person-1"
        entityType="person"
        editData={{ id: '11111111-1111-4111-8111-111111111111' }}
      />,
    )

    await flushConflictCheck()

    const requestUrl = new URL(String(readApiResultOrThrowMock.mock.calls.at(-1)?.[0] ?? ''), 'http://localhost')
    expect(requestUrl.searchParams.get('excludeId')).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('passes the selected local timezone offset when checking conflicts', async () => {
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120)

    renderWithProviders(
      <ScheduleActivityDialog
        open
        onClose={() => undefined}
        entityId="person-1"
        entityType="person"
      />,
    )

    await flushConflictCheck()

    const requestUrl = new URL(String(readApiResultOrThrowMock.mock.calls.at(-1)?.[0] ?? ''), 'http://localhost')
    expect(requestUrl.searchParams.get('timezoneOffsetMinutes')).toBe('120')
  })

  it('shows an inline phone error without submitting an invalid call phone', async () => {
    mockScheduleState = createScheduleState({
      activityType: 'call',
      title: 'Follow-up call',
    })

    renderWithProviders(
      <ScheduleActivityDialog
        open
        onClose={() => undefined}
        entityId="person-1"
        entityType="person"
      />,
    )

    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: 'not-a-phone' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Log call$/ }))
    })

    const expectedMessage = 'Enter a valid phone number with country code (e.g. +1 212 555 1234)'
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
    expect(screen.getByText(expectedMessage)).toBeInTheDocument()
    expect(flashMock).toHaveBeenCalledWith(expectedMessage, 'error')
  })
})
