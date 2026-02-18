import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { RecordConflictDialog } from '../RecordConflictDialog'

const t = (key: string, fallback?: string) => fallback ?? key

describe('RecordConflictDialog', () => {
  test('calls onAcceptIncoming callback explicitly without implicit close side effects', () => {
    const onOpenChange = jest.fn()
    const onResolve = jest.fn()
    const onAcceptIncoming = jest.fn()

    render(
      <I18nProvider locale="en" dict={{}}>
        <RecordConflictDialog
          open
          onOpenChange={onOpenChange}
          conflict={{
            id: '10000000-0000-4000-8000-000000000001',
            resourceKind: 'customers.company',
            resourceId: '20000000-0000-4000-8000-000000000001',
            baseActionLogId: '30000000-0000-4000-8000-000000000001',
            incomingActionLogId: '40000000-0000-4000-8000-000000000001',
            resolutionOptions: ['accept_mine'],
            changes: [],
          }}
          t={t}
          onResolve={onResolve}
          onAcceptIncoming={onAcceptIncoming}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept incoming' }))

    expect(onAcceptIncoming).toHaveBeenCalledTimes(1)
    expect(onResolve).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
