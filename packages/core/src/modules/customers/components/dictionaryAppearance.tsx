import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlarmClock,
  Award,
  Bell,
  Briefcase,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle,
  Circle,
  ClipboardList,
  Compass,
  Flag,
  Flame,
  Globe,
  Handshake,
  Heart,
  Lightbulb,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  Rocket,
  Send,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  ThumbsUp,
  Trophy,
  Users,
  Zap,
  Clock,
} from 'lucide-react'

const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  star: Star,
  flag: Flag,
  circle: Circle,
  sparkles: Sparkles,
  zap: Zap,
  flame: Flame,
  heart: Heart,
  target: Target,
  award: Award,
  trophy: Trophy,
  briefcase: Briefcase,
  rocket: Rocket,
  'shopping-bag': ShoppingBag,
  'thumbs-up': ThumbsUp,
  users: Users,
  lightbulb: Lightbulb,
  handshake: Handshake,
  compass: Compass,
  'check-circle': CheckCircle,
  shield: Shield,
  globe: Globe,
  calendar: Calendar,
  'calendar-check': CalendarCheck,
  'calendar-clock': CalendarClock,
  'calendar-days': CalendarDays,
  bell: Bell,
  'clipboard-list': ClipboardList,
  phone: Phone,
  'phone-call': PhoneCall,
  'message-square': MessageSquare,
  send: Send,
  mail: Mail,
  'alarm-clock': AlarmClock,
  clock: Clock,
}

export type CustomerDictionaryKind = 'statuses' | 'sources' | 'lifecycle-stages' | 'address-types'

export type CustomerDictionaryDisplayEntry = {
  value: string
  label: string
  color?: string | null
  icon?: string | null
}

export type CustomerDictionaryMap = Record<string, CustomerDictionaryDisplayEntry>

export const ICON_SUGGESTIONS: Array<{ value: string; label: string }> = [
  { value: 'lucide:star', label: 'Star' },
  { value: 'lucide:flag', label: 'Flag' },
  { value: 'lucide:circle', label: 'Circle' },
  { value: 'lucide:sparkles', label: 'Sparkles' },
  { value: 'lucide:zap', label: 'Lightning' },
  { value: 'lucide:flame', label: 'Flame' },
  { value: 'lucide:heart', label: 'Heart' },
  { value: 'lucide:target', label: 'Target' },
  { value: 'lucide:award', label: 'Award' },
  { value: 'lucide:trophy', label: 'Trophy' },
  { value: 'lucide:briefcase', label: 'Briefcase' },
  { value: 'lucide:rocket', label: 'Rocket' },
  { value: 'lucide:shopping-bag', label: 'Shopping bag' },
  { value: 'lucide:thumbs-up', label: 'Thumbs up' },
  { value: 'lucide:users', label: 'Users' },
  { value: 'lucide:lightbulb', label: 'Lightbulb' },
  { value: 'lucide:handshake', label: 'Handshake' },
  { value: 'lucide:compass', label: 'Compass' },
  { value: 'lucide:check-circle', label: 'Check circle' },
  { value: 'lucide:shield', label: 'Shield' },
  { value: 'lucide:globe', label: 'Globe' },
  { value: 'lucide:calendar', label: 'Calendar' },
  { value: 'lucide:calendar-check', label: 'Calendar check' },
  { value: 'lucide:calendar-clock', label: 'Calendar clock' },
  { value: 'lucide:calendar-days', label: 'Calendar days' },
  { value: 'lucide:clock', label: 'Clock' },
  { value: 'lucide:alarm-clock', label: 'Alarm clock' },
  { value: 'lucide:bell', label: 'Bell' },
  { value: 'lucide:message-square', label: 'Message' },
  { value: 'lucide:clipboard-list', label: 'Checklist' },
  { value: 'lucide:phone', label: 'Phone' },
  { value: 'lucide:phone-call', label: 'Phone call' },
  { value: 'lucide:send', label: 'Send' },
  { value: 'lucide:mail', label: 'Mail' },
  { value: '⭐️', label: 'Star emoji' },
  { value: '🔥', label: 'Fire emoji' },
  { value: '🚀', label: 'Rocket emoji' },
  { value: '🎯', label: 'Bullseye emoji' },
  { value: '💼', label: 'Briefcase emoji' },
  { value: '✅', label: 'Check emoji' },
  { value: '💡', label: 'Idea emoji' },
  { value: '🤝', label: 'Handshake emoji' },
  { value: '🌍', label: 'Globe emoji' },
  { value: '🗓️', label: 'Calendar emoji' },
  { value: '☎️', label: 'Telephone emoji' },
  { value: '💬', label: 'Speech bubble emoji' },
  { value: '🔔', label: 'Bell emoji' },
  { value: '⏰', label: 'Alarm clock emoji' },
]

export function extractLucideSlug(icon: string | null | undefined): string | null {
  if (!icon) return null
  if (!icon.startsWith('lucide:')) return null
  const slug = icon.slice('lucide:'.length)
  return slug.length ? slug : null
}

export function renderDictionaryIcon(icon: string | null | undefined, className = 'h-4 w-4'): React.ReactNode {
  if (!icon) return null
  const slug = extractLucideSlug(icon)
  if (slug) {
    const IconComponent = LUCIDE_ICON_MAP[slug]
    if (!IconComponent) return null
    return <IconComponent className={className} aria-hidden />
  }
  return <span className="text-base">{icon}</span>
}

export function renderDictionaryColor(color: string | null | undefined, className = 'h-4 w-4 rounded'): React.ReactNode {
  if (!color) return null
  return (
    <span
      className={`inline-flex border border-border ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}

export function normalizeCustomerDictionaryEntries(items: unknown): CustomerDictionaryDisplayEntry[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item: any) => {
      const rawValue = typeof item?.value === 'string' ? item.value.trim() : ''
      if (!rawValue) return null
      const label = typeof item?.label === 'string' && item.label.trim().length ? item.label.trim() : rawValue
      const color =
        typeof item?.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(item.color)
          ? `#${item.color.slice(1).toLowerCase()}`
          : null
      const icon = typeof item?.icon === 'string' && item.icon.trim().length ? item.icon.trim() : null
      return { value: rawValue, label, color, icon }
    })
    .filter((entry): entry is CustomerDictionaryDisplayEntry => !!entry)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

export function createDictionaryMap(entries: CustomerDictionaryDisplayEntry[]): CustomerDictionaryMap {
  return entries.reduce<CustomerDictionaryMap>((acc, entry) => {
    acc[entry.value] = entry
    return acc
  }, {})
}

type DictionaryValueProps = {
  value: string | null | undefined
  map?: CustomerDictionaryMap | null
  fallback: React.ReactNode
  className?: string
  iconWrapperClassName?: string
  iconClassName?: string
  colorClassName?: string
}

export function DictionaryValue({
  value,
  map,
  fallback,
  className,
  iconWrapperClassName = 'inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card',
  iconClassName = 'h-4 w-4',
  colorClassName = 'h-3 w-3 rounded-full',
}: DictionaryValueProps): React.ReactNode {
  if (!value) return fallback
  const entry = map?.[value]
  if (!entry) {
    return <span className={className}>{value}</span>
  }
  const classes = ['inline-flex items-center gap-2', className].filter(Boolean).join(' ')
  return (
    <span className={classes}>
      {entry.icon ? (
        <span className={[iconWrapperClassName].filter(Boolean).join(' ')}>
          {renderDictionaryIcon(entry.icon, iconClassName)}
        </span>
      ) : null}
      <span>{entry.label}</span>
      {entry.color ? renderDictionaryColor(entry.color, colorClassName) : null}
    </span>
  )
}
