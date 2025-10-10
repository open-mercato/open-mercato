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
  const value = raw as Partial<NotesSettings>
  return {
    text: typeof value.text === 'string' ? value.text : '',
  }
}

const NotesWidgetView: React.FC<DashboardWidgetComponentProps<NotesSettings>> = ({ mode, settings, onSettingsChange }) => {
  const resolved = React.useMemo(() => normalizeSettings(settings), [settings])

  const handleTextChange = React.useCallback((value: string) => {
    onSettingsChange({ text: value })
  }, [onSettingsChange])

  if (mode === 'settings') {
    return (
      <div className="space-y-1.5">
        <label htmlFor="dashboardNotes" className="text-xs font-medium uppercase text-muted-foreground">
          Notes
        </label>
        <textarea
          id="dashboardNotes"
          value={resolved.text}
          onChange={(event) => handleTextChange(event.target.value)}
          className="min-h-[160px] w-full resize-y rounded-md border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Write down anything you want to remember."
        />
      </div>
    )
  }

  if (!resolved.text) {
    return <p className="text-sm text-muted-foreground">No notes yet. Switch to settings to add your own text.</p>
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-6">
      {resolved.text}
    </div>
  )
}

const widget: DashboardWidgetModule<NotesSettings> = {
  metadata: {
    id: 'dashboards.notes',
    title: 'Notes',
    description: 'Keep quick notes or reminders directly on your dashboard.',
    features: ['dashboards.view', 'dashboards.widgets.notes'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: NotesWidgetView,
  hydrateSettings: normalizeSettings,
  dehydrateSettings: (settings) => ({ text: settings.text ?? '' }),
}

export default widget
