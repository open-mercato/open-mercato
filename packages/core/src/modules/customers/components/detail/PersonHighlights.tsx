"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Loader2, Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { VersionHistoryAction } from '@open-mercato/ui/backend/version-history'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { cn } from '@open-mercato/shared/lib/utils'
import { CompanySelectField } from '../formConfig'
import {
  InlineTextEditor,
  InlineDictionaryEditor,
  InlineNextInteractionEditor,
  type InlineFieldProps,
  type NextInteractionPayload,
} from './InlineEditors'

type PersonHighlightsPerson = {
  id: string
  displayName: string
  primaryEmail?: string | null
  primaryPhone?: string | null
  status?: string | null
  nextInteractionAt?: string | null
  nextInteractionName?: string | null
  nextInteractionRefId?: string | null
  nextInteractionIcon?: string | null
  nextInteractionColor?: string | null
  organizationId?: string | null
}

type PersonHighlightsProfile = {
  id?: string
  companyEntityId?: string | null
} | null

type PersonHighlightsValidators = {
  email: NonNullable<InlineFieldProps['validator']>
  phone: NonNullable<InlineFieldProps['validator']>
  displayName: NonNullable<InlineFieldProps['validator']>
}

export type PersonHighlightsProps = {
  person: PersonHighlightsPerson
  profile: PersonHighlightsProfile
  validators: PersonHighlightsValidators
  onDisplayNameSave: (value: string | null) => Promise<void>
  onPrimaryEmailSave: (value: string | null) => Promise<void>
  onPrimaryPhoneSave: (value: string | null) => Promise<void>
  onStatusSave: (value: string | null) => Promise<void>
  onNextInteractionSave: (value: NextInteractionPayload | null) => Promise<void>
  onDelete: () => void
  isDeleting: boolean
  onCompanySave: (companyId: string | null) => Promise<void>
}

type CompanyInfo = { id: string; name: string }

export function PersonHighlights({
  person,
  profile,
  validators,
  onDisplayNameSave,
  onPrimaryEmailSave,
  onPrimaryPhoneSave,
  onStatusSave,
  onNextInteractionSave,
  onDelete,
  isDeleting,
  onCompanySave,
}: PersonHighlightsProps) {
  const router = useRouter()
  const t = useT()
  const runMutation = React.useCallback(async (operation: () => Promise<void>) => operation(), [])
  const [editingCompany, setEditingCompany] = React.useState(false)
  const [companyDraftId, setCompanyDraftId] = React.useState<string>('')
  const [company, setCompany] = React.useState<CompanyInfo | null>(null)
  const [companyLoading, setCompanyLoading] = React.useState(false)
  const [companyError, setCompanyError] = React.useState<string | null>(null)
  const [companySaving, setCompanySaving] = React.useState(false)
  const companyHref = React.useMemo(
    () => (company ? `/backend/customers/companies/${encodeURIComponent(company.id)}` : null),
    [company],
  )
  const isCompanyInteractive = !editingCompany && !companyLoading && !companyError && Boolean(companyHref)

  const navigateToCompany = React.useCallback(() => {
    if (!companyHref) return
    router.push(companyHref)
  }, [companyHref])

  const handleCompanyClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isCompanyInteractive || !companyHref) return
      const target = event.target as HTMLElement
      if (target.closest('button')) return
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        if (typeof window !== 'undefined') {
          window.open(companyHref, '_blank', 'noopener,noreferrer')
        }
        return
      }
      navigateToCompany()
    },
    [companyHref, isCompanyInteractive, navigateToCompany],
  )

  const handleCompanyKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isCompanyInteractive) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        navigateToCompany()
      }
    },
    [isCompanyInteractive, navigateToCompany],
  )

  const activeCompanyId = profile?.companyEntityId ?? null
  const historyFallbackId =
    profile?.id && profile.id !== person.id ? profile.id : undefined

  const loadCompany = React.useCallback(async (companyId: string | null) => {
    if (!companyId) {
      setCompany(null)
      return
    }
    setCompanyLoading(true)
    setCompanyError(null)
    try {
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/customers/companies?id=${encodeURIComponent(companyId)}`,
        undefined,
        { errorMessage: t('customers.people.detail.company.loadError', 'Unable to load company information.') },
      )
      const items = Array.isArray(payload?.items) ? (payload.items as Array<Record<string, unknown>>) : []
      const item = items.find((entry) => {
        if (!entry) return false
        const rawId = (entry as Record<string, unknown>).id
        if (typeof rawId === 'string') return rawId === companyId
        if (typeof rawId === 'number') return String(rawId) === companyId
        return false
      }) as Record<string, unknown> | undefined
      if (item && typeof item.display_name === 'string') {
        setCompany({ id: companyId, name: item.display_name })
      } else if (item && typeof item.displayName === 'string') {
        setCompany({ id: companyId, name: item.displayName })
      } else {
        setCompany({ id: companyId, name: t('customers.people.detail.company.unknown', 'Unknown company') })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.people.detail.company.loadError', 'Unable to load company.')
      setCompanyError(message)
      setCompany(null)
    } finally {
      setCompanyLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    setCompanyDraftId(activeCompanyId ?? '')
    loadCompany(activeCompanyId).catch(() => {})
  }, [activeCompanyId, loadCompany])

  const handleCompanySave = React.useCallback(async () => {
    if (companySaving) return
    setCompanySaving(true)
    setCompanyError(null)
    const nextId = companyDraftId.trim()
    try {
      await runMutation(async () => {
        await onCompanySave(nextId.length ? nextId : null)
      })
      await loadCompany(nextId.length ? nextId : null)
      setEditingCompany(false)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('customers.people.detail.company.saveError', 'Unable to update company.')
      setCompanyError(message)
    } finally {
      setCompanySaving(false)
    }
  }, [companyDraftId, companySaving, loadCompany, onCompanySave, runMutation, t])

  const handleCompanyClear = React.useCallback(async () => {
    if (companySaving) return
    setCompanySaving(true)
    setCompanyError(null)
    try {
      await runMutation(async () => {
        await onCompanySave(null)
      })
      await loadCompany(null)
      setCompanyDraftId('')
      setEditingCompany(false)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('customers.people.detail.company.saveError', 'Unable to update company.')
      setCompanyError(message)
    } finally {
      setCompanySaving(false)
    }
  }, [companySaving, loadCompany, onCompanySave, runMutation, t])

  const companyPanel = (
    <div
      className={cn(
        'group rounded-lg border bg-muted/30 p-3',
        isCompanyInteractive
          ? 'cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : null,
      )}
      role={isCompanyInteractive ? 'link' : undefined}
      tabIndex={isCompanyInteractive ? 0 : undefined}
      onClick={handleCompanyClick}
      onKeyDown={handleCompanyKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Building2 aria-hidden className="h-3.5 w-3.5" />
            {t('customers.people.detail.company.label', 'Company')}
          </p>
          {editingCompany ? (
            <div
              className="space-y-3"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  if (!companySaving) {
                    setEditingCompany(false)
                    setCompanyError(null)
                    setCompanyDraftId(activeCompanyId ?? '')
                  }
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!companySaving) {
                    void handleCompanySave()
                  }
                }
              }}
            >
              <CompanySelectField
                value={companyDraftId || undefined}
                onChange={(next) => setCompanyDraftId(next ?? '')}
                labels={{
                  placeholder: t('customers.people.form.company.placeholder'),
                  addLabel: t('customers.people.form.company.add'),
                  addPrompt: t('customers.people.form.company.prompt'),
                  dialogTitle: t('customers.people.form.company.dialogTitle'),
                  inputLabel: t('customers.people.form.company.inputLabel'),
                  inputPlaceholder: t('customers.people.form.company.inputPlaceholder'),
                  emptyError: t('customers.people.form.dictionary.errorRequired'),
                  cancelLabel: t('customers.people.form.dictionary.cancel'),
                  saveLabel: t('customers.people.form.dictionary.save'),
                  errorLoad: t('customers.people.form.dictionary.errorLoad'),
                  errorSave: t('customers.people.form.dictionary.error'),
                  loadingLabel: t('customers.people.form.company.loading'),
                }}
              />
              {companyError ? <p className="text-xs text-red-600">{companyError}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={handleCompanySave} disabled={companySaving}>
                  {companySaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('ui.forms.actions.save')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => {
                  setEditingCompany(false)
                  setCompanyError(null)
                  setCompanyDraftId(activeCompanyId ?? '')
                }} disabled={companySaving}>
                  {t('ui.forms.actions.cancel')}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={handleCompanyClear} disabled={companySaving}>
                  {t('ui.forms.actions.clear')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              {companyLoading ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('customers.people.detail.company.loading', 'Loading company…')}
                </span>
              ) : company ? (
                <span className="text-primary transition group-hover:underline">
                  {t('customers.people.detail.company.current', undefined, { company: company.name })}
                </span>
              ) : companyError ? (
                <span className="text-xs text-red-600">{companyError}</span>
              ) : (
                <span className="text-muted-foreground">
                  {t('customers.people.detail.company.empty', 'No company assigned')}
                </span>
              )}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            if (companySaving) return
            setEditingCompany((prev) => !prev)
            setCompanyError(null)
            setCompanyDraftId(activeCompanyId ?? '')
          }}
          className={
            editingCompany
              ? 'opacity-100'
              : 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100'
          }
        >
          {editingCompany ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          <span className="sr-only">
            {editingCompany ? t('ui.forms.actions.cancel') : t('ui.forms.actions.edit')}
          </span>
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <FormHeader
        mode="detail"
        backHref="/backend/customers/people"
        backLabel={t('customers.people.detail.actions.backToList')}
        utilityActions={(
          <VersionHistoryAction
            config={{
              resourceKind: 'customers.person',
              resourceId: person.id,
              resourceIdFallback: historyFallbackId,
              organizationId: person.organizationId ?? undefined,
            }}
            t={t}
          />
        )}
        title={
          <InlineTextEditor
            label={t('customers.people.form.displayName.label')}
            value={person.displayName}
            placeholder={t('customers.people.form.displayName.placeholder')}
            emptyLabel={t('customers.people.detail.noValue')}
            validator={validators.displayName}
            onSave={onDisplayNameSave}
            hideLabel
            variant="plain"
            activateOnClick
            triggerClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            containerClassName="max-w-full"
          />
        }
        onDelete={() => {
          onDelete()
        }}
        isDeleting={isDeleting}
        deleteLabel={t('customers.people.list.actions.delete')}
      />

      {companyPanel}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InlineTextEditor
          label={t('customers.people.detail.highlights.primaryEmail')}
          value={person.primaryEmail || ''}
          placeholder={t('customers.people.form.primaryEmail')}
          emptyLabel={t('customers.people.detail.noValue')}
          type="email"
          validator={validators.email}
          recordId={person.id}
          activateOnClick
          onSave={onPrimaryEmailSave}
        />
        <InlineTextEditor
          label={t('customers.people.detail.highlights.primaryPhone')}
          value={person.primaryPhone || ''}
          placeholder={t('customers.people.form.primaryPhone')}
          emptyLabel={t('customers.people.detail.noValue')}
          type="tel"
          validator={validators.phone}
          recordId={person.id}
          activateOnClick
          onSave={onPrimaryPhoneSave}
        />
        <InlineDictionaryEditor
          label={t('customers.people.detail.highlights.status')}
          value={person.status ?? null}
          emptyLabel={t('customers.people.detail.noValue')}
          activateOnClick
          onSave={onStatusSave}
          kind="statuses"
        />
        <InlineNextInteractionEditor
          label={t('customers.people.detail.highlights.nextInteraction')}
          valueAt={person.nextInteractionAt || null}
          valueName={person.nextInteractionName || null}
          valueRefId={person.nextInteractionRefId || null}
          valueIcon={person.nextInteractionIcon || null}
          valueColor={person.nextInteractionColor || null}
          emptyLabel={t('customers.people.detail.noValue')}
          onSave={onNextInteractionSave}
          activateOnClick
        />
      </div>
    </div>
  )
}

export default PersonHighlights
