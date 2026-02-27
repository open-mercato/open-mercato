"use client"

import * as React from 'react'
import { Send } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { apiCall } from '../utils/apiCall'
import {
  MessageComposer,
  type MessageComposerContextObject,
  type MessageComposerProps,
  type MessageComposerRequiredActionConfig,
} from './MessageComposer'

export type SendObjectMessageDialogProps = {
  object: MessageComposerContextObject
  defaultValues?: MessageComposerProps['defaultValues']
  lockedType?: string | null
  requiredActionConfig?: MessageComposerRequiredActionConfig | null
  disabled?: boolean
  canCompose?: boolean
  onSuccess?: MessageComposerProps['onSuccess']
}

type FeatureCheckResponse = {
  granted?: string[]
}

let composeAccessCache: boolean | null = null
let composeAccessPromise: Promise<boolean> | null = null

async function readComposeAccess(): Promise<boolean> {
  if (composeAccessCache !== null) return composeAccessCache
  if (composeAccessPromise) return composeAccessPromise

  composeAccessPromise = (async () => {
    try {
      const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: ['messages.compose'] }),
      })
      const granted = Array.isArray(call.result?.granted) ? call.result.granted : []
      const canCompose = granted.includes('messages.compose')
      composeAccessCache = canCompose
      return canCompose
    } catch {
      composeAccessCache = false
      return false
    } finally {
      composeAccessPromise = null
    }
  })()

  return composeAccessPromise
}

export function SendObjectMessageDialog({
  object,
  defaultValues,
  lockedType = 'messages.defaultWithObjects',
  requiredActionConfig = null,
  disabled = false,
  canCompose,
  onSuccess,
}: SendObjectMessageDialogProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [composeEnabled, setComposeEnabled] = React.useState<boolean>(canCompose ?? false)
  const [composeAccessResolved, setComposeAccessResolved] = React.useState<boolean>(canCompose !== undefined)

  React.useEffect(() => {
    if (canCompose !== undefined) {
      setComposeEnabled(canCompose)
      setComposeAccessResolved(true)
      return
    }

    let mounted = true
    void (async () => {
      const allowed = await readComposeAccess()
      if (!mounted) return
      setComposeEnabled(allowed)
      setComposeAccessResolved(true)
    })()

    return () => {
      mounted = false
    }
  }, [canCompose])

  const openComposer = React.useCallback(() => {
    if (disabled || !composeEnabled) return
    setOpen(true)
  }, [disabled, composeEnabled])
  const contextObject = React.useMemo(() => ({
    entityModule: object.entityModule,
    entityType: object.entityType,
    entityId: object.entityId,
    sourceEntityType: object.sourceEntityType ?? null,
    sourceEntityId: object.sourceEntityId ?? null,
    previewData: object.previewData ?? null,
  }), [object.entityId, object.entityModule, object.entityType, object.sourceEntityId, object.sourceEntityType, object.previewData])

  if (!composeAccessResolved || !composeEnabled) {
    return null
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        onClick={openComposer}
        aria-label={t('messages.compose', 'Compose message')}
        title={t('messages.compose', 'Compose message')}
      >
        <Send className="h-4 w-4" />
      </Button>
      <MessageComposer
        variant="compose"
        open={open}
        onOpenChange={setOpen}
        lockedType={lockedType}
        contextObject={contextObject}
        requiredActionConfig={requiredActionConfig}
        defaultValues={defaultValues}
        onSuccess={onSuccess}
      />
    </>
  )
}
