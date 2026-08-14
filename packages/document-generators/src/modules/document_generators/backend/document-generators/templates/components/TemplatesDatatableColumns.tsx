import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'

type Translator = (key: string, fallback: string) => string

export function buildTemplatesDataTableColumns(t: Translator): ColumnDef<TemplateMeta>[] {
  return [
    {
      accessorKey: 'id',
      header: t('document_generators.page.columns.id', 'ID'),
      meta: { maxWidth: 220, truncate: true },
    },
    {
      accessorKey: 'label',
      header: t('document_generators.page.columns.label', 'Label'),
    },
    {
      accessorKey: 'resourceKind',
      header: t('document_generators.page.columns.resource', 'Resource'),
      meta: { maxWidth: 160 },
    },
    {
      accessorKey: 'documentType',
      header: t('document_generators.page.columns.documentType', 'Document type'),
      meta: { maxWidth: 140 },
    },
    {
      accessorKey: 'format',
      header: t('document_generators.page.columns.format', 'Format'),
      meta: { maxWidth: 100 },
    },
    {
      accessorKey: 'description',
      header: t('document_generators.page.columns.description', 'Description'),
      meta: { truncate: true },
    },
    {
      accessorKey: 'note',
      header: t('document_generators.page.columns.note', 'Note'),
      meta: { truncate: true },
    },
  ]
}
