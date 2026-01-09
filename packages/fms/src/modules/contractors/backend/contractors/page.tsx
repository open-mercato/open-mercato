'use client'

import * as React from 'react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { ExternalLink, Trash2 } from 'lucide-react'
import {
  DynamicTable,
  TableSkeleton,
  TableEvents,
  dispatch,
  useEventHandlers,
} from '@open-mercato/ui/backend/dynamic-table'
import type {
  CellEditSaveEvent,
  NewRowSaveEvent,
  FilterRow,
  ColumnDef,
} from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { ContractorDrawer, type TabId } from '../../components/ContractorDrawer'
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog'

type ContractorRole = {
  id: string
  roleTypeId: string
  roleTypeName: string
  roleTypeCode: string
  roleTypeColor?: string | null
  roleTypeCategory: string
  isActive: boolean
}

type ContractorCreditLimit = {
  creditLimit: string
  currencyCode: string
  isUnlimited: boolean
}

type ContractorPaymentTerms = {
  paymentDays: number
  paymentMethod?: string | null
  currencyCode: string
}

type PrimaryAddress = {
  addressLine1: string
  city: string
  countryCode: string
}

type ContractorRow = {
  id: string
  name: string
  shortName?: string | null
  code?: string | null
  taxId?: string | null
  legalName?: string | null
  registrationNumber?: string | null
  isActive: boolean
  createdAt?: string
  roles?: ContractorRole[]
  creditLimit?: ContractorCreditLimit | null
  paymentTerms?: ContractorPaymentTerms | null
  primaryContactEmail?: string | null
  primaryAddress?: PrimaryAddress | null
}

type ContractorsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

function mapApiItem(item: Record<string, unknown>): ContractorRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    shortName: typeof item.shortName === 'string' ? item.shortName : null,
    code: typeof item.code === 'string' ? item.code : null,
    taxId: typeof item.taxId === 'string' ? item.taxId : null,
    legalName: typeof item.legalName === 'string' ? item.legalName : null,
    registrationNumber: typeof item.registrationNumber === 'string' ? item.registrationNumber : null,
    isActive: item.isActive === true,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    roles: Array.isArray(item.roles) ? item.roles as ContractorRole[] : [],
    creditLimit: item.creditLimit as ContractorCreditLimit | null ?? null,
    paymentTerms: item.paymentTerms as ContractorPaymentTerms | null ?? null,
    primaryContactEmail: typeof item.primaryContactEmail === 'string' ? item.primaryContactEmail : null,
    primaryAddress: item.primaryAddress as PrimaryAddress | null ?? null,
  }
}

// Global ref to store the contractor click handler
let onContractorClickHandler: ((contractorId: string, tab?: TabId, autoFocus?: boolean) => void) | null = null

export function setContractorClickHandler(handler: ((contractorId: string, tab?: TabId, autoFocus?: boolean) => void) | null) {
  onContractorClickHandler = handler
}

const CellWithDrawerAction = ({
  children,
  rowData,
  tab,
  autoFocus = false,
}: {
  children: React.ReactNode
  rowData: { id: string }
  tab?: TabId
  autoFocus?: boolean
}) => {
  // Check if this is an unsaved row (no valid ID)
  const isUnsavedRow = !rowData.id || rowData.id === ''

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isUnsavedRow) return
    if (onContractorClickHandler && rowData.id) {
      onContractorClickHandler(rowData.id, tab, true)
    }
  }

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isUnsavedRow) return
    if (onContractorClickHandler && rowData.id) {
      onContractorClickHandler(rowData.id, tab, autoFocus)
    }
  }

  // For unsaved rows, just render children without interactive elements
  if (isUnsavedRow) {
    return <span className="truncate">{children}</span>
  }

  return (
    <div
      className="group flex items-center justify-between gap-2 w-full h-full cursor-pointer"
      onDoubleClick={handleDoubleClick}
    >
      <span className="truncate">{children}</span>
      <button
        type="button"
        onClick={handleButtonClick}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-opacity flex-shrink-0"
        title="Open details"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// Global ref to store the contractor delete handler
let onContractorDeleteHandler: ((contractorId: string) => void) | null = null

export function setContractorDeleteHandler(handler: ((contractorId: string) => void) | null) {
  onContractorDeleteHandler = handler
}

const DeleteButton = ({ id }: { id: string }) => {
  if (!id) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (onContractorDeleteHandler && id) {
          onContractorDeleteHandler(id)
        }
      }}
      className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
      title="Delete contractor"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}

const ContractorNameRenderer = ({ value, rowData }: { value: string; rowData: { id: string } }) => {
  return (
    <CellWithDrawerAction rowData={rowData} tab="details">
      <span className="font-medium">{value || '-'}</span>
    </CellWithDrawerAction>
  )
}

const StatusBadgeRenderer = ({ value }: { value: boolean }) => {
  return (
    <Badge variant={value ? 'default' : 'secondary'}>
      {value ? 'Active' : 'Inactive'}
    </Badge>
  )
}

const RolesRenderer = ({ value, rowData }: { value?: ContractorRole[]; rowData: { id: string } }) => {
  if (!value || value.length === 0) {
    return (
      <CellWithDrawerAction rowData={rowData} tab="roles" autoFocus>
        <span className="text-gray-400">-</span>
      </CellWithDrawerAction>
    )
  }
  return (
    <CellWithDrawerAction rowData={rowData} tab="roles">
      <span className="flex flex-wrap gap-1">
        {value.filter(r => r.isActive).map((role) => (
          <Badge
            key={role.id}
            variant="outline"
            style={role.roleTypeColor ? { borderColor: role.roleTypeColor, color: role.roleTypeColor } : undefined}
          >
            {role.roleTypeName}
          </Badge>
        ))}
      </span>
    </CellWithDrawerAction>
  )
}

const CreditLimitRenderer = ({ value }: { value?: ContractorCreditLimit | null }) => {
  if (!value) return <span className="text-gray-400">-</span>
  if (value.isUnlimited) return <Badge variant="default">Unlimited</Badge>
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: value.currencyCode || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(parseFloat(value.creditLimit))
  return <span>{formatted}</span>
}

const PaymentTermsRenderer = ({ value }: { value?: ContractorPaymentTerms | null }) => {
  if (!value) return <span className="text-gray-400">-</span>
  const method = value.paymentMethod ? ` (${value.paymentMethod.replace('_', ' ')})` : ''
  return <span>{value.paymentDays} days{method}</span>
}

const PrimaryAddressRenderer = ({ value, rowData }: { value?: PrimaryAddress | null; rowData: { id: string } }) => {
  if (!value) {
    return (
      <CellWithDrawerAction rowData={rowData} tab="addresses" autoFocus>
        <span className="text-gray-400">-</span>
      </CellWithDrawerAction>
    )
  }
  return (
    <CellWithDrawerAction rowData={rowData} tab="addresses">
      {value.addressLine1}, {value.city}, {value.countryCode}
    </CellWithDrawerAction>
  )
}

const EmailRenderer = ({ value, rowData }: { value?: string | null; rowData: { id: string } }) => {
  if (!value) {
    return (
      <CellWithDrawerAction rowData={rowData} tab="contacts" autoFocus>
        <span className="text-gray-400">-</span>
      </CellWithDrawerAction>
    )
  }
  return (
    <CellWithDrawerAction rowData={rowData} tab="contacts">
      {value}
    </CellWithDrawerAction>
  )
}

// Static columns definition
const COLUMNS: ColumnDef[] = [
  {
    data: 'name',
    title: 'Name',
    type: 'text',
    width: 220,
    renderer: (value: string, rowData: { id: string }) => <ContractorNameRenderer value={value} rowData={rowData} />,
  },
  { data: 'code', title: 'Code', type: 'text', width: 100 },
  { data: 'taxId', title: 'Tax ID', type: 'text', width: 120 },
  {
    data: 'primaryContactEmail',
    title: 'Contact Email',
    type: 'text',
    width: 180,
    readOnly: true,
    renderer: (value: string | null, rowData: { id: string }) => <EmailRenderer value={value} rowData={rowData} />,
  },
  {
    data: 'primaryAddress',
    title: 'Address',
    type: 'text',
    width: 220,
    readOnly: true,
    renderer: (value: PrimaryAddress | null, rowData: { id: string }) => <PrimaryAddressRenderer value={value} rowData={rowData} />,
  },
  {
    data: 'roles',
    title: 'Roles',
    type: 'text',
    width: 150,
    readOnly: true,
    renderer: (value: ContractorRole[], rowData: { id: string }) => <RolesRenderer value={value} rowData={rowData} />,
  },
  {
    data: 'creditLimitValue',
    title: 'Credit Limit',
    type: 'numeric',
    width: 120,
    renderer: (value: string | number | null, rowData: ContractorRow) => <CreditLimitRenderer value={rowData.creditLimit} />,
  },
  {
    data: 'paymentDays',
    title: 'Payment Days',
    type: 'numeric',
    width: 120,
    renderer: (value: number | null, rowData: ContractorRow) => <PaymentTermsRenderer value={rowData.paymentTerms} />,
  },
  {
    data: 'isActive',
    title: 'Status',
    type: 'boolean',
    width: 100,
    renderer: (value: boolean) => <StatusBadgeRenderer value={value} />,
  },
]

export default function ContractorsPage() {
  const tableRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [selectedContractorId, setSelectedContractorId] = useState<string | null>(null)
  const [initialTab, setInitialTab] = useState<TabId>('details')
  const [autoFocusTab, setAutoFocusTab] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [sortField, setSortField] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [contractorToDelete, setContractorToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Register the contractor click handler for the renderer
  useEffect(() => {
    setContractorClickHandler((contractorId: string, tab?: TabId, autoFocus?: boolean) => {
      setSelectedContractorId(contractorId)
      setInitialTab(tab ?? 'details')
      setAutoFocusTab(autoFocus ?? false)
      setIsDrawerOpen(true)
    })
    return () => setContractorClickHandler(null)
  }, [])

  // Register the contractor delete handler for the renderer
  const openDeleteDialog = useCallback((contractorId: string) => {
    setContractorToDelete(contractorId)
    setDeleteDialogOpen(true)
  }, [])

  useEffect(() => {
    setContractorDeleteHandler(openDeleteDialog)
    return () => setContractorDeleteHandler(null)
  }, [openDeleteDialog])

  const handleDeleteConfirm = useCallback(async () => {
    if (!contractorToDelete) return
    setIsDeleting(true)
    try {
      const response = await apiCall(`/api/contractors/contractors/${contractorToDelete}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        flash('Contractor deleted', 'success')
        setDeleteDialogOpen(false)
        setContractorToDelete(null)
        queryClient.invalidateQueries({ queryKey: ['contractors'] })
      } else {
        const error = (response.result as { error?: string })?.error ?? 'Delete failed'
        flash(error, 'error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      flash(errorMessage, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [contractorToDelete, queryClient])

  const actionsRenderer = useCallback((rowData: { id: string }) => {
    if (!rowData?.id) return null
    return <DeleteButton id={rowData.id} />
  }, [])

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(limit))
    params.set('sortField', sortField)
    params.set('sortDir', sortDir)
    if (search) params.set('search', search)
    return params.toString()
  }, [page, limit, sortField, sortDir, search])

  const { data, isLoading } = useQuery({
    queryKey: ['contractors', queryParams, scopeVersion],
    queryFn: async () => {
      const call = await apiCall<ContractorsResponse>(`/api/contractors/contractors?${queryParams}`)
      if (!call.ok) throw new Error('Failed to load contractors')
      const payload = call.result ?? {}
      const items = Array.isArray(payload.items) ? payload.items : []
      return {
        items: items.map((item) => mapApiItem(item as Record<string, unknown>)).filter((row): row is ContractorRow => !!row),
        total: typeof payload.total === 'number' ? payload.total : items.length,
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
      }
    },
  })

  const tableData = useMemo(() => {
    return (data?.items ?? []).map((contractor) => ({
      id: contractor.id,
      name: contractor.name,
      code: contractor.code ?? '',
      taxId: contractor.taxId ?? '',
      primaryContactEmail: contractor.primaryContactEmail ?? null,
      primaryAddress: contractor.primaryAddress ?? null,
      roles: contractor.roles ?? [],
      creditLimit: contractor.creditLimit ?? null,
      creditLimitValue: contractor.creditLimit?.creditLimit ?? '',
      paymentTerms: contractor.paymentTerms ?? null,
      paymentDays: contractor.paymentTerms?.paymentDays ?? '',
      isActive: contractor.isActive,
    }))
  }, [data?.items])

  const handleContractorUpdated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['contractors'] })
  }, [queryClient])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        })

        try {
          let response: { ok: boolean; result?: { error?: string } | null }

          // Handle special financial fields
          if (payload.prop === 'creditLimitValue') {
            // Update credit limit via upsert API
            const creditLimitValue = payload.newValue === '' ? '0' : String(payload.newValue)
            response = await apiCall<{ error?: string }>('/api/contractors/credit-limits', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contractorId: payload.id,
                creditLimit: creditLimitValue,
              }),
            })
          } else if (payload.prop === 'paymentDays') {
            // Update payment terms via upsert API
            const paymentDays = payload.newValue === '' ? 30 : Number(payload.newValue)
            response = await apiCall<{ error?: string }>('/api/contractors/payment-terms', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contractorId: payload.id,
                paymentDays,
              }),
            })
          } else {
            // Regular contractor field update
            response = await apiCall<{ error?: string }>(`/api/contractors/contractors/${payload.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [payload.prop]: payload.newValue === '' ? null : payload.newValue }),
            })
          }

          if (response.ok) {
            flash('Contractor updated', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
            })
            queryClient.invalidateQueries({ queryKey: ['contractors'] })
          } else {
            const error = response.result?.error || 'Update failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
              error,
            })
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
            error: errorMessage,
          })
        }
      },

      [TableEvents.NEW_ROW_SAVE]: async (payload: NewRowSaveEvent) => {
        // Extract financial fields that need separate API calls
        const { creditLimitValue, paymentDays, creditLimit, paymentTerms, ...restRowData } = payload.rowData as Record<string, unknown>

        const filteredRowData = Object.fromEntries(
          Object.entries(restRowData).filter(([_, value]) => value !== '')
        )

        if (!filteredRowData.name) {
          flash('Name is required', 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            error: 'Name is required',
          })
          return
        }

        try {
          const response = await apiCall<{ id: string; error?: string }>('/api/contractors/contractors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filteredRowData),
          })

          if (response.ok && response.result) {
            const contractorId = response.result.id

            // Create credit limit if provided
            if (creditLimitValue && creditLimitValue !== '') {
              await apiCall('/api/contractors/credit-limits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contractorId,
                  creditLimit: String(creditLimitValue),
                }),
              })
            }

            // Create payment terms if provided
            if (paymentDays && paymentDays !== '') {
              await apiCall('/api/contractors/payment-terms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contractorId,
                  paymentDays: Number(paymentDays),
                }),
              })
            }

            flash('Contractor created', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              savedRowData: {
                ...payload.rowData,
                id: contractorId,
              },
            })
            queryClient.invalidateQueries({ queryKey: ['contractors'] })
          } else {
            const error = response.result?.error || 'Creation failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              error,
            })
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            error: errorMessage,
          })
        }
      },

      [TableEvents.COLUMN_SORT]: (payload: { columnName: string; direction: 'asc' | 'desc' | null }) => {
        setSortField(payload.columnName)
        setSortDir(payload.direction || 'asc')
        setPage(1)
      },

      [TableEvents.SEARCH]: (payload: { query: string }) => {
        setSearch(payload.query)
        setPage(1)
      },
    },
    tableRef as React.RefObject<HTMLElement>
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <TableSkeleton rows={10} columns={6} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Contractors</h1>
        </div>
        <DynamicTable
          tableRef={tableRef}
          data={tableData}
          columns={COLUMNS}
          tableName="Contractors"
          idColumnName="id"
          height={600}
          colHeaders={true}
          rowHeaders={true}
          actionsRenderer={actionsRenderer}
          uiConfig={{ hideAddRowButton: false }}
          pagination={{
            currentPage: page,
            totalPages: Math.ceil((data?.total || 0) / limit),
            limit,
            limitOptions: [25, 50, 100],
            onPageChange: setPage,
            onLimitChange: (l) => {
              setLimit(l)
              setPage(1)
            },
          }}
        />
        <ContractorDrawer
          contractorId={selectedContractorId}
          open={isDrawerOpen}
          onOpenChange={(open) => {
            setIsDrawerOpen(open)
            if (!open) setAutoFocusTab(false)
          }}
          onContractorUpdated={handleContractorUpdated}
          initialTab={initialTab}
          autoFocusFirstCell={autoFocusTab}
        />
        <ConfirmDeleteDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open)
            if (!open) setContractorToDelete(null)
          }}
          onConfirm={handleDeleteConfirm}
          isDeleting={isDeleting}
        />
      </PageBody>
    </Page>
  )
}
