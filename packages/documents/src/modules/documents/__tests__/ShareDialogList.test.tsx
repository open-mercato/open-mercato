/** @jest-environment jsdom */

import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

const translations: Record<string, string> = {
  'documents.actions.unshare': 'Remove access',
  'documents.permissions.editor': 'Editor',
  'documents.permissions.commenter': 'Commenter',
  'documents.permissions.viewer': 'Viewer',
  'documents.share.dialog.current': 'Current access',
  'documents.share.dialog.permission': 'Permission',
  'documents.share.principalTypes.user': 'User',
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => translations[key] ?? key,
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label, action }: { label: string; action?: ReactNode }) => <div>{label}{action}</div>,
}))

import { ShareDialogList } from '../backend/documents/components/ShareDialogList'

const SHARE_ID = '11111111-1111-4111-8111-111111111111'
const PRINCIPAL_ID = '22222222-2222-4222-8222-222222222222'

describe('ShareDialogList', () => {
  it('uses a readable principal label in row actions and never renders the principal UUID', () => {
    render(
      <ShareDialogList
        shares={[{
          id: SHARE_ID,
          principalType: 'user',
          principalId: PRINCIPAL_ID,
          principalLabel: 'Ada Lovelace',
          principalSecondary: 'ada@example.com',
          resolved: true,
          permission: 'editor',
          updatedAt: '2026-07-10T10:00:00.000Z',
        }]}
        isLoading={false}
        error={null}
        canManage
        pendingShareIds={new Set()}
        onPermissionChange={jest.fn(async () => undefined)}
        onRemove={jest.fn(async () => undefined)}
      />,
    )

    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.queryByText(PRINCIPAL_ID)).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Permission: Ada Lovelace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove access: Ada Lovelace' })).toBeTruthy()
  })

  it('retries a failed share list load without reopening the dialog', () => {
    const onRetry = jest.fn()
    render(
      <ShareDialogList
        shares={[]}
        isLoading={false}
        error="Failed to load access"
        canManage
        pendingShareIds={new Set()}
        onRetry={onRetry}
        onPermissionChange={jest.fn(async () => undefined)}
        onRemove={jest.fn(async () => undefined)}
      />,
    )

    screen.getByRole('button', { name: 'documents.actions.retry' }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('disables both row mutations while that share is pending', () => {
    render(
      <ShareDialogList
        shares={[{
          id: SHARE_ID,
          principalType: 'user',
          principalId: PRINCIPAL_ID,
          principalLabel: 'Ada Lovelace',
          principalSecondary: 'ada@example.com',
          resolved: true,
          permission: 'editor',
          updatedAt: '2026-07-10T10:00:00.000Z',
        }]}
        isLoading={false}
        error={null}
        canManage
        pendingShareIds={new Set([SHARE_ID])}
        onPermissionChange={jest.fn(async () => undefined)}
        onRemove={jest.fn(async () => undefined)}
      />,
    )

    expect((screen.getByRole('combobox', { name: 'Permission: Ada Lovelace' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove access: Ada Lovelace' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
