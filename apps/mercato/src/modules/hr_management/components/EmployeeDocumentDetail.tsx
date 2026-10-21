"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AttachmentInput } from '@open-mercato/core/modules/attachments/fields/attachment'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { EmployeeDocumentRow } from './EmployeeDocumentsTable'
import { DOCUMENT_TYPE_FALLBACKS } from './EmployeeDocumentsTable'
import { useEmployeeLabels } from './hrOptions'
import { ExpiryCell } from './ExpiryCell'

const RESOURCE = 'hr_management/employee-documents'
const LIST_HREF = '/backend/hr/documents'
const editHref = (id: string) => `/backend/hr/documents/${id}/edit`

/**
 * The document's own surface, and the only place a file can be attached.
 *
 * The platform's attachment field needs a stored record id, so the create form cannot
 * carry the upload; it happens here, after the register row exists. The attachments are
 * assigned to `hr_management:hr_employee_document` and survive the row being edited.
 */
export default function EmployeeDocumentDetail({ id }: { id: string }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const { labels: employeeLabels } = useEmployeeLabels()
  const query = useQuery({
    queryKey: ['hr-employee-document-detail', id, scopeVersion],
    queryFn: () => fetchCrudList<EmployeeDocumentRow>(RESOURCE, { ids: id, pageSize: 1 }),
  })
  const document = query.data?.items?.[0] ?? null

  if (query.isLoading) {
    return <LoadingMessage label={t('hr_management.documents.detail.loading', 'Loading document…')} />
  }
  if (query.isError) {
    return <ErrorMessage label={t('hr_management.documents.form.error.load', 'Could not load the document.')} />
  }
  if (!document) {
    return (
      <RecordNotFoundState
        label={t('hr_management.documents.form.error.notFound', 'Document not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.documents.actions.back', 'Back to documents')}
      />
    )
  }

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: t('hr_management.documents.columns.employee', 'Employee'),
      value: document.employee_id ? (employeeLabels.get(document.employee_id) ?? '—') : '—',
    },
    {
      label: t('hr_management.documents.columns.type', 'Document'),
      value: t(`hr_management.documents.types.${document.document_type}`, DOCUMENT_TYPE_FALLBACKS[document.document_type]),
    },
    {
      label: t('hr_management.documents.columns.number', 'Number'),
      value: document.document_number ? <span className="font-mono text-xs">{document.document_number}</span> : '—',
    },
    {
      label: t('hr_management.documents.columns.issued', 'Issued'),
      value: formatDate(document.issue_date ?? null, locale) ?? '—',
    },
    {
      label: t('hr_management.documents.columns.expires', 'Expires'),
      value: <ExpiryCell value={document.expiry_date ?? null} />,
    },
    {
      label: t('hr_management.documents.detail.notes', 'Notes'),
      value: document.notes?.trim() ? document.notes : '—',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-sm text-muted-foreground underline" href={LIST_HREF}>
            {t('hr_management.documents.actions.back', 'Back to documents')}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">
            {t('hr_management.documents.detail.title', 'Employee document')}
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href={editHref(id)}>{t('hr_management.documents.actions.edit', 'Edit')}</Link>
        </Button>
      </div>

      <dl className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1">
            <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
            <dd className="text-sm">{row.value}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-base font-semibold">{t('hr_management.documents.detail.attachments', 'Attachments')}</h2>
        <AttachmentInput
          entityId="hr_management:hr_employee_document"
          recordId={document.id}
          allowDelete
          allowReplace
        />
      </section>
    </div>
  )
}
