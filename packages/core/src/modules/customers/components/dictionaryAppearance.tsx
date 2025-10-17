import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Award,
  Briefcase,
  CheckCircle,
  Circle,
  Compass,
  Flag,
  Flame,
  Globe,
  Handshake,
  Heart,
  Lightbulb,
  Rocket,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  ThumbsUp,
  Trophy,
  Users,
  Zap,
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
}

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
  { value: '⭐️', label: 'Star emoji' },
  { value: '🔥', label: 'Fire emoji' },
  { value: '🚀', label: 'Rocket emoji' },
  { value: '🎯', label: 'Bullseye emoji' },
  { value: '💼', label: 'Briefcase emoji' },
  { value: '✅', label: 'Check emoji' },
  { value: '💡', label: 'Idea emoji' },
  { value: '🤝', label: 'Handshake emoji' },
  { value: '🌍', label: 'Globe emoji' },
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
