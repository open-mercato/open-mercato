'use client'

import * as React from 'react'
import Link from 'next/link'
import { Building2, Trash2, Star } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { CompanySelectField } from '../formConfig'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type CompanyLinkRow = {
  id: string
  companyId: string
  displayName: string
  isPrimary: boolean
}

type PersonCompaniesSectionProps = {
  personId: string
  onChanged?: () => void
  runGuardedMutation?: GuardedMutationRunner
}

export function PersonCompaniesSection({ personId, onChanged, runGuardedMutation }: PersonCompaniesSectionProps) {
  const t = useT()
  const [rows, setRows] = React.useState<CompanyLinkRow[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState<string | null>(null)

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    try {
      const payload = await readApiResultOrThrow<{ items?: CompanyLinkRow[] }>(
        `/api/customers/people/${encodeURIComponent(personId)}/companies`,
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      setRows(items)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('customers.people.detail.companies.loadError', 'Failed to load companies.')
      flash(message, 'error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [personId, t])

  React.useEffect(() => {
    loadRows().catch(() => {})
  }, [loadRows])

  const runWriteMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      if (!runGuardedMutation) {
        return operation()
      }
      return runGuardedMutation(operation, mutationPayload)
    },
    [runGuardedMutation],
  )

  const handleAdd = React.useCallback(async () => {
    if (!selectedCompanyId) return
    if (rows.some((row) => row.companyId === selectedCompanyId)) {
      flash(t('customers.people.detail.companies.alreadyLinked', 'This company is already linked.'), 'error')
      return
    }

    setSaving('add')
    try {
      await runWriteMutation(
        () =>
          apiCallOrThrow(
            `/api/customers/people/${encodeURIComponent(personId)}/companies`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                companyId: selectedCompanyId,
                isPrimary: rows.length === 0,
              }),
            },
          ),
        {
          personId,
          companyId: selectedCompanyId,
          isPrimary: rows.length === 0,
        },
      )
      setSelectedCompanyId(undefined)
      await loadRows()
      onChanged?.()
      flash(t('customers.people.detail.companies.addSuccess', 'Company linked.'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('customers.people.detail.companies.addError', 'Failed to link company.')
      flash(message, 'error')
    } finally {
      setSaving(null)
    }
  }, [loadRows, onChanged, personId, rows, runWriteMutation, selectedCompanyId, t])

  const handleMakePrimary = React.useCallback(async (row: CompanyLinkRow) => {
    setSaving(`primary:${row.id}`)
    try {
      await runWriteMutation(
        () =>
          apiCallOrThrow(
            `/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(row.id)}`,
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ isPrimary: true }),
            },
          ),
        {
          personId,
          companyId: row.companyId,
          linkId: row.id,
          isPrimary: true,
        },
      )
      await loadRows()
      onChanged?.()
      flash(t('customers.people.detail.companies.primarySuccess', 'Primary company updated.'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('customers.people.detail.companies.primaryError', 'Failed to update the primary company.')
      flash(message, 'error')
    } finally {
      setSaving(null)
    }
  }, [loadRows, onChanged, personId, runWriteMutation, t])

  const handleRemove = React.useCallback(async (row: CompanyLinkRow) => {
    setSaving(`remove:${row.id}`)
    try {
      await runWriteMutation(
        () =>
          apiCallOrThrow(
            `/api/customers/people/${encodeURIComponent(personId)}/companies/${encodeURIComponent(row.id)}`,
            { method: 'DELETE' },
          ),
        {
          personId,
          companyId: row.companyId,
          linkId: row.id,
        },
      )
      await loadRows()
      onChanged?.()
      flash(t('customers.people.detail.companies.removeSuccess', 'Company removed.'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('customers.people.detail.companies.removeError', 'Failed to remove company.')
      flash(message, 'error')
    } finally {
      setSaving(null)
    }
  }, [loadRows, onChanged, personId, runWriteMutation, t])

  return (
    <div className="space-y-4 rounded-[18px] border border-border/70 bg-card p-5">
      <div className="flex flex-col gap-3 border-b border-border/60 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {t('customers.people.detail.tabs.companies', 'Companies')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('customers.people.detail.companies.subtitle', 'Link one or more companies and choose the primary relationship for this person.')}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 lg:max-w-md">
          <CompanySelectField
            value={selectedCompanyId}
            onChange={setSelectedCompanyId}
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
          <Button type="button" onClick={handleAdd} disabled={!selectedCompanyId || saving !== null}>
            {saving === 'add'
              ? t('customers.people.detail.companies.adding', 'Linking…')
              : t('customers.people.detail.companies.addAction', 'Link company')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
          {t('customers.people.detail.companies.loading', 'Loading companies…')}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
          {t('customers.people.detail.empty.companies', 'No company linked to this person.')}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const isSavingPrimary = saving === `primary:${row.id}`
            const isSavingRemove = saving === `remove:${row.id}`
            return (
              <div
                key={row.id}
                className="flex flex-col gap-4 rounded-[16px] border border-border/70 bg-background px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-10 items-center justify-center rounded-[12px] bg-muted text-muted-foreground">
                      <Building2 className="size-4" />
                    </span>
                    <Link
                      href={`/backend/customers/companies-v2/${encodeURIComponent(row.companyId)}`}
                      className="truncate text-sm font-semibold text-foreground hover:underline"
                    >
                      {row.displayName}
                    </Link>
                    {row.isPrimary ? (
                      <span className="rounded-[6px] bg-[#fef8eb] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#f29f12]">
                        {t('customers.people.detail.header.primary', 'PRIMARY')}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!row.isPrimary ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleMakePrimary(row)}
                      disabled={saving !== null}
                    >
                      <Star className="size-4" />
                      {isSavingPrimary
                        ? t('customers.people.detail.companies.primaryPending', 'Updating…')
                        : t('customers.people.detail.companies.makePrimary', 'Set primary')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemove(row)}
                    disabled={saving !== null}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    {isSavingRemove
                      ? t('customers.people.detail.companies.removing', 'Removing…')
                      : t('customers.people.detail.companies.removeAction', 'Remove')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
