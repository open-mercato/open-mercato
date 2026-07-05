"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  walkGuide,
  type TroubleshootingNode,
} from '../../lib/troubleshooting'

export type TroubleshootingWalkerGuide = {
  title: string
  steps: TroubleshootingNode | null
}

export type TroubleshootingWalkerProps = {
  guide: TroubleshootingWalkerGuide | null
  onResolve?: (result: { resolution?: string; reasonCode?: string }) => void
  onTraversedPathChange?: (path: number[]) => void
}

export function TroubleshootingWalker({
  guide,
  onResolve,
  onTraversedPathChange,
}: TroubleshootingWalkerProps) {
  const t = useT()
  const root = guide?.steps ?? null
  const [path, setPath] = React.useState<number[]>([])
  const state = React.useMemo(() => walkGuide(root, path), [path, root])

  React.useEffect(() => {
    setPath([])
    onTraversedPathChange?.([])
  }, [guide?.title, onTraversedPathChange, root])

  const chooseOption = React.useCallback((optionIndex: number) => {
    const nextPath = [...path, optionIndex]
    const nextState = walkGuide(root, nextPath)
    setPath(nextPath)
    onTraversedPathChange?.(nextPath)
    if (nextState.terminal) onResolve?.(nextState.terminal)
  }, [onResolve, onTraversedPathChange, path, root])

  const reset = React.useCallback(() => {
    setPath([])
    onTraversedPathChange?.([])
  }, [onTraversedPathChange])

  if (!guide || !root) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          {t('warranty_claims.troubleshootingWalker.empty.title', 'No troubleshooting guide')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('warranty_claims.troubleshootingWalker.empty.description', 'No matching guided steps are configured for this claim.')}
        </p>
      </div>
    )
  }

  if (state.terminal) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{guide.title}</p>
          {state.terminal.resolution ? (
            <p className="text-sm text-foreground">{state.terminal.resolution}</p>
          ) : null}
          {state.terminal.reasonCode ? (
            <p className="text-xs text-muted-foreground">
              {t('warranty_claims.troubleshootingWalker.result.reasonCode', 'Reason code: {code}', { code: state.terminal.reasonCode })}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="outline" onClick={reset}>
          {t('warranty_claims.troubleshootingWalker.actions.restart', 'Restart')}
        </Button>
      </div>
    )
  }

  if (!state.node) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('warranty_claims.troubleshootingWalker.invalidPath', 'This troubleshooting path is no longer available.')}
        </p>
        <Button type="button" variant="outline" onClick={reset}>
          {t('warranty_claims.troubleshootingWalker.actions.restart', 'Restart')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{guide.title}</p>
        <p className="text-sm text-muted-foreground">{state.node.prompt}</p>
      </div>
      <div className="grid gap-2">
        {state.node.options.map((option, index) => (
          <Button
            key={`${index}-${option.label}`}
            type="button"
            variant="outline"
            className="justify-start text-left"
            onClick={() => chooseOption(index)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export default TroubleshootingWalker
