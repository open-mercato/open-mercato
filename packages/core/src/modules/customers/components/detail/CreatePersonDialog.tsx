'use client'

import * as React from 'react'
import { Building2, Pencil } from 'lucide-react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

const createPersonSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  primaryEmail: z.string().email().or(z.literal('')).optional(),
  primaryPhone: z.string().trim().optional(),
  jobTitle: z.string().trim().optional(),
})

interface CreatePersonDialogProps {
  open: boolean
  onClose: () => void
  companyId: string
  companyName: string
  runGuardedMutation?: GuardedMutationRunner
  onPersonCreated?: () => void
}

export function CreatePersonDialog({
  open,
  onClose,
  companyId,
  companyName,
  runGuardedMutation,
  onPersonCreated,
}: CreatePersonDialogProps) {
  const t = useT()
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [primaryEmail, setPrimaryEmail] = React.useState('')
  const [primaryPhone, setPrimaryPhone] = React.useState('')
  const [jobTitle, setJobTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (open) {
      setFirstName('')
      setLastName('')
      setPrimaryEmail('')
      setPrimaryPhone('')
      setJobTitle('')
      setDescription('')
      setErrors({})
    }
  }, [open])

  const displayName = React.useMemo(() => {
    const parts = [firstName.trim(), lastName.trim()].filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : ''
  }, [firstName, lastName])

  const handleSave = React.useCallback(async () => {
    const parsed = createPersonSchema.safeParse({ firstName, lastName, primaryEmail, primaryPhone, jobTitle })
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (typeof field === 'string') {
          fieldErrors[field] = issue.message
        }
      }
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const mutationPayload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: displayName || `${firstName.trim()} ${lastName.trim()}`,
        primaryEmail: primaryEmail.trim() || undefined,
        primaryPhone: primaryPhone.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
        description: description.trim() || undefined,
        companyId,
      }
      const operation = () =>
        apiCallOrThrow('/api/customers/people', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mutationPayload),
        })
      if (runGuardedMutation) {
        await runGuardedMutation(operation, mutationPayload)
      } else {
        await operation()
      }
      flash(t('customers.people.createDialog.success', 'Person created and linked to company'), 'success')
      onPersonCreated?.()
      onClose()
    } catch {
      flash(t('customers.people.createDialog.error', 'Failed to create person'), 'error')
    } finally {
      setSaving(false)
    }
  }, [companyId, description, displayName, firstName, jobTitle, lastName, onClose, onPersonCreated, primaryEmail, primaryPhone, runGuardedMutation, t])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('customers.people.createDialog.title', 'Add new person')}</DialogTitle>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="size-3.5" />
            {companyName}
            <span className="text-xs">·</span>
            <span className="text-xs">{t('customers.people.createDialog.autoLink', 'auto-linked to company')}</span>
          </p>
        </DialogHeader>

        {/* Display name preview */}
        {displayName && (
          <div className="rounded-lg bg-muted/50 px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('customers.people.createDialog.displayNamePreview', 'Display name preview')}
            </span>
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold">{displayName}</span>
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground">
                <Pencil className="size-3" />
                {t('customers.people.createDialog.editName', 'Edit name')}
              </Button>
            </div>
          </div>
        )}

        {/* Personal data */}
        <div className="space-y-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('customers.people.createDialog.personalData', 'Personal data')}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">
                {t('customers.people.createDialog.firstName', 'First name')}
                <span className="ml-0.5 text-destructive">*</span>
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              {errors.firstName && (
                <p className="mt-1 text-xs text-destructive">{errors.firstName}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">
                {t('customers.people.createDialog.lastName', 'Last name')}
                <span className="ml-0.5 text-destructive">*</span>
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {errors.lastName && (
                <p className="mt-1 text-xs text-destructive">{errors.lastName}</p>
              )}
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="space-y-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('customers.people.createDialog.contact', 'Contact')}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">
                {t('customers.people.createDialog.email', 'Primary email')}
              </label>
              <input
                type="email"
                value={primaryEmail}
                onChange={(e) => setPrimaryEmail(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {errors.primaryEmail && (
                <p className="mt-1 text-xs text-destructive">{errors.primaryEmail}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">
                {t('customers.people.createDialog.phone', 'Primary phone')}
              </label>
              <input
                type="tel"
                value={primaryPhone}
                onChange={(e) => setPrimaryPhone(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        {/* Position */}
        <div className="space-y-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('customers.people.createDialog.position', 'Position & company')}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">
                {t('customers.people.createDialog.jobTitle', 'Job title')}
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {t('customers.people.createDialog.company', 'Company')}
                <span className="ml-1 text-[10px] text-muted-foreground">{t('customers.people.createDialog.auto', 'auto')}</span>
              </label>
              <div className="mt-1 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <Building2 className="size-3.5 text-muted-foreground" />
                <span>{companyName}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('customers.people.createDialog.notes', 'Notes')}
          </span>
          <div>
            <label className="text-sm font-medium">
              {t('customers.people.createDialog.description', 'Description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[80px] resize-y"
              rows={3}
            />
          </div>
        </div>

        {/* Required fields note */}
        <p className="text-xs text-muted-foreground">
          {t('customers.people.createDialog.required', 'Fields marked * are required')}
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('customers.people.createDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !firstName.trim() || !lastName.trim()}>
            <Building2 className="mr-1.5 size-4" />
            {saving
              ? t('customers.people.createDialog.creating', 'Creating...')
              : t('customers.people.createDialog.submit', 'Create person')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
