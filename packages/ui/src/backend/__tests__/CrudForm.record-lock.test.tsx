jest.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
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

jest.mock('../record-locking/useRecordLock', () => ({
  useRecordLock: (config: unknown) => mockUseRecordLock(config),
  readRecordLockError: jest.fn(() => ({ message: 'Error' })),
}))

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { CrudForm, type CrudField } from '../CrudForm'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

describe('CrudForm record locking', () => {
  beforeEach(() => {
    mockUseRecordLock.mockReset()
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
})
