"use client"

import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ViewMode = 'weekly' | 'monthly'
type ViewType = 'timesheet' | 'list'

interface ViewSwitcherProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  viewType: ViewType
  onViewTypeChange: (type: ViewType) => void
}

export function ViewSwitcher({ viewMode, onViewModeChange, viewType, onViewTypeChange }: ViewSwitcherProps) {
  const t = useT()

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1 rounded-md border p-1">
        <Button
          type="button"
          size="sm"
          variant={viewMode === 'weekly' ? 'default' : 'outline'}
          onClick={() => onViewModeChange('weekly')}
        >
          {t('staff.timesheets.my.viewMode.weekly', 'Weekly')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={viewMode === 'monthly' ? 'default' : 'outline'}
          onClick={() => onViewModeChange('monthly')}
        >
          {t('staff.timesheets.my.viewMode.monthly', 'Monthly')}
        </Button>
      </div>

      <div className="flex items-center gap-1 rounded-md border p-1">
        <Button
          type="button"
          size="sm"
          variant={viewType === 'timesheet' ? 'default' : 'outline'}
          onClick={() => onViewTypeChange('timesheet')}
        >
          {t('staff.timesheets.my.viewType.timesheet', 'Timesheet')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={viewType === 'list' ? 'default' : 'outline'}
          onClick={() => onViewTypeChange('list')}
        >
          {t('staff.timesheets.my.viewType.list', 'List view')}
        </Button>
      </div>
    </div>
  )
}
