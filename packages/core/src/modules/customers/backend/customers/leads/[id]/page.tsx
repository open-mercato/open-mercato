"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { LeadForm, type LeadFormSubmitPayload } from '../../../../components/detail/LeadForm'
import { LeadQualificationDialog } from '../../../../components/detail/LeadQualificationDialog'

type LeadDetailPayload = {
  id: string
  title: string
  description: string | null
  status: string | null
  source: string | null
  estimatedValueAmount: number | null
  estimatedValueCurrency: string | null
  companyName: string | null
  companyVatId: string | null
  contactFirstName: string | null
  contactLastName: string | null
  contactPhone: string | null
  contactEmail: string | null
  createdDealId: string | null
  createdPersonEntityId: string | null
  createdCompanyEntityId: string | null
  convertedAt: string | null
  convertedByUserId: string | null
  organizationId: string | null
  tenantId: string | null
  createdAt: string
  updatedAt: string
}

function statusLabelKey(status: string): string {
  switch (status) {
    case 'open':
      return 'customers.leads.status.open'
    case 'in_progress':
      return 'customers.leads.status.in_progress'
    case 'qualified':
      return 'customers.leads.status.qualified'
    case 'rejected':
      return 'customers.leads.status.rejected'
    default:
      return 'customers.leads.status.open'
  }
}

export default function LeadDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const id = params?.id ?? ''

  const [data, setData] = React.useState<LeadDetailPayload | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [qualifyDialogOpen, setQualifyDialogOpen] = React.useState(false)

  React.useEffect(() => {
    if (!id) {
      setError(t('customers.leads.detail.missingId', 'Lead id is required.'))
      setIsLoading(false)
      return
    }
    let cancelled = false
    async function loadLead() {
      setIsLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<LeadDetailPayload>(
          `/api/customers/leads/${encodeURIComponent(id)}`,
          undefined,
          { errorMessage: t('customers.leads.detail.loadError', 'Failed to load lead.') },
        )
        if (cancelled) return
        setData(payload as LeadDetailPayload)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.leads.detail.loadError', 'Failed to load lead.')
        setError(message)
        setData(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    loadLead().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, reloadToken, t])

  const handleFormSubmit = React.useCallback(
    async ({ base, custom }: LeadFormSubmitPayload) => {
      if (!data || isSaving) return
      setIsSaving(true)
      try {
        const payload: Record<string, unknown> = {
          id: data.id,
          title: base.title,
          status: base.status ?? undefined,
          source: base.source ?? undefined,
          estimatedValueAmount: typeof base.estimatedValueAmount === 'number' ? base.estimatedValueAmount : undefined,
          estimatedValueCurrency: base.estimatedValueCurrency ?? undefined,
          companyName: base.companyName ?? undefined,
          companyVatId: base.companyVatId ?? undefined,
          contactFirstName: base.contactFirstName ?? undefined,
          contactLastName: base.contactLastName ?? undefined,
          contactPhone: base.contactPhone ?? undefined,
          contactEmail: base.contactEmail ?? undefined,
          description: base.description ?? undefined,
        }
        if (Object.keys(custom).length) payload.customFields = custom

        await apiCallOrThrow(
          '/api/customers/leads',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('customers.leads.detail.saveError', 'Failed to save lead.') },
        )
        flash(t('customers.leads.detail.saveSuccess', 'Lead saved.'), 'success')
        setReloadToken((token) => token + 1)
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('customers.leads.detail.saveError', 'Failed to save lead.')
        flash(message, 'error')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setIsSaving(false)
      }
    },
    [data, isSaving, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!data || isDeleting) return
    const confirmed = await confirm({
      title: t('customers.leads.detail.deleteConfirm', 'Delete this lead? This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return

    setIsDeleting(true)
    try {
      await apiCallOrThrow(
        '/api/customers/leads',
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: data.id }),
        },
        { errorMessage: t('customers.leads.detail.deleteError', 'Failed to delete lead.') },
      )
      flash(t('customers.leads.detail.deleteSuccess', 'Lead deleted.'), 'success')
      router.push('/backend/customers/leads')
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('customers.leads.detail.deleteError', 'Failed to delete lead.')
      flash(message, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [confirm, data, isDeleting, router, t])

  const handleConverted = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const isConverted = data?.status === 'qualified' || (data?.convertedAt != null && data.convertedAt !== '')
  const hasContactName = !!(data?.contactFirstName && data.contactLastName)
  const hasCompanyName = !!(data?.companyName && data.companyName.trim().length)

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('customers.leads.detail.loading', 'Loading lead…')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
            <p>{error || t('customers.leads.detail.notFound', 'Lead not found.')}</p>
            <Button variant="outline" asChild>
              <Link href="/backend/customers/leads">
                {t('customers.leads.detail.backToList', 'Back to leads')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" asChild>
              <Link href="/backend/customers/leads">
                {t('customers.leads.detail.backToList', 'Back to leads')}
              </Link>
            </Button>
            <span className="rounded-md border border-border bg-muted/50 px-3 py-1 text-sm font-medium">
              {t(statusLabelKey(data.status ?? 'open'), data.status ?? 'open')}
            </span>
          </div>
          {!isConverted ? (
            <Button onClick={() => setQualifyDialogOpen(true)}>
              {t('customers.leads.detail.actions.qualify', 'Qualify')}
            </Button>
          ) : null}
        </div>

        <LeadForm
          mode="edit"
          initialValues={{
            id: data.id,
            title: data.title,
            description: data.description ?? '',
            status: data.status ?? 'open',
            source: data.source ?? '',
            estimatedValueAmount: data.estimatedValueAmount != null ? Number(data.estimatedValueAmount) : null,
            estimatedValueCurrency: data.estimatedValueCurrency ?? '',
            companyName: data.companyName ?? '',
            companyVatId: data.companyVatId ?? '',
            contactFirstName: data.contactFirstName ?? '',
            contactLastName: data.contactLastName ?? '',
            contactPhone: data.contactPhone ?? '',
            contactEmail: data.contactEmail ?? '',
          }}
          onSubmit={handleFormSubmit}
          onCancel={() => router.push('/backend/customers/leads')}
          onDelete={handleDelete}
          isSubmitting={isSaving}
          embedded={false}
          title={data.title}
          backHref="/backend/customers/leads"
          isConverted={isConverted}
        />

        {isConverted ? (
          <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              {t('customers.leads.detail.conversionTitle', 'Conversion lineage')}
            </h3>
            <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
              {data.createdDealId ? (
                <p>
                  {t('customers.leads.detail.createdDeal', 'Deal')}:{' '}
                  <Link href={`/backend/customers/deals/${data.createdDealId}`} className="text-primary hover:underline">
                    {data.createdDealId}
                  </Link>
                </p>
              ) : null}
              {data.createdPersonEntityId ? (
                <p>
                  {t('customers.leads.detail.createdPerson', 'Person')}:{' '}
                  <Link href={`/backend/customers/people/${data.createdPersonEntityId}`} className="text-primary hover:underline">
                    {data.createdPersonEntityId}
                  </Link>
                </p>
              ) : null}
              {data.createdCompanyEntityId ? (
                <p>
                  {t('customers.leads.detail.createdCompany', 'Company')}:{' '}
                  <Link href={`/backend/customers/companies/${data.createdCompanyEntityId}`} className="text-primary hover:underline">
                    {data.createdCompanyEntityId}
                  </Link>
                </p>
              ) : null}
              {data.convertedAt ? (
                <p>
                  {t('customers.leads.detail.convertedAt', 'Converted at')}: {data.convertedAt}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </PageBody>

      <LeadQualificationDialog
        leadId={data.id}
        leadUpdatedAt={data.updatedAt}
        open={qualifyDialogOpen}
        onOpenChange={setQualifyDialogOpen}
        onConverted={handleConverted}
        hasContactName={hasContactName}
        hasCompanyName={hasCompanyName}
      />
      {ConfirmDialogElement}
    </Page>
  )
}
