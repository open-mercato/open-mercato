"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ImportTransportRecordsDialog, type ImportPreviewColumn } from './ImportTransportRecordsDialog'
import { buildDriverImportTemplateCsv, parseDriverImportRows } from '../lib/driverImport'

const ENTITY_ID = 'transport_operations:transport_driver'

function textColumn(key: string, label: string): ImportPreviewColumn {
  return { key, label, render: (payload) => String(payload[key] ?? '') }
}

export function ImportDriversDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const t = useT()
  return (
    <ImportTransportRecordsDialog
      open={open}
      onOpenChange={onOpenChange}
      onImported={onImported}
      title={t('transport_operations.drivers.import.title', 'Import drivers')}
      description={t(
        'transport_operations.drivers.import.description',
        'Upload a CSV or Excel sheet of drivers. Nothing is written until the validation preview is clean and you confirm the import.',
      )}
      entityLabel={t('transport_operations.drivers.import.entity', 'drivers')}
      apiPath="/api/transport_operations/drivers/import"
      contextId="transport_operations.drivers.import"
      entityId={ENTITY_ID}
      templateFileName="transport-drivers-template.csv"
      buildTemplateCsv={buildDriverImportTemplateCsv}
      parseRows={parseDriverImportRows}
      previewColumns={[
        textColumn('fullName', t('transport_operations.drivers.form.fields.fullName', 'Full name')),
        textColumn('nationalId', t('transport_operations.drivers.form.fields.nationalId', 'National id')),
        textColumn('licenseNumber', t('transport_operations.drivers.form.fields.licenseNumber', 'Licence number')),
        textColumn('licenseExpiry', t('transport_operations.drivers.form.fields.licenseExpiry', 'Licence expiry')),
        textColumn('status', t('transport_operations.drivers.form.fields.status', 'Status')),
      ]}
    />
  )
}
