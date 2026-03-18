"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

export default function TransactionCreateActionWidget({
}: InjectionWidgetComponentProps) {
  const t = useT()
  const router = useRouter()

  return (
    <Button type="button" onClick={() => router.push('/backend/payment-links/new')}>
      <Plus className="mr-2 h-4 w-4" />
      {t('payment_link_pages.create.title', 'Create Payment Link')}
    </Button>
  )
}
