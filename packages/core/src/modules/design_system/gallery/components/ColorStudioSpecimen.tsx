'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Check, FolderKanban, Plus, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { CircularProgress } from '@open-mercato/ui/primitives/progress'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

type Project = {
  id: string
  titleKey: string
  ownerKey: string
  status: 'confirmed' | 'pending' | 'error'
  progress: number
}

const PROJECTS: Project[] = [
  { id: 'design', titleKey: 'project.design', ownerKey: 'owner.you', status: 'confirmed', progress: 72 },
  { id: 'website', titleKey: 'project.website', ownerKey: 'owner.team', status: 'pending', progress: 38 },
  { id: 'mobile', titleKey: 'project.mobile', ownerKey: 'owner.review', status: 'error', progress: 16 },
]

const STATUS_VARIANTS = { confirmed: 'success', pending: 'warning', error: 'error' } as const

export function ColorStudioSpecimen({ theme, tokens, logo }: { logo?: string | null; theme: 'light' | 'dark'; tokens: Record<string, string> }) {
  const t = useT()
  const id = React.useId()
  const [view, setView] = React.useState('projects')
  const [search, setSearch] = React.useState('')
  const [projects, setProjects] = React.useState(PROJECTS)
  const [selectedId, setSelectedId] = React.useState('design')
  const [workspaceName, setWorkspaceName] = React.useState('')
  const [savedName, setSavedName] = React.useState('')
  const [notifications, setNotifications] = React.useState(true)
  const [savedNotifications, setSavedNotifications] = React.useState(true)
  const [feedback, setFeedback] = React.useState<'saved' | 'added' | null>(null)
  const selectedProject = projects.find(project => project.id === selectedId) ?? projects[0]
  const hasNewProject = projects.some(project => project.id === 'new')
  const visibleProjects = projects.filter(project => `${t(`design_system.colorStudio.${project.titleKey}`)} ${t(`design_system.colorStudio.${project.ownerKey}`)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const columns = React.useMemo<ColumnDef<Project, unknown>[]>(() => [
    {
      id: 'project',
      header: t('design_system.colorStudio.projectName'),
      meta: { truncate: false },
      cell: ({ row }) => <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-pressed={row.original.id === selectedId}
        onClick={() => setSelectedId(row.original.id)}
        className="h-auto w-full justify-start gap-3 whitespace-normal rounded-md px-0 py-1 text-left shadow-none"
        style={{ backgroundColor: 'transparent', color: tokens['--foreground'] }}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: row.original.id === selectedId ? tokens['--accent'] : tokens['--muted'], color: row.original.id === selectedId ? tokens['--accent-foreground'] : tokens['--muted-foreground'] }}>{row.original.id === selectedId ? <Check className="size-4" aria-hidden /> : <FolderKanban className="size-4" aria-hidden />}</span>
        <span className="min-w-0 space-y-1">
          <span className="block text-sm font-medium">{t(`design_system.colorStudio.${row.original.titleKey}`)}</span>
          <span className="block text-xs font-normal text-muted-foreground">{t(`design_system.colorStudio.${row.original.ownerKey}`)}</span>
        </span>
      </Button>,
    },
    {
      id: 'status',
      header: t('design_system.colorStudio.status'),
      meta: { truncate: false },
      cell: ({ row }) => <Badge variant={STATUS_VARIANTS[row.original.status]} dot>{t(`design_system.colorPreview.${row.original.status}`)}</Badge>,
    },
  ], [selectedId, t, tokens])

  function addProject() {
    if (hasNewProject) return
    setProjects(current => [...current, { id: 'new', titleKey: 'newProject', ownerKey: 'owner.you', status: 'pending', progress: 0 }])
    setSelectedId('new')
    setSearch('')
    setFeedback('added')
  }

  function saveSettings() {
    setSavedName(workspaceName)
    setSavedNotifications(notifications)
    setFeedback('saved')
  }

  return <section
    role="region"
    aria-label={`${t('design_system.colorStudio.preview')} — ${t(`design_system.colorPreview.${theme}`)}`}
    data-preview-theme={theme}
    style={tokens as React.CSSProperties}
    className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-foreground"
  >
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {logo ? <img src={logo} alt={t('design_system.styleAgents.logoPreview')} className="h-9 w-28 shrink-0 object-contain object-left" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><FolderKanban className="size-5" aria-hidden /></span>}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{savedName || t('design_system.colorStudio.workspace')}</p>
          <p className="text-xs text-muted-foreground">{t(`design_system.colorPreview.${theme}`)}</p>
        </div>
      </div>
      <SegmentedControl value={view} onValueChange={value => { setView(value); setFeedback(null) }} aria-label={t('design_system.colorStudio.overview')} size="sm">
        <SegmentedControlItem value="projects">{t('design_system.colorStudio.projects')}</SegmentedControlItem>
        <SegmentedControlItem value="settings">{t('design_system.colorStudio.settings')}</SegmentedControlItem>
      </SegmentedControl>
    </header>
    <div className="space-y-5 p-5 sm:p-6">
      {view === 'projects' ? <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight">{t('design_system.colorStudio.projects')}</h3>
          <Button type="button" size="sm" onClick={addProject} disabled={hasNewProject}><Plus aria-hidden />{t('design_system.colorStudio.newProject')}</Button>
        </div>
        <div className="grid items-start gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))' }}>
          <div className="min-w-0 space-y-4">
            <Input value={search} onChange={event => setSearch(event.target.value)} aria-label={t('design_system.colorStudio.search')} placeholder={t('design_system.colorStudio.search')} leading={<Search className="size-4" aria-hidden />} />
            <DataTable<Project> data={visibleProjects} columns={columns} embedded sortable={false} exporter={false} onRowClick={project => setSelectedId(project.id)} emptyState={<p className="text-sm text-muted-foreground">{t('design_system.colorStudio.noResults')}</p>} />
          </div>
          <aside className="space-y-6 rounded-xl border border-border bg-background p-6" aria-label={t('design_system.colorStudio.selected')}>
            <div className="space-y-3">
              <Badge variant={STATUS_VARIANTS[selectedProject.status]} dot>{t(`design_system.colorPreview.${selectedProject.status}`)}</Badge>
              <h4 className="text-xl font-medium tracking-tight">{t(`design_system.colorStudio.${selectedProject.titleKey}`)}</h4>
              <p className="text-xs text-muted-foreground">{t(`design_system.colorStudio.${selectedProject.ownerKey}`)}</p>
            </div>
            <div className="flex items-center gap-5 border-t border-border pt-5">
              <CircularProgress value={selectedProject.progress} size="lg" showValue aria-label={t('design_system.colorStudio.progress')} />
              <div className="min-w-0 space-y-2"><p className="text-sm font-medium">{t('design_system.colorStudio.progress')}</p><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.colorStudio.progressHint')}</p></div>
            </div>
          </aside>
        </div>
      </> : <form className="max-w-xl space-y-5" onSubmit={event => { event.preventDefault(); saveSettings() }}>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">{t('design_system.colorStudio.settings')}</h3>
          <p className="text-sm text-muted-foreground">{t('design_system.colorStudio.detailsHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-workspace`}>{t('design_system.colorPreview.name')}</Label>
          <Input id={`${id}-workspace`} value={workspaceName} placeholder={t('design_system.colorStudio.workspace')} onChange={event => { setWorkspaceName(event.target.value); setFeedback(null) }} />
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <Checkbox id={`${id}-notifications`} checked={notifications} onCheckedChange={checked => { setNotifications(checked === true); setFeedback(null) }} />
          <Label htmlFor={`${id}-notifications`} className="leading-5">{t('design_system.colorStudio.notifications')}</Label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t('design_system.colorPreview.save')}</Button>
          <Button type="button" variant="secondary" onClick={() => { setWorkspaceName(savedName); setNotifications(savedNotifications); setFeedback(null) }}>{t('design_system.colorPreview.cancel')}</Button>
        </div>
      </form>}
      <p role="status" className="text-xs text-status-success-text empty:hidden">{feedback ? t(feedback === 'saved' ? 'design_system.colorPreview.saved' : 'design_system.colorStudio.added') : null}</p>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-background px-6 py-4">
      <p className="text-xs font-medium text-muted-foreground">{t('design_system.colorStudio.states')}</p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" size="sm">{t('design_system.colorStudio.default')}</Button>
        <Button type="button" size="sm" style={{ backgroundColor: tokens['--primary-hover'], color: tokens['--primary-foreground'] }}>{t('design_system.colorStudio.hover')}</Button>
        <Button type="button" size="sm" style={{ boxShadow: `0 0 0 2px ${tokens['--background']}, 0 0 0 4px ${tokens['--focus-ring-outer']}` }}>{t('design_system.colorStudio.focus')}</Button>
        <Button type="button" size="sm" disabled>{t('design_system.colorStudio.disabled')}</Button>
      </div>

    </footer>
  </section>
}
