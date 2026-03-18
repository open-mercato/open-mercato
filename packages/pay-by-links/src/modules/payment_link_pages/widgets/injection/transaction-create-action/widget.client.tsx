"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { CreatePaymentTransactionDialog } from '../../../components/CreatePaymentTransactionDialog'

export default function TransactionCreateActionWidget({
  context,
}: InjectionWidgetComponentProps) {
  const t = useT()
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const handleCreated = React.useCallback(async () => {
    if (typeof context?.refresh === 'function') {
      await context.refresh()
    }
  }, [context])

  return (
    <>
      <Button type="button" onClick={() => setDialogOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        {t('payment_gateways.create.title', 'Create new transaction')}
      </Button>
      <CreatePaymentTransactionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
    </>
  )
}
