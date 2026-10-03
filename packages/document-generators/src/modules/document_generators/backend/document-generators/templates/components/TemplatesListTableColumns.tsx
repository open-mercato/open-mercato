import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { groupTemplatesByModule } from '../../../../utils/groupTemplatesByModule'

type Translate = (key: string, fallback?: string) => string

export function buildTemplateColumns(t: Translate): ColumnDef<TemplateMeta>[] {
  return [
    { accessorKey: 'id', header: t('document_generators.page.columns.id') },
    { accessorKey: 'label', header: t('document_generators.page.columns.label') },
    { accessorKey: 'resourceKind', header: t('document_generators.page.columns.resourceKind') },
    { accessorKey: 'documentType', header: t('document_generators.page.columns.documentType') },
    {
      accessorKey: 'format',
      header: t('document_generators.page.columns.format'),
      cell: ({ row }) => row.original.format.toUpperCase(),
    },
    { accessorKey: 'description', header: t('document_generators.page.columns.description') },
    {
      accessorKey: 'note',
      header: t('document_generators.page.columns.note'),
      cell: ({ row }) => row.original.note ?? '',
    },
  ]
}

export function groupTemplatesForCatalogue(templates: TemplateMeta[]): Array<[string, TemplateMeta[]]> {
  return Array.from(groupTemplatesByModule(templates).entries()).sort(([left], [right]) => left.localeCompare(right))
}
