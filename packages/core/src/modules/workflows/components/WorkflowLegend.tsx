'use client'

import { Check, Play, Pause, Circle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function WorkflowLegend() {
  const t = useT()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-3">
          {t('workflows.legend.statusTitle')}
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check className="w-3 h-3 text-emerald-600" />
            </div>
            <span className="text-xs text-muted-foreground">{t('workflows.legend.status.completed')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center">
              <Play className="w-3 h-3 text-blue-600" />
            </div>
            <span className="text-xs text-muted-foreground">{t('workflows.legend.status.inProgress')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-yellow-100 flex items-center justify-center">
              <Pause className="w-3 h-3 text-yellow-600" />
            </div>
            <span className="text-xs text-muted-foreground">{t('workflows.legend.status.pending')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-muted flex items-center justify-center">
              <Circle className="w-3 h-3 text-muted-foreground" />
            </div>
            <span className="text-xs text-muted-foreground">{t('workflows.legend.status.notStarted')}</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground mb-3">
          {t('workflows.legend.edgeStatesTitle')}
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-8 h-0.5 bg-emerald-500"></div>
            <span className="text-xs text-muted-foreground">{t('workflows.legend.edgeState.completed')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-8 h-0.5 bg-muted-foreground" style={{ backgroundImage: 'repeating-linear-gradient(to right, currentColor 0, currentColor 4px, transparent 4px, transparent 8px)' }}></div>
            <span className="text-xs text-muted-foreground">{t('workflows.legend.edgeState.pending')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
