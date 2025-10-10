"use client"

import * as React from 'react'
import type { DashboardWidgetModule, DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'

type NotesSettings = {
  text: string
}

const DEFAULT_SETTINGS: NotesSettings = {
  text: '',
}

function normalizeSettings(raw: unknown): NotesSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const data = raw as Partial<NotesSettings>
  return {
    text: typeof data.text === 'string' ? data.text : '',
  }
}

const NotesWidget: React.FC<DashboardWidgetComponentProps<NotesSettings>> = ({ mode, settings, onSettingsChange }) => {
  const value = React.useMemo(() => normalizeSettings(settings), [settings])

  if (mode === 'settings') {
    return (
      <div className="space-y-1.5">
        <label htmlFor="dashboard-notes" className="text-xs font-medium uppercase text-muted-foreground">
          Notes
        </label>
        <textarea
          id="dashboard-notes"
          className="min-h-[160px] w-full resize-y rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          value={value.text}
          onChange={(event) => onSettingsChange({ text: event.target.value })}
          placeholder="Write quick notes you want to keep handy."
        />
      </div>
    )
  }

  if (!value.text.trim()) {
    return (
      <p className="text-sm text-muted-foreground">
        No notes yet. Switch to settings to add your text.
      </p>
    )
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-6">
      {value.text}
    </div>
  )
}

const widget: DashboardWidgetModule<NotesSettings> = {
  metadata: {
    id: 'example.dashboard.notes',
    title: 'Notes',
    description: 'Keep personal notes or reminders directly on the dashboard.',
    features: ['dashboards.view', 'example.widgets.notes'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: NotesWidget,
  hydrateSettings: normalizeSettings,
  dehydrateSettings: (value) => ({ text: value.text }),
}

export default widget
