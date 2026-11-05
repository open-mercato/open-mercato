import type * as React from 'react'
import {
  resolveCommentsCapability,
  resolveVersionRestoreCapability,
} from '../backend/documents/[id]/componentCapabilities'
import type { EntityRegistryEntry } from '../lib/entityRegistry'
import type { DefaultDocumentTemplateSeed } from '../lib/templateSeeds'

type CommentsRailComponent = typeof import('../backend/documents/[id]/CommentsRail')['CommentsRail']
type VersionHistoryPanelComponent = typeof import('../backend/documents/[id]/VersionHistoryPanel')['VersionHistoryPanel']
type ShareDialogComponent = typeof import('../backend/documents/components/ShareDialog')['ShareDialog']

const legacyRegistryEntry: EntityRegistryEntry = {
  type: 'customer-person',
  labelKey: 'documents.entities.customerPerson',
  searchPath: '/api/customers/people',
  mapItem: () => null,
  href: (id) => `/backend/customers/people/${id}`,
  tokenFields: [],
}

const legacyTemplateSeed: DefaultDocumentTemplateSeed = {
  name: 'Legacy template',
  description: 'Legacy seed shape',
  bodyHtml: '<p>Body</p>',
  contextSlots: [],
}

const legacyCommentsProps: React.ComponentProps<CommentsRailComponent> = {
  documentId: '11111111-1111-4111-8111-111111111111',
  editor: null,
  tier: 'commenter',
}

const legacyVersionsProps: React.ComponentProps<VersionHistoryPanelComponent> = {
  documentId: '11111111-1111-4111-8111-111111111111',
  tier: 'editor',
}

const legacyShareDialogProps: React.ComponentProps<ShareDialogComponent> = {
  documentId: '11111111-1111-4111-8111-111111111111',
  open: false,
  onOpenChange: () => undefined,
}

describe('documents deep-import compatibility', () => {
  it('keeps the legacy registry and template seed types assignable', () => {
    expect(legacyRegistryEntry.type).toBe('customer-person')
    expect(legacyTemplateSeed.name).toBe('Legacy template')
  })

  it('keeps tier-only component props assignable', () => {
    expect(legacyCommentsProps.tier).toBe('commenter')
    expect(legacyVersionsProps.tier).toBe('editor')
  })

  it('keeps the public ShareDialog capability prop optional', () => {
    expect(legacyShareDialogProps.open).toBe(false)
    expect(legacyShareDialogProps.canManage).toBeUndefined()
  })

  it('lets explicit capability projections override tiers and otherwise fails closed', () => {
    expect(resolveCommentsCapability(false, 'owner')).toBe(false)
    expect(resolveCommentsCapability(true, 'viewer')).toBe(true)
    expect(resolveCommentsCapability(undefined, 'commenter')).toBe(true)
    expect(resolveCommentsCapability(undefined, undefined)).toBe(false)

    expect(resolveVersionRestoreCapability(false, 'owner')).toBe(false)
    expect(resolveVersionRestoreCapability(true, 'viewer')).toBe(true)
    expect(resolveVersionRestoreCapability(undefined, 'editor')).toBe(true)
    expect(resolveVersionRestoreCapability(undefined, undefined)).toBe(false)
  })
})
