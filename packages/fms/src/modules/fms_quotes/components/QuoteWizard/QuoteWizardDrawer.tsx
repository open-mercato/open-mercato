'use client'

import * as React from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@open-mercato/ui/primitives/sheet'
import { Button } from '@open-mercato/ui/primitives/button'
import { X } from 'lucide-react'
import { QuoteWizardContent } from './QuoteWizardContent'

type QuoteWizardDrawerProps = {
  quoteId: string | null
  open: boolean
  onClose: () => void
}

export function QuoteWizardDrawer({ quoteId, open, onClose }: QuoteWizardDrawerProps) {
  if (!quoteId) return null

  return (
    <Sheet open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-full sm:max-w-full p-0 flex flex-col"
        onInteractOutside={(e: Event) => e.preventDefault()}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Quote Wizard</SheetTitle>
        </SheetHeader>
        <QuoteWizardContent quoteId={quoteId} onClose={onClose} />
      </SheetContent>
    </Sheet>
  )
}
