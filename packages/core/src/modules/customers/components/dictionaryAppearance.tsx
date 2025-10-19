import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlarmClock,
  AlertCircle,
  Archive,
  AtSign,
  Award,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  Bookmark,
  Brain,
  Briefcase,
  Building,
  Calculator,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Camera,
  ChartLine,
  ChartPie,
  Check,
  CheckCircle,
  CheckSquare,
  Circle,
  Clipboard,
  ClipboardList,
  Clock,
  Clock3,
  Cloud,
  Code2,
  Coins,
  Compass,
  Cpu,
  Database,
  DollarSign,
  Download,
  Edit,
  FileText,
  Filter,
  Flag,
  Flame,
  Folder,
  GitBranch,
  GitCommit,
  GitMerge,
  Glasses,
  Globe,
  Hammer,
  Handshake,
  Headphones,
  Heart,
  HelpCircle,
  Image,
  Inbox,
  Layers,
  LifeBuoy,
  Lightbulb,
  Link,
  Lock,
  Mail,
  MapPin,
  Megaphone,
  MessageSquare,
  Notebook,
  Package,
  Palette,
  Phone,
  PhoneCall,
  PieChart,
  Rocket,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sliders,
  Sparkles,
  Star,
  Tag,
  Target,
  ThumbsUp,
  TrendingUp,
  Trophy,
  Truck,
  UserCheck,
  Users,
  Wallet,
  Wand,
  Wrench,
  Zap,
} from 'lucide-react'

const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  activity: Activity,
  'alarm-clock': AlarmClock,
  'alert-circle': AlertCircle,
  archive: Archive,
  'at-sign': AtSign,
  award: Award,
  'badge-check': BadgeCheck,
  'bar-chart-3': BarChart3,
  bell: Bell,
  'book-open': BookOpen,
  bookmark: Bookmark,
  brain: Brain,
  briefcase: Briefcase,
  building: Building,
  calculator: Calculator,
  calendar: Calendar,
  'calendar-check': CalendarCheck,
  'calendar-clock': CalendarClock,
  'calendar-days': CalendarDays,
  camera: Camera,
  'chart-line': ChartLine,
  'chart-pie': ChartPie,
  check: Check,
  'check-circle': CheckCircle,
  'check-square': CheckSquare,
  circle: Circle,
  clipboard: Clipboard,
  'clipboard-list': ClipboardList,
  clock: Clock,
  'clock-3': Clock3,
  cloud: Cloud,
  'code-2': Code2,
  coins: Coins,
  compass: Compass,
  cpu: Cpu,
  database: Database,
  'dollar-sign': DollarSign,
  download: Download,
  edit: Edit,
  'file-text': FileText,
  filter: Filter,
  flag: Flag,
  flame: Flame,
  folder: Folder,
  'git-branch': GitBranch,
  'git-commit': GitCommit,
  'git-merge': GitMerge,
  glasses: Glasses,
  globe: Globe,
  hammer: Hammer,
  handshake: Handshake,
  headphones: Headphones,
  heart: Heart,
  'help-circle': HelpCircle,
  image: Image,
  inbox: Inbox,
  layers: Layers,
  'life-buoy': LifeBuoy,
  lightbulb: Lightbulb,
  link: Link,
  lock: Lock,
  mail: Mail,
  'map-pin': MapPin,
  megaphone: Megaphone,
  'message-square': MessageSquare,
  notebook: Notebook,
  package: Package,
  palette: Palette,
  phone: Phone,
  'phone-call': PhoneCall,
  'pie-chart': PieChart,
  rocket: Rocket,
  search: Search,
  send: Send,
  server: Server,
  settings: Settings,
  shield: Shield,
  'shopping-bag': ShoppingBag,
  'shopping-cart': ShoppingCart,
  sliders: Sliders,
  sparkles: Sparkles,
  star: Star,
  tag: Tag,
  target: Target,
  'thumbs-up': ThumbsUp,
  'trending-up': TrendingUp,
  trophy: Trophy,
  truck: Truck,
  'user-check': UserCheck,
  users: Users,
  wallet: Wallet,
  wand: Wand,
  wrench: Wrench,
  zap: Zap,
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
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const rawValue = typeof candidate.value === 'string' ? candidate.value.trim() : ''
      if (!rawValue) return null
      const label =
        typeof candidate.label === 'string' && candidate.label.trim().length ? candidate.label.trim() : rawValue
      const color =
        typeof candidate.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(candidate.color)
          ? `#${candidate.color.slice(1).toLowerCase()}`
          : null
      const icon = typeof candidate.icon === 'string' && candidate.icon.trim().length ? candidate.icon.trim() : null
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
