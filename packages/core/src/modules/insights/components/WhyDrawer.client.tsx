"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircleQuestion } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { buildExplainPageHref } from '../lib/client/explainApi'
import { WhyExplanation } from './WhyExplanation'

export type WhyDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceKind: string
  resourceId: string
  initialField?: string | null
  itemId?: string | null
  resourceLabelKey?: string | null
}

export function WhyDrawer({
  open,
  onOpenChange,
  resourceKind,
  resourceId,
  initialField = null,
  itemId = null,
  resourceLabelKey = null,
}: WhyDrawerProps) {
  const t = useT()
  const router = useRouter()
  const resourceKey = `${resourceKind}:${resourceId}`
  const [selection, setSelection] = React.useState<{ resourceKey: string; field: string | null }>({
    resourceKey,
    field: initialField,
  })
  const field = selection.resourceKey === resourceKey ? selection.field : initialField

  const setField = React.useCallback((next: string | null) => {
    setSelection({ resourceKey, field: next })
  }, [resourceKey])

  React.useEffect(() => {
    if (!open) setSelection({ resourceKey, field: initialField })
  }, [open, initialField, resourceKey])

  const pageHref = buildExplainPageHref({
    resourceKind,
    resourceId,
    field,
    itemId: field ? itemId : null,
  })

  const openPage = React.useCallback(() => {
    onOpenChange(false)
    router.push(pageHref)
  }, [onOpenChange, pageHref, router])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      openPage()
    }
  }, [openPage])

  const description = resourceLabelKey
    ? t('insights.why.drawer.descriptionFor', { resource: t(resourceLabelKey) })
    : t('insights.why.drawer.description')

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="max-w-2xl"
        closeAriaLabel={t('insights.why.close')}
        onKeyDown={handleKeyDown}
        data-testid="insights-why-drawer"
      >
        <DrawerHeader leading={<MessageCircleQuestion className="size-4" />}>
          <DrawerTitle>{t('insights.explain.title')}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="pb-4">
          {open ? (
            <WhyExplanation
              key={resourceKey}
              resourceKind={resourceKind}
              resourceId={resourceId}
              field={field}
              itemId={itemId}
              onSelectField={setField}
            />
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              {t('insights.why.close')}
            </Button>
          </DrawerClose>
          <Button asChild>
            <Link href={pageHref} onClick={() => onOpenChange(false)}>
              {t('insights.why.openPage')}
            </Link>
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default WhyDrawer
