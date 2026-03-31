"use client"

import * as React from 'react'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const AUDIT_FEATURES = [
  'audit_logs.view_self',
  'audit_logs.view_tenant',
  'audit_logs.undo_self',
  'audit_logs.undo_tenant',
  'audit_logs.redo_self',
  'audit_logs.redo_tenant',
]

type FeatureCheckResponse = {
  ok: boolean
  granted: string[]
  userId: string
}

export type AuditPermissions = {
  currentUserId: string | null
  canViewTenant: boolean
  canUndoSelf: boolean
  canUndoTenant: boolean
  canRedoSelf: boolean
  canRedoTenant: boolean
  isLoading: boolean
}

const EMPTY_PERMISSIONS: AuditPermissions = {
  currentUserId: null,
  canViewTenant: false,
  canUndoSelf: false,
  canUndoTenant: false,
  canRedoSelf: false,
  canRedoTenant: false,
  isLoading: true,
}

export function useAuditPermissions(enabled: boolean): AuditPermissions {
  const [permissions, setPermissions] = React.useState<AuditPermissions>(EMPTY_PERMISSIONS)

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: AUDIT_FEATURES }),
        })
        if (cancelled) return
        const granted = res.result?.granted ?? []
        setPermissions({
          currentUserId: res.result?.userId ?? null,
          canViewTenant: hasAllFeatures(['audit_logs.view_tenant'], granted),
          canUndoSelf: hasAllFeatures(['audit_logs.undo_self'], granted),
          canUndoTenant: hasAllFeatures(['audit_logs.undo_tenant'], granted),
          canRedoSelf: hasAllFeatures(['audit_logs.redo_self'], granted),
          canRedoTenant: hasAllFeatures(['audit_logs.redo_tenant'], granted),
          isLoading: false,
        })
      } catch {
        if (!cancelled) {
          setPermissions({ ...EMPTY_PERMISSIONS, isLoading: false })
        }
      }
    })()
    return () => { cancelled = true }
  }, [enabled])

  return permissions
}

export function canUndoEntry(
  permissions: AuditPermissions,
  actorUserId: string | null,
): boolean {
  if (permissions.canUndoTenant) return true
  if (permissions.canUndoSelf && actorUserId === permissions.currentUserId) return true
  return false
}

export function canRedoEntry(
  permissions: AuditPermissions,
  actorUserId: string | null,
): boolean {
  if (permissions.canRedoTenant) return true
  if (permissions.canRedoSelf && actorUserId === permissions.currentUserId) return true
  return false
}
