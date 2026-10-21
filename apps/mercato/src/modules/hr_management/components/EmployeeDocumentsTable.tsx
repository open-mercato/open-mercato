"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useT, useLocale, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

// `import type` only: a value import of the entities module would pull MikroORM decorators into the
// browser bundle.
import type { EmployeeDocumentType } from '../data/entities'
import { ExpiryCell } from './ExpiryCell'
import { useEmployeeLabels } from './hrOptions'

const RESOURCE = 'hr_management/employee-documents'
const CREATE_HREF = '/backend/hr/documents/create'
const detailHref = (id: string) => `/backend/hr/documents/${id}`
const editHref = (id: string) => `/backend/hr/documents/${id}/edit`

// Mirrors EMPLOYEE_DOCUMENT_TYPES in data/entities.ts; a drift fails loudly because the API rejects an
// unknown document type rather than silently storing it.
export const DOCUMENT_TYPE_VALUES: EmployeeDocumentType[] = [
  'national_id',
  'iqama',
  'passport',
  'driving_license',
  'medical_certificate',
  'contract',
  'certificate',
  'other',
]

export const DOCUMENT_TYPE_FALLBACKS: Record<EmployeeDocumentType, string> = {
  national_id: 'National ID',
  iqama: 'Iqama',
  passport: 'Passport',
  driving_license: 'Driving licence',
  medical_certificate: 'Medical certificate',
  contract: 'Contract',
  certificate: 'Certificate',
  other: 'Other',
}

export type EmployeeDocumentRow = {
  id: string
  employee_id?: string | null
  document_type: EmployeeDocumentType
  document_number?: string | null
  issue_date?: string | null
  expiry_date?: string | null
  file_attachment_id?: string | null
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

/**
 * The employee document register.
 *
 * It is a register, not a previewer: the records are the compliance evidence an inspection asks for,
 * so the screen orders them by expiry and marks the two states that need action. Files are attached
 * from the record's detail surface (the platform's attachment field needs a stored record id), which
 * is why this list has no upload control and the Open action leads there.
 */
export default function EmployeeDocumentsTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'expiryDate', desc: false }])
  const [page, setPage] = React.useState(1)

  const { labels: employeeLabels, employees } = useEmployeeLabels()
  const documentTypeFilter = typeof values.documentType === 'string' ? values.documentType : undefined
  const expiryFilter = typeof values.expiry === 'string' ? values.expiry : undefined
  const employeeFilter = typeof values.employeeId === 'string' ? values.employeeId : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'expiryDate',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    if (documentTypeFilter) out.documentType = documentTypeFilter
    if (expiryFilter) out.expiry = expiryFilter
    if (employeeFilter) out.employeeId = employeeFilter
    return out
  }, [page, sorting, search, documentTypeFilter, expiryFilter, employeeFilter])

  const query = useQuery({
    queryKey: ['hr-employee-documents', params, scopeVersion],
    queryFn: () => fetchCrudList<EmployeeDocumentRow>(RESOURCE, params),
  })

  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<EmployeeDocumentRow>[]>(() => [
    {
      id: 'employee',
      header: t('hr_management.documents.columns.employee', 'Employee'),
      cell: ({ row }) => {
        const employeeId = row.original.employee_id
        if (!employeeId) return <span className="text-xs text-muted-foreground">—</span>
        return <span className="text-sm font-medium">{employeeLabels.get(employeeId) ?? '—'}</span>
      },
      meta: { priority: 1 },
    },
    {
      accessorKey: 'document_type',
      header: t('hr_management.documents.columns.type', 'Document'),
      cell: ({ row }) => (
        <span className="text-sm">
          {t(`hr_management.documents.types.${row.original.document_type}`, DOCUMENT_TYPE_FALLBACKS[row.original.document_type])}
        </span>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'document_number',
      header: t('hr_management.documents.columns.number', 'Number'),
      cell: ({ getValue }) => {
        const value = getValue() as string | null
        return value && value.length > 0
          ? <span className="font-mono text-xs">{value}</span>
          : <span className="text-xs text-muted-foreground">—</span>
      },
      meta: { priority: 3 },
    },
    {
      accessorKey: 'issue_date',
      header: t('hr_management.documents.columns.issued', 'Issued'),
      cell: ({ getValue }) => <span className="text-sm">{formatDate(getValue() as string | null, locale) ?? '—'}</span>,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'expiry_date',
      header: t('hr_management.documents.columns.expires', 'Expires'),
      cell: ({ row }) => <ExpiryCell value={row.original.expiry_date} />,
      meta: { priority: 2 },
    },
  ], [t, locale, employeeLabels])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('hr_management.documents.error.load', 'Could not load employee documents.')}</div>
  }

  return (
    <DataTable
      title={t('hr_management.documents.page.title', 'Employee documents')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('hr_management.documents.actions.create', 'New document')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <span className="flex items-center gap-3">
          <Link className="text-sm font-medium underline" href={detailHref(row.id)}>
            {t('hr_management.documents.actions.open', 'Open')}
          </Link>
          <Link className="text-sm font-medium underline" href={editHref(row.id)}>
            {t('hr_management.documents.actions.edit', 'Edit')}
          </Link>
        </span>
      )}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('hr_management.documents.searchPlaceholder', 'Document number or type')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'documentType',
          label: t('hr_management.documents.filters.type', 'Document'),
          type: 'select',
          options: DOCUMENT_TYPE_VALUES.map((value) => ({
            value,
            label: t(`hr_management.documents.types.${value}`, DOCUMENT_TYPE_FALLBACKS[value]),
          })),
        },
        {
          id: 'expiry',
          label: t('hr_management.documents.filters.expiry', 'Expiry'),
          type: 'select',
          options: [
            { value: 'expired', label: t('hr_management.documents.filters.expired', 'Expired') },
            { value: 'within30', label: t('hr_management.documents.filters.within30', 'Expired or due within 30 days') },
          ],
        },
        {
          id: 'employeeId',
          label: t('hr_management.documents.filters.employee', 'Employee'),
          type: 'select',
          options: employees.map((employee) => ({
            value: employee.id,
            label: `${employee.first_name} ${employee.last_name}`.trim(),
          })),
        },
      ]}
      filterValues={values}
      onFiltersApply={(next: FilterValues) => {
        setValues(next)
        setPage(1)
      }}
      onFiltersClear={() => {
        setValues({})
        setPage(1)
      }}
      entityId="hr_management:hr_employee_document"
      sortable
      sorting={sorting}
      onSortingChange={(next) => {
        setSorting(next)
        setPage(1)
      }}
      pagination={{
        page,
        pageSize: 50,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 0,
        totalIsCapped: data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={query.isLoading}
    />
  )
}
