"use client"

import * as React from 'react'
import { buildQueryString } from './api'
import { xrayRequest } from './hooks'

export type XrayLabelOption = { value: string; label: string }

const ROLES_API_PATH = '/api/auth/roles'
const TEAMS_API_PATH = '/api/staff/teams'
const ORGANIZATIONS_API_PATH = '/api/directory/organizations'
const OPTION_PAGE_SIZE = 100
const ORGANIZATION_IDS_MAX = 100

type NamedItem = { id?: unknown; name?: unknown }

function toOptions(body: unknown): XrayLabelOption[] {
  const items = typeof body === 'object' && body !== null && Array.isArray((body as { items?: unknown }).items)
    ? ((body as { items: unknown[] }).items)
    : []
  const options: XrayLabelOption[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const { id, name } = item as NamedItem
    if (typeof id !== 'string' || id.length === 0) continue
    options.push({ value: id.toLowerCase(), label: typeof name === 'string' && name.trim().length > 0 ? name : id })
  }
  return options
}

/**
 * Names of roles, teams and organizations for the breakdown and the actor filters, read from the
 * owning modules' list APIs as the viewer. Best effort: a module that is disabled or a list the
 * viewer may not read yields no options, and the UI falls back to shortened ids.
 */
async function loadOptions(url: string, signal?: AbortSignal): Promise<XrayLabelOption[]> {
  try {
    const result = await xrayRequest<unknown>(url, signal ? { signal } : undefined)
    return result.ok ? toOptions(result.body) : []
  } catch {
    return []
  }
}

export function loadRoleOptions(signal?: AbortSignal): Promise<XrayLabelOption[]> {
  return loadOptions(`${ROLES_API_PATH}${buildQueryString({ pageSize: OPTION_PAGE_SIZE })}`, signal)
}

export function loadTeamOptions(signal?: AbortSignal): Promise<XrayLabelOption[]> {
  return loadOptions(`${TEAMS_API_PATH}${buildQueryString({ pageSize: OPTION_PAGE_SIZE })}`, signal)
}

export function loadOrganizationOptions(ids: readonly string[], signal?: AbortSignal): Promise<XrayLabelOption[]> {
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0))).slice(0, ORGANIZATION_IDS_MAX)
  if (unique.length === 0) return Promise.resolve([])
  return loadOptions(`${ORGANIZATIONS_API_PATH}${buildQueryString({ view: 'options', ids: unique.join(',') })}`, signal)
}

export type XrayLabelKind = 'role' | 'team' | 'org'

/** A label map (lower-case id → name) of one dimension; `ids` is used for organizations only. */
export function useXrayLabels(kind: XrayLabelKind | null, ids: readonly string[] = []): Map<string, string> {
  const [labels, setLabels] = React.useState<Map<string, string>>(() => new Map())
  const idsKey = kind === 'org' ? Array.from(new Set(ids)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(',') : ''
  React.useEffect(() => {
    if (!kind) return
    const controller = new AbortController()
    const pending = kind === 'role'
      ? loadRoleOptions(controller.signal)
      : kind === 'team'
        ? loadTeamOptions(controller.signal)
        : loadOrganizationOptions(idsKey ? idsKey.split(',') : [], controller.signal)
    pending.then((options) => {
      if (controller.signal.aborted) return
      setLabels(new Map(options.map((option) => [option.value, option.label])))
    })
    return () => controller.abort()
  }, [kind, idsKey])
  return labels
}
