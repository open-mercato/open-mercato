"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ImportTransportRecordsDialog, type ImportPreviewColumn } from './ImportTransportRecordsDialog'
import { buildVehicleImportTemplateCsv, parseVehicleImportRows } from '../lib/vehicleImport'

const ENTITY_ID = 'transport_operations:transport_vehicle'

function textColumn(key: string, label: string): ImportPreviewColumn {
  return { key, label, render: (payload) => String(payload[key] ?? '') }
}

export function ImportVehiclesDialog({
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
      title={t('transport_operations.vehicles.import.title', 'Import vehicles')}
      description={t(
        'transport_operations.vehicles.import.description',
        'Upload a CSV or Excel sheet of vehicles. Nothing is written until the validation preview is clean and you confirm the import.',
      )}
      entityLabel={t('transport_operations.vehicles.import.entity', 'vehicles')}
      apiPath="/api/transport_operations/vehicles/import"
      contextId="transport_operations.vehicles.import"
      entityId={ENTITY_ID}
      templateFileName="transport-vehicles-template.csv"
      buildTemplateCsv={buildVehicleImportTemplateCsv}
      parseRows={parseVehicleImportRows}
      previewColumns={[
        textColumn('plateNumber', t('transport_operations.vehicles.form.fields.plate', 'Plate number')),
        textColumn('make', t('transport_operations.vehicles.form.fields.make', 'Make')),
        textColumn('model', t('transport_operations.vehicles.form.fields.model', 'Model')),
        textColumn('year', t('transport_operations.vehicles.form.fields.year', 'Year')),
        textColumn('status', t('transport_operations.vehicles.form.fields.status', 'Status')),
      ]}
    />
  )
}
