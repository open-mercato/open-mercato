"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { PrincipalPicker } from './PrincipalPicker'
import {
  PRINCIPAL_TYPES,
  SHARE_PERMISSIONS,
  readPermission,
  readPrincipalType,
  type DocumentSharePermission,
  type DocumentSharePrincipalType,
} from './shareDialogModel'

type ShareDialogAddFormProps = {
  documentId: string
  principalType: DocumentSharePrincipalType
  principalId: string
  permission: DocumentSharePermission
  canManage: boolean
  isSubmitting: boolean
  onPrincipalTypeChange: (value: DocumentSharePrincipalType) => void
  onPrincipalIdChange: (value: string) => void
  onPermissionChange: (value: DocumentSharePermission) => void
  onSubmit: () => Promise<void>
}

export function ShareDialogAddForm({
  documentId,
  principalType,
  principalId,
  permission,
  canManage,
  isSubmitting,
  onPrincipalTypeChange,
  onPrincipalIdChange,
  onPermissionChange,
  onSubmit,
}: ShareDialogAddFormProps) {
  const t = useT()
  const principalInputId = React.useId()
  const principalTypeInputId = React.useId()
  const permissionInputId = React.useId()
  const disabled = !canManage || isSubmitting

  return (
    <form
      className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault()
        void onSubmit()
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={principalInputId}>{t('documents.share.dialog.principalSearch')}</Label>
        <PrincipalPicker
          documentId={documentId}
          id={principalInputId}
          principalType={principalType}
          value={principalId || null}
          onChange={(id) => onPrincipalIdChange(id ?? '')}
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={principalTypeInputId}>{t('documents.share.dialog.principalType')}</Label>
        <Select
          value={principalType}
          onValueChange={(value) => onPrincipalTypeChange(readPrincipalType(value))}
          disabled={disabled}
        >
          <SelectTrigger id={principalTypeInputId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRINCIPAL_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`documents.share.principalTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={permissionInputId}>{t('documents.share.dialog.permission')}</Label>
        <Select
          value={permission}
          onValueChange={(value) => onPermissionChange(readPermission(value))}
          disabled={disabled}
        >
          <SelectTrigger id={permissionInputId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHARE_PERMISSIONS.map((tier) => (
              <SelectItem key={tier} value={tier}>
                {t(`documents.permissions.${tier}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-3">
        <Button type="submit" disabled={disabled || principalId.trim().length === 0}>
          {t('documents.share.dialog.add')}
        </Button>
      </div>
    </form>
  )
}
