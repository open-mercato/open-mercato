import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import type { GeneratedDocumentDto } from '../services/generation-history-service'
import type { DocumentHistorySortField } from '../hooks/document-queries'

type Translate = (key: string, fallback?: string) => string

export const HISTORY_COLUMN_IDS = [
  'resource',
  'templateLabel',
  'generatedAt',
  'format',
  'generatedBy',
  'resourceKind',
  'resourceId',
  'templateId',
  'templateVersion',
  'id',
] as const

export type HistoryColumnId = (typeof HISTORY_COLUMN_IDS)[number]

export const SCOPED_HISTORY_COLUMNS: HistoryColumnId[] = ['templateLabel', 'format', 'generatedBy', 'generatedAt']

export const HISTORY_SORT_FIELD_BY_COLUMN: Partial<Record<HistoryColumnId, DocumentHistorySortField>> = {
  templateLabel: 'template_label',
  generatedAt: 'generated_at',
  format: 'format',
  generatedBy: 'generated_by',
}

export function historyColumnForSortField(field: DocumentHistorySortField | null): HistoryColumnId | null {
  const entry = Object.entries(HISTORY_SORT_FIELD_BY_COLUMN).find(([, value]) => value === field)
  return entry ? (entry[0] as HistoryColumnId) : null
}

export function buildHistoryColumns(t: Translate, visible?: readonly HistoryColumnId[]): ColumnDef<GeneratedDocumentDto>[] {
  const all: Record<HistoryColumnId, ColumnDef<GeneratedDocumentDto>> = {
    resource: {
      id: 'resource',
      accessorKey: 'resourceLabel',
      header: t('document_generators.history.resource'),
      enableSorting: false,
    },
    templateLabel: {
      id: 'templateLabel',
      accessorKey: 'templateLabel',
      header: t('document_generators.history.template'),
      enableSorting: true,
    },
    generatedAt: {
      id: 'generatedAt',
      accessorKey: 'generatedAt',
      header: t('document_generators.history.generatedAt'),
      enableSorting: true,
      cell: ({ row }) => formatDateTime(row.original.generatedAt) ?? '',
    },
    format: {
      id: 'format',
      accessorKey: 'format',
      header: t('document_generators.history.format'),
      enableSorting: true,
      cell: ({ row }) => row.original.format.toUpperCase(),
    },
    generatedBy: {
      id: 'generatedBy',
      accessorKey: 'generatedBy',
      header: t('document_generators.history.generatedBy'),
      enableSorting: true,
    },
    resourceKind: {
      id: 'resourceKind',
      accessorKey: 'resourceKind',
      header: t('document_generators.history.resourceKind'),
      enableSorting: false,
    },
    resourceId: {
      id: 'resourceId',
      accessorKey: 'resourceId',
      header: t('document_generators.history.resourceId'),
      enableSorting: false,
    },
    templateId: {
      id: 'templateId',
      accessorKey: 'templateId',
      header: t('document_generators.history.templateId'),
      enableSorting: false,
    },
    templateVersion: {
      id: 'templateVersion',
      accessorKey: 'templateVersion',
      header: t('document_generators.history.version'),
      enableSorting: false,
    },
    id: {
      id: 'id',
      accessorKey: 'id',
      header: t('document_generators.history.id'),
      enableSorting: false,
    },
  }
  const selected = visible ? HISTORY_COLUMN_IDS.filter((id) => visible.includes(id)) : HISTORY_COLUMN_IDS
  return selected.map((id) => all[id])
}
