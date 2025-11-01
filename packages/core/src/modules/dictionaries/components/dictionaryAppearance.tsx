"use client"

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

export type DictionaryDisplayEntry = {
  value: string
  label: string
  color?: string | null
  icon?: string | null
}

export type DictionaryMap = Record<string, DictionaryDisplayEntry>

export type IconOption = {
  value: string
  label: string
  keywords?: string[]
}

export const ICON_SUGGESTIONS: IconOption[] = [
  { value: 'lucide:star', label: 'Star', keywords: ['favorite', 'rating'] },
  { value: 'lucide:flag', label: 'Flag', keywords: ['marker', 'priority'] },
  { value: 'lucide:circle', label: 'Circle', keywords: ['shape'] },
  { value: 'lucide:sparkles', label: 'Sparkles', keywords: ['new', 'shine'] },
  { value: 'lucide:zap', label: 'Lightning', keywords: ['zap', 'bolt'] },
  { value: 'lucide:flame', label: 'Flame', keywords: ['hot'] },
  { value: 'lucide:heart', label: 'Heart', keywords: ['love', 'favorite'] },
  { value: 'lucide:target', label: 'Target', keywords: ['bullseye', 'aim'] },
  { value: 'lucide:award', label: 'Award', keywords: ['badge', 'recognition'] },
  { value: 'lucide:trophy', label: 'Trophy', keywords: ['winner'] },
  { value: 'lucide:briefcase', label: 'Briefcase', keywords: ['business'] },
  { value: 'lucide:rocket', label: 'Rocket', keywords: ['launch', 'growth'] },
  { value: 'lucide:shopping-bag', label: 'Shopping bag', keywords: ['retail', 'store'] },
  { value: 'lucide:thumbs-up', label: 'Thumbs up', keywords: ['approve', 'like'] },
  { value: 'lucide:users', label: 'Users', keywords: ['people', 'team'] },
  { value: 'lucide:lightbulb', label: 'Lightbulb', keywords: ['idea', 'insight'] },
  { value: 'lucide:handshake', label: 'Handshake', keywords: ['agreement', 'deal'] },
  { value: 'lucide:compass', label: 'Compass', keywords: ['direction', 'navigation'] },
  { value: 'lucide:check-circle', label: 'Check circle', keywords: ['confirmed'] },
  { value: 'lucide:shield', label: 'Shield', keywords: ['security', 'protect'] },
  { value: 'lucide:globe', label: 'Globe', keywords: ['world', 'global'] },
  { value: 'lucide:calendar', label: 'Calendar', keywords: ['date', 'schedule'] },
  { value: 'lucide:calendar-check', label: 'Calendar check', keywords: ['confirmed', 'schedule'] },
  { value: 'lucide:calendar-clock', label: 'Calendar clock', keywords: ['time'] },
  { value: 'lucide:calendar-days', label: 'Calendar days', keywords: ['monthly'] },
  { value: 'lucide:clock', label: 'Clock', keywords: ['time', 'deadline'] },
  { value: 'lucide:alarm-clock', label: 'Alarm clock', keywords: ['reminder'] },
  { value: 'lucide:bell', label: 'Bell', keywords: ['notification'] },
  { value: 'lucide:message-square', label: 'Message', keywords: ['chat'] },
  { value: 'lucide:clipboard-list', label: 'Checklist', keywords: ['tasks'] },
  { value: 'lucide:phone', label: 'Phone', keywords: ['call'] },
  { value: 'lucide:phone-call', label: 'Phone call', keywords: ['outreach'] },
  { value: 'lucide:send', label: 'Send', keywords: ['message'] },
  { value: 'lucide:mail', label: 'Mail', keywords: ['email'] },
  { value: '⭐️', label: 'Star emoji', keywords: ['favorite', 'rating'] },
  { value: '🔥', label: 'Fire emoji', keywords: ['hot'] },
  { value: '🚀', label: 'Rocket emoji', keywords: ['launch'] },
  { value: '🎯', label: 'Bullseye emoji', keywords: ['target'] },
  { value: '💼', label: 'Briefcase emoji', keywords: ['business'] },
  { value: '✅', label: 'Check emoji', keywords: ['ok'] },
  { value: '💡', label: 'Idea emoji', keywords: ['lightbulb'] },
  { value: '🤝', label: 'Handshake emoji', keywords: ['deal'] },
  { value: '🌍', label: 'Globe emoji', keywords: ['world'] },
  { value: '🗓️', label: 'Calendar emoji', keywords: ['schedule'] },
  { value: '☎️', label: 'Telephone emoji', keywords: ['call'] },
  { value: '💬', label: 'Speech bubble emoji', keywords: ['chat'] },
  { value: '🔔', label: 'Bell emoji', keywords: ['notification'] },
  { value: '⏰', label: 'Alarm clock emoji', keywords: ['reminder'] },
]

const EXTRA_LUCIDE_ICON_LIBRARY: Array<{ slug: string; label: string; keywords?: string[] }> = [
  { slug: 'activity', label: 'Activity', keywords: ['metrics', 'pulse'] },
  { slug: 'alert-circle', label: 'Alert', keywords: ['warning', 'issue'] },
  { slug: 'archive', label: 'Archive', keywords: ['storage'] },
  { slug: 'at-sign', label: 'At sign', keywords: ['mention', 'email'] },
  { slug: 'badge-check', label: 'Badge check', keywords: ['verified', 'approval'] },
  { slug: 'bar-chart-3', label: 'Bar chart', keywords: ['analytics', 'report'] },
  { slug: 'book-open', label: 'Book open', keywords: ['docs', 'knowledge'] },
  { slug: 'bookmark', label: 'Bookmark', keywords: ['save'] },
  { slug: 'brain', label: 'Brain', keywords: ['intelligence', 'thinking'] },
  { slug: 'building', label: 'Building', keywords: ['office', 'hq'] },
  { slug: 'calculator', label: 'Calculator', keywords: ['finance', 'math'] },
  { slug: 'camera', label: 'Camera', keywords: ['photo', 'media'] },
  { slug: 'chart-line', label: 'Line chart', keywords: ['growth', 'analytics'] },
  { slug: 'chart-pie', label: 'Pie chart', keywords: ['distribution', 'analytics'] },
  { slug: 'check', label: 'Check', keywords: ['done'] },
  { slug: 'check-square', label: 'Check square', keywords: ['done'] },
  { slug: 'circle', label: 'Circle', keywords: ['shape'] },
  { slug: 'clipboard', label: 'Clipboard', keywords: ['tasks'] },
  { slug: 'clock-3', label: 'Clock three', keywords: ['time'] },
  { slug: 'cloud', label: 'Cloud', keywords: ['storage'] },
  { slug: 'code-2', label: 'Code', keywords: ['dev'] },
  { slug: 'coins', label: 'Coins', keywords: ['money'] },
  { slug: 'compass', label: 'Compass', keywords: ['direction'] },
  { slug: 'cpu', label: 'CPU', keywords: ['tech'] },
  { slug: 'database', label: 'Database', keywords: ['storage'] },
  { slug: 'dollar-sign', label: 'Dollar sign', keywords: ['money'] },
  { slug: 'download', label: 'Download', keywords: ['save'] },
  { slug: 'edit', label: 'Edit', keywords: ['pencil'] },
  { slug: 'file-text', label: 'File text', keywords: ['document'] },
  { slug: 'filter', label: 'Filter', keywords: ['refine'] },
  { slug: 'folder', label: 'Folder', keywords: ['files'] },
  { slug: 'git-branch', label: 'Git branch', keywords: ['git', 'source control'] },
  { slug: 'git-commit', label: 'Git commit', keywords: ['git'] },
  { slug: 'git-merge', label: 'Git merge', keywords: ['git'] },
  { slug: 'glasses', label: 'Glasses', keywords: ['review'] },
  { slug: 'life-buoy', label: 'Life buoy', keywords: ['support'] },
  { slug: 'link', label: 'Link', keywords: ['url'] },
  { slug: 'lock', label: 'Lock', keywords: ['security'] },
  { slug: 'map-pin', label: 'Map pin', keywords: ['location'] },
  { slug: 'megaphone', label: 'Megaphone', keywords: ['announcement'] },
  { slug: 'notebook', label: 'Notebook', keywords: ['notes'] },
  { slug: 'package', label: 'Package', keywords: ['shipment'] },
  { slug: 'palette', label: 'Palette', keywords: ['design'] },
  { slug: 'pie-chart', label: 'Pie chart', keywords: ['analytics'] },
  { slug: 'search', label: 'Search', keywords: ['lookup'] },
  { slug: 'server', label: 'Server', keywords: ['infrastructure'] },
  { slug: 'settings', label: 'Settings', keywords: ['configuration'] },
  { slug: 'shopping-cart', label: 'Shopping cart', keywords: ['orders'] },
  { slug: 'sliders', label: 'Sliders', keywords: ['settings'] },
  { slug: 'sparkles', label: 'Sparkles', keywords: ['new'] },
  { slug: 'star', label: 'Star', keywords: ['favorite'] },
  { slug: 'tag', label: 'Tag', keywords: ['label'] },
  { slug: 'trending-up', label: 'Trending up', keywords: ['growth'] },
  { slug: 'truck', label: 'Truck', keywords: ['logistics'] },
  { slug: 'user-check', label: 'User check', keywords: ['verified'] },
  { slug: 'wallet', label: 'Wallet', keywords: ['finance'] },
  { slug: 'wand', label: 'Wand', keywords: ['magic'] },
  { slug: 'wrench', label: 'Wrench', keywords: ['tools'] },
  { slug: 'zap', label: 'Zap', keywords: ['lightning'] },
]

const EXTRA_EMOJI_ICON_LIBRARY: IconOption[] = [
  { value: '😀', label: 'Grinning face', keywords: ['smile', 'happy'] },
  { value: '😃', label: 'Smiling face', keywords: ['smile', 'joy'] },
  { value: '😄', label: 'Grinning face with smiling eyes', keywords: ['smile', 'joy'] },
  { value: '😁', label: 'Beaming face', keywords: ['smile', 'excited'] },
  { value: '😆', label: 'Laughing face', keywords: ['laugh', 'haha'] },
  { value: '😎', label: 'Cool face', keywords: ['sunglasses', 'cool'] },
  { value: '🤔', label: 'Thinking face', keywords: ['ponder'] },
  { value: '🤗', label: 'Hugging face', keywords: ['care'] },
  { value: '🤨', label: 'Raised eyebrow', keywords: ['doubt'] },
  { value: '😴', label: 'Sleeping face', keywords: ['rest'] },
  { value: '😇', label: 'Smiling face with halo', keywords: ['angel'] },
  { value: '🙂', label: 'Slight smile', keywords: ['smile'] },
  { value: '🙃', label: 'Upside-down face', keywords: ['silly'] },
  { value: '🤑', label: 'Money-mouth face', keywords: ['profit'] },
  { value: '🤠', label: 'Cowboy face', keywords: ['fun'] },
  { value: '🥳', label: 'Party face', keywords: ['celebration'] },
  { value: '🤯', label: 'Mind blown', keywords: ['surprised'] },
  { value: '😤', label: 'Triumphant face', keywords: ['determined'] },
  { value: '😭', label: 'Crying face', keywords: ['sad'] },
  { value: '🙌', label: 'Raising hands', keywords: ['celebrate'] },
  { value: '👏', label: 'Clapping hands', keywords: ['applause'] },
  { value: '🙏', label: 'Folded hands', keywords: ['please', 'thanks'] },
  { value: '👍', label: 'Thumbs up', keywords: ['approve'] },
  { value: '👎', label: 'Thumbs down', keywords: ['disapprove'] },
  { value: '✌️', label: 'Victory hand', keywords: ['peace'] },
  { value: '🤝', label: 'Handshake emoji', keywords: ['deal'] },
  { value: '💪', label: 'Flexed biceps', keywords: ['strength'] },
  { value: '💼', label: 'Briefcase emoji', keywords: ['business'] },
  { value: '💰', label: 'Money bag', keywords: ['finance'] },
  { value: '💳', label: 'Credit card', keywords: ['payment'] },
  { value: '📈', label: 'Chart increasing', keywords: ['growth'] },
  { value: '📉', label: 'Chart decreasing', keywords: ['decline'] },
  { value: '📊', label: 'Bar chart', keywords: ['analytics'] },
  { value: '📋', label: 'Clipboard emoji', keywords: ['tasks'] },
  { value: '📌', label: 'Pushpin', keywords: ['pin'] },
  { value: '📍', label: 'Round pushpin', keywords: ['location'] },
  { value: '📎', label: 'Paperclip', keywords: ['attach'] },
  { value: '📁', label: 'File folder', keywords: ['files'] },
  { value: '📂', label: 'Open folder', keywords: ['files'] },
  { value: '🗂️', label: 'Card index dividers', keywords: ['organize'] },
  { value: '📝', label: 'Memo', keywords: ['note'] },
  { value: '📅', label: 'Calendar emoji', keywords: ['schedule'] },
  { value: '📆', label: 'Tear-off calendar', keywords: ['schedule'] },
  { value: '📞', label: 'Telephone receiver', keywords: ['phone'] },
  { value: '📠', label: 'Fax machine', keywords: ['fax'] },
  { value: '📧', label: 'Email emoji', keywords: ['mail'] },
  { value: '📨', label: 'Incoming envelope', keywords: ['mail'] },
  { value: '📮', label: 'Postbox', keywords: ['mail'] },
  { value: '💬', label: 'Speech bubble emoji', keywords: ['chat'] },
  { value: '🗨️', label: 'Left speech bubble', keywords: ['chat'] },
  { value: '💭', label: 'Thought balloon', keywords: ['thought'] },
  { value: '🕑', label: 'Clock face', keywords: ['time'] },
  { value: '🕒', label: 'Clock face three', keywords: ['time'] },
  { value: '🕓', label: 'Clock face four', keywords: ['time'] },
  { value: '🛎️', label: 'Service bell', keywords: ['notification'] },
  { value: '📣', label: 'Megaphone emoji', keywords: ['announcement'] },
  { value: '📢', label: 'Loudspeaker', keywords: ['announcement'] },
  { value: '🎁', label: 'Gift', keywords: ['reward'] },
  { value: '🎉', label: 'Party popper', keywords: ['celebration'] },
  { value: '🏆', label: 'Trophy emoji', keywords: ['winner'] },
  { value: '⚙️', label: 'Gear', keywords: ['settings'] },
  { value: '🔒', label: 'Lock emoji', keywords: ['secure'] },
  { value: '🔑', label: 'Key', keywords: ['access'] },
  { value: '📡', label: 'Satellite antenna', keywords: ['signal'] },
  { value: '📶', label: 'Signal strength', keywords: ['signal'] },
  { value: '🧭', label: 'Compass emoji', keywords: ['direction'] },
  { value: '🧠', label: 'Brain emoji', keywords: ['intelligence'] },
  { value: '🛠️', label: 'Hammer and wrench', keywords: ['tools'] },
  { value: '🧰', label: 'Toolbox', keywords: ['tools'] },
  { value: '💎', label: 'Gem stone', keywords: ['premium'] },
  { value: '🪙', label: 'Coin', keywords: ['money'] },
  { value: '🧾', label: 'Receipt', keywords: ['invoice'] },
  { value: '🛰️', label: 'Satellite', keywords: ['tech'] },
]

function mergeIconOptions(base: IconOption[], additions: IconOption[]): IconOption[] {
  const seen = new Set(base.map((option) => option.value))
  const merged = [...base]
  for (const option of additions) {
    if (seen.has(option.value)) continue
    merged.push(option)
    seen.add(option.value)
  }
  return merged
}

export const ICON_LIBRARY: IconOption[] = mergeIconOptions(
  ICON_SUGGESTIONS,
  [
    ...EXTRA_LUCIDE_ICON_LIBRARY.map(({ slug, ...rest }) => ({
      value: `lucide:${slug}`,
      ...rest,
    })),
    ...EXTRA_EMOJI_ICON_LIBRARY,
  ],
)

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

export function normalizeDictionaryEntries(items: unknown): DictionaryDisplayEntry[] {
  if (!Array.isArray(items)) return []
  const entries: DictionaryDisplayEntry[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const rawValue = typeof candidate.value === 'string' ? candidate.value.trim() : ''
    if (!rawValue) continue
    const label =
      typeof candidate.label === 'string' && candidate.label.trim().length ? candidate.label.trim() : rawValue
    const color =
      typeof candidate.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(candidate.color)
        ? `#${candidate.color.slice(1).toLowerCase()}`
        : null
    const icon = typeof candidate.icon === 'string' && candidate.icon.trim().length ? candidate.icon.trim() : null
    entries.push({ value: rawValue, label, color, icon })
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

export function createDictionaryMap(entries: DictionaryDisplayEntry[]): DictionaryMap {
  return entries.reduce<DictionaryMap>((acc, entry) => {
    acc[entry.value] = entry
    return acc
  }, {})
}

type DictionaryValueProps = {
  value: string | null | undefined
  map?: DictionaryMap | null
  fallback?: React.ReactNode
  className?: string
  iconWrapperClassName?: string
  iconClassName?: string
  colorClassName?: string
}

export function DictionaryValue({
  value,
  map,
  fallback = null,
  className,
  iconWrapperClassName = 'inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card',
  iconClassName = 'h-4 w-4',
  colorClassName = 'h-3 w-3 rounded-full',
}: DictionaryValueProps): React.ReactNode {
  if (!value) return fallback ?? null
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
