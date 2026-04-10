"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Plus, Search } from 'lucide-react'

type ProjectOption = {
  id: string
  name: string
  code: string | null
}

type AddRowDropdownProps = {
  assignedProjects: ProjectOption[]
  visibleProjectIds: Set<string>
  canCreateProject: boolean
  onAddProject: (project: ProjectOption) => void
  onCreateProject: () => void
}

const DROPDOWN_WIDTH = 280
const DROPDOWN_OFFSET = 4

export function AddRowDropdown({
  assignedProjects,
  visibleProjectIds,
  canCreateProject,
  onAddProject,
  onCreateProject,
}: AddRowDropdownProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null)
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const availableProjects = assignedProjects.filter(
    (project) => !visibleProjectIds.has(project.id),
  )

  const filteredProjects = availableProjects.filter((project) =>
    project.name.toLowerCase().includes(search.toLowerCase()),
  )

  React.useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const node = triggerRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - DROPDOWN_WIDTH - 8))
      setPosition({ top: rect.bottom + DROPDOWN_OFFSET, left })
    }
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false)
        setSearch('')
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  React.useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [open])

  function handleToggle() {
    setOpen((prev) => !prev)
    setSearch('')
  }

  function handleSelectProject(project: ProjectOption) {
    onAddProject(project)
    setOpen(false)
    setSearch('')
  }

  function handleCreateProject() {
    onCreateProject()
    setOpen(false)
    setSearch('')
  }

  const dropdown = open && position && typeof document !== 'undefined' ? createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-50 rounded-lg border bg-popover shadow-lg"
      style={{ top: position.top, left: position.left, width: DROPDOWN_WIDTH }}
    >
      <div className="flex items-center border-b px-3">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          className="w-full px-3 py-2 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder={t('staff.timesheets.my.addRow.searchPlaceholder', 'Search by project')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="max-h-[200px] overflow-y-auto">
        {filteredProjects.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            {t('staff.timesheets.my.addRow.noProjects', 'No projects assigned')}
          </div>
        ) : (
          filteredProjects.map((project) => (
            <Button
              key={project.id}
              type="button"
              variant="ghost"
              className="w-full justify-start rounded-none px-3 py-2 text-sm cursor-pointer hover:bg-muted transition-colors"
              onClick={() => handleSelectProject(project)}
            >
              {project.name}
            </Button>
          ))
        )}
      </div>

      {canCreateProject && (
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start rounded-none px-3 py-2 text-sm text-primary cursor-pointer hover:bg-muted border-t"
          onClick={handleCreateProject}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t('staff.timesheets.my.addRow.createProject', 'Create a new project')}
        </Button>
      )}
    </div>,
    document.body,
  ) : null

  return (
    <>
      <div ref={triggerRef} className="inline-block">
        <Button
          type="button"
          variant="ghost"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer px-3 py-2"
          onClick={handleToggle}
        >
          <Plus className="h-4 w-4" />
          {t('staff.timesheets.my.addRow.trigger', 'Add row')}
        </Button>
      </div>
      {dropdown}
    </>
  )
}
