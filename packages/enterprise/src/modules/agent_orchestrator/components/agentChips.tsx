"use client"

import * as React from 'react'
import {
  Bot,
  Compass,
  Cpu,
  Eye,
  Filter,
  Globe,
  Headset,
  HeartPulse,
  Info,
  Layers,
  ListChecks,
  Lock,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  SquareCode,
  Stethoscope,
  Workflow,
  Zap,
} from 'lucide-react'
import { isAgentIconName, type AgentIconName } from '../data/agentIcons'

/**
 * Shared icon vocabulary for agent metadata chips — the agents list, agent
 * detail, and playground all render the same (icon, label) pairs so an agent
 * reads identically across cockpit surfaces.
 */
export const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  actionable: Zap,
  informative: Info,
}

export const RUNTIME_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  'in-process': Cpu,
  native: Cpu,
  opencode: SquareCode,
  external: Globe,
}

export const AUTONOMY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  auto: Bot,
  review: Eye,
  gated: Lock,
}

/**
 * Per-agent presentation icon vocabulary — the string names persisted in
 * `agent_settings.icon` (see `data/agentIcons.ts`) mapped to their lucide
 * component. Every name in `AGENT_ICON_NAMES` MUST have an entry here; the
 * `agentChips.test` guard enforces the two stay in sync.
 */
export const AGENT_ICON: Record<AgentIconName, React.ComponentType<{ className?: string }>> = {
  stethoscope: Stethoscope,
  'heart-pulse': HeartPulse,
  filter: Filter,
  layers: Layers,
  radar: Radar,
  compass: Compass,
  globe: Globe,
  search: Search,
  'list-checks': ListChecks,
  headset: Headset,
  bot: Bot,
  sparkles: Sparkles,
  'shield-check': ShieldCheck,
  workflow: Workflow,
}

/**
 * Resolve the glyph for an agent avatar. Prefers the tenant's configured icon;
 * otherwise falls back to the result-kind type glyph (actionable/informative)
 * so an unconfigured agent still reads as an icon rather than initials. Returns
 * `null` only when neither is known, letting the caller keep initials.
 */
export function resolveAgentIcon(
  icon: string | null | undefined,
  resultKind?: 'actionable' | 'informative' | null,
): React.ComponentType<{ className?: string }> | null {
  if (isAgentIconName(icon)) return AGENT_ICON[icon]
  if (resultKind && TYPE_ICON[resultKind]) return TYPE_ICON[resultKind]
  return null
}

/**
 * Rendered glyph for `<Avatar icon>`, or `undefined` when no icon resolves so
 * the Avatar falls back to auto-initials (a null-rendering element would leave
 * an empty circle — Avatar treats any truthy `icon` as present).
 */
export function agentAvatarIcon(
  icon: string | null | undefined,
  resultKind?: 'actionable' | 'informative' | null,
): React.ReactElement | undefined {
  const Icon = resolveAgentIcon(icon, resultKind)
  return Icon ? <Icon /> : undefined
}

export function Chip({ icon: Icon, children }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
      {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      {children}
    </span>
  )
}
