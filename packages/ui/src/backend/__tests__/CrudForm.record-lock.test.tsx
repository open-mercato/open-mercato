jest.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))
jest.mock('../injection/InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({
    resolvedInjectionSpotId: null,
    triggerInjectionEvent: jest.fn(async () => {}),
  }),
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [] }),
}))

const mockUseRecordLock = jest.fn()
const mockReadRecordLockError = jest.fn(() => ({ message: 'Error' }))

jest.mock('../record-locking/useRecordLock', () => ({
  useRecordLock: (config: unknown) => mockUseRecordLock(config),
  readRecordLockError: (error: unknown) => mockReadRecordLockError(error),
}))

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CrudForm, type CrudField } from '../CrudForm'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

describe('CrudForm record locking', () => {
  beforeEach(() => {
    mockUseRecordLock.mockReset()
    mockReadRecordLockError.mockReset()
    mockReadRecordLockError.mockReturnValue({ message: 'Error' })
    mockUseRecordLock.mockReturnValue({
      enabled: true,
      resourceEnabled: true,
      strategy: 'pessimistic',
      heartbeatSeconds: 30,
      lock: null,
      latestActionLogId: null,
      isOwner: false,
      isBlocked: true,
      canForceRelease: false,
      isLoading: false,
      error: null,
      errorCode: null,
      acquire: jest.fn(),
      release: jest.fn(),
      acceptIncoming: jest.fn(async () => false),
      forceRelease: jest.fn(async () => false),
      runGuardedMutation: jest.fn(async (run: () => Promise<unknown>) => run()),
      setLatestActionLogId: jest.fn(),
    })
  })

  test('falls back to versionHistory config and disables form when blocked', () => {
    const fields: CrudField[] = [{ id: 'title', label: 'Title', type: 'text' }]

    render(
      <I18nProvider locale="en" dict={{}}>
        <CrudForm
          title="Edit"
          fields={fields}
          initialValues={{
            id: '10000000-0000-4000-8000-000000000001',
            title: 'Example',
          }}
          versionHistory={{
            resourceKind: 'sales.quote',
            resourceId: '10000000-0000-4000-8000-000000000001',
          }}
          onSubmit={async () => {}}
        />
      </I18nProvider>,
    )

    expect(mockUseRecordLock).toHaveBeenCalledWith({
      resourceKind: 'sales.quote',
      resourceId: '10000000-0000-4000-8000-000000000001',
      enabled: true,
      autoCheckAcl: true,
    })

    expect(screen.getByText('This record is currently locked by another user.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take over editing' })).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Example')).toBeDisabled()
  })

  test('passes explicit autoCheckAcl from recordLocking config', () => {
    const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]

    render(
      <I18nProvider locale="en" dict={{}}>
        <CrudForm
          title="Edit"
          fields={fields}
          initialValues={{
            id: '10000000-0000-4000-8000-000000000002',
            name: 'Acme',
          }}
          recordLocking={{
            resourceKind: 'customers.company',
            resourceId: '10000000-0000-4000-8000-000000000002',
            autoCheckAcl: false,
          }}
          onSubmit={async () => {}}
        />
      </I18nProvider>,
    )

    expect(mockUseRecordLock).toHaveBeenCalledWith({
      resourceKind: 'customers.company',
      resourceId: '10000000-0000-4000-8000-000000000002',
      enabled: true,
      autoCheckAcl: false,
    })
  })

  test('maps force release unavailable error to translated message', () => {
    mockUseRecordLock.mockReturnValue({
      enabled: true,
      resourceEnabled: true,
      strategy: 'pessimistic',
      heartbeatSeconds: 30,
      lock: null,
      latestActionLogId: null,
      isOwner: false,
      isBlocked: true,
      canForceRelease: false,
      isLoading: false,
      error: 'Force release unavailable',
      errorCode: 'record_force_release_unavailable',
      acquire: jest.fn(),
      release: jest.fn(),
      acceptIncoming: jest.fn(async () => false),
      forceRelease: jest.fn(async () => false),
      runGuardedMutation: jest.fn(async (run: () => Promise<unknown>) => run()),
      setLatestActionLogId: jest.fn(),
    })

    render(
      <I18nProvider locale="en" dict={{}}>
        <CrudForm
          title="Edit"
          fields={[{ id: 'name', label: 'Name', type: 'text' }]}
          initialValues={{
            id: '10000000-0000-4000-8000-000000000003',
            name: 'Acme',
          }}
          recordLocking={{
            resourceKind: 'customers.company',
            resourceId: '10000000-0000-4000-8000-000000000003',
          }}
          onSubmit={async () => {}}
        />
      </I18nProvider>,
    )

    expect(
      screen.getByText('Force release is unavailable because takeover is disabled or the lock is no longer active.'),
    ).toBeInTheDocument()
  })

  test('accept incoming uses explicit lock cleanup flow and clears conflict dialog', async () => {
    const acceptIncoming = jest.fn(async () => true)
    const runGuardedMutation = jest.fn(async () => {
      throw new Error('record conflict')
    })

    mockUseRecordLock.mockReturnValue({
      enabled: true,
      resourceEnabled: true,
      strategy: 'optimistic',
      heartbeatSeconds: 30,
      lock: null,
      latestActionLogId: null,
      isOwner: true,
      isBlocked: false,
      canForceRelease: false,
      isLoading: false,
      error: null,
      errorCode: null,
      acquire: jest.fn(),
      release: jest.fn(),
      acceptIncoming,
      forceRelease: jest.fn(async () => false),
      runGuardedMutation,
      setLatestActionLogId: jest.fn(),
    })

    const conflict = {
      id: '10000000-0000-4000-8000-000000000001',
      resourceKind: 'customers.company',
      resourceId: '20000000-0000-4000-8000-000000000001',
      baseActionLogId: '30000000-0000-4000-8000-000000000001',
      incomingActionLogId: '40000000-0000-4000-8000-000000000001',
      resolutionOptions: ['accept_mine'] as const,
      changes: [],
    }
    mockReadRecordLockError.mockReturnValue({
      code: 'record_lock_conflict',
      message: 'Conflict detected',
      conflict,
    })

    render(
      <I18nProvider locale="en" dict={{}}>
        <CrudForm
          title="Edit"
          fields={[{ id: 'name', label: 'Name', type: 'text' }]}
          initialValues={{
            id: '10000000-0000-4000-8000-000000000002',
            name: 'Acme',
          }}
          recordLocking={{
            resourceKind: 'customers.company',
            resourceId: '10000000-0000-4000-8000-000000000002',
          }}
          onSubmit={async () => {}}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'ui.forms.actions.save' })[0])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Accept incoming' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Accept incoming' }))

    await waitFor(() => {
      expect(acceptIncoming).toHaveBeenCalledWith(expect.objectContaining({ id: conflict.id }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Accept incoming' })).not.toBeInTheDocument()
    })
  })
})
