"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ArrowDown, ArrowLeftRight, ClipboardList, ShieldCheck, SlidersHorizontal, Upload } from 'lucide-react'
import { AdjustInventoryDialog } from './AdjustInventoryDialog'
import { CycleCountWizardDialog } from './CycleCountWizardDialog'
import { ImportInventoryDialog } from './ImportInventoryDialog'
import { MoveInventoryDialog } from './MoveInventoryDialog'
import { ReceiveInventoryDialog } from './ReceiveInventoryDialog'
import { ReserveInventoryDialog } from './ReserveInventoryDialog'
import type { WmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
      </div>
    </section>
  )
}

export function InventoryOperationsSection({
  access,
}: {
  access: WmsInventoryMutationAccess
}) {
  const t = useT()
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [receiveOpen, setReceiveOpen] = React.useState(false)
  const [reserveOpen, setReserveOpen] = React.useState(false)
  const [moveOpen, setMoveOpen] = React.useState(false)
  const [cycleOpen, setCycleOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  if (!access.scopeReady) return null
  if (
    !access.canAdjust &&
    !access.canReceive &&
    !access.canReserve &&
    !access.canMove &&
    !access.canCycleCount &&
    !access.canImport
  ) return null

  return (
    <>
      <SectionCard
        title={t('wms.backend.inventory.operations.title', 'Inventory operations')}
        description={t(
          'wms.backend.inventory.operations.description',
          'Receive inbound stock, reserve or move stock, post adjustments, or run a cycle count.',
        )}
      >
        {access.canImport ? (
          <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            {t('wms.backend.inventory.operations.import', 'Import CSV')}
          </Button>
        ) : null}
        {access.canAdjust ? (
          <Button type="button" variant="outline" onClick={() => setAdjustOpen(true)}>
            <SlidersHorizontal className="size-4" />
            {t('wms.backend.inventory.operations.adjust', 'Adjust inventory')}
          </Button>
        ) : null}
        {access.canCycleCount ? (
          <Button type="button" variant="outline" onClick={() => setCycleOpen(true)}>
            <ClipboardList className="size-4" />
            {t('wms.backend.inventory.operations.cycleCount', 'Cycle count')}
          </Button>
        ) : null}
        {access.canMove ? (
          <Button type="button" variant="outline" onClick={() => setMoveOpen(true)}>
            <ArrowLeftRight className="size-4" />
            {t('wms.backend.inventory.operations.move', 'Move stock')}
          </Button>
        ) : null}
        {access.canReserve ? (
          <Button type="button" variant="outline" onClick={() => setReserveOpen(true)}>
            <ShieldCheck className="size-4" />
            {t('wms.backend.inventory.operations.reserve', 'Reserve')}
          </Button>
        ) : null}
        {access.canReceive ? (
          <Button type="button" variant="default" onClick={() => setReceiveOpen(true)}>
            <ArrowDown className="size-4" />
            {t('wms.backend.inventory.operations.receive', 'Receive stock')}
          </Button>
        ) : null}
      </SectionCard>
      {access.canImport ? (
        <ImportInventoryDialog open={importOpen} onOpenChange={setImportOpen} access={access} />
      ) : null}
      {access.canAdjust ? (
        <AdjustInventoryDialog open={adjustOpen} onOpenChange={setAdjustOpen} access={access} />
      ) : null}
      {access.canReceive ? (
        <ReceiveInventoryDialog open={receiveOpen} onOpenChange={setReceiveOpen} access={access} />
      ) : null}
      {access.canReserve ? (
        <ReserveInventoryDialog open={reserveOpen} onOpenChange={setReserveOpen} access={access} />
      ) : null}
      {access.canMove ? (
        <MoveInventoryDialog open={moveOpen} onOpenChange={setMoveOpen} access={access} />
      ) : null}
      {access.canCycleCount ? (
        <CycleCountWizardDialog open={cycleOpen} onOpenChange={setCycleOpen} access={access} />
      ) : null}
    </>
  )
}
