"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type OrganizationMenuNode = {
  id: string
  name: string
  depth: number
  selectable: boolean
  children: OrganizationMenuNode[]
}

type FlatOption = {
  value: string
  label: string
  selectable: boolean
  depth: number
}

type OrganizationSwitcherProps = {
  items: OrganizationMenuNode[]
  selectedId: string | null
  canManage: boolean
}

function flatten(nodes: OrganizationMenuNode[], acc: FlatOption[] = []): FlatOption[] {
  for (const node of nodes) {
    acc.push({ value: node.id, label: node.name, selectable: node.selectable, depth: node.depth })
    if (node.children.length) flatten(node.children, acc)
  }
  return acc
}

export default function OrganizationSwitcher({ items, selectedId, canManage }: OrganizationSwitcherProps) {
  const router = useRouter()
  const [value, setValue] = React.useState<string>(selectedId ?? '')
  const options = React.useMemo(() => flatten(items), [items])
  const hasOptions = options.length > 0

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value
    setValue(next)
    const maxAge = 60 * 60 * 24 * 30 // 30 days
    if (!next) {
      document.cookie = `om_selected_org=; path=/; max-age=0; samesite=lax`
    } else {
      document.cookie = `om_selected_org=${encodeURIComponent(next)}; path=/; max-age=${maxAge}; samesite=lax`
    }
    try { router.refresh() } catch {}
  }

  if (!hasOptions && !canManage) {
    return null
  }

  const renderedOptions = [{ value: '', label: 'All organizations', selectable: true, depth: 0 }, ...options]

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-xs text-muted-foreground" htmlFor="org-switcher">Organization</label>
      {hasOptions ? (
        <select
          id="org-switcher"
          className="h-9 rounded border px-2 text-sm"
          value={value}
          onChange={handleChange}
        >
          {renderedOptions.map((opt) => {
            const indent = opt.depth > 0 ? `${'\u00A0\u00A0'.repeat(opt.depth)}• ` : ''
            return (
              <option key={opt.value || 'all'} value={opt.value} disabled={!opt.selectable && opt.value !== ''}>
                {indent}{opt.label}
              </option>
            )
          })}
        </select>
      ) : (
        <span className="text-xs text-muted-foreground">No organizations</span>
      )}
      {canManage ? (
        <Link href="/backend/directory/organizations" className="text-xs text-muted-foreground hover:text-foreground">
          Manage
        </Link>
      ) : null}
    </div>
  )
}
