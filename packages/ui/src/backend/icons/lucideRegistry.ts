export {
  resolveRegisteredLucideIcon,
  resolveRegisteredLucideIconNode,
  LUCIDE_ICON_REGISTRY,
} from './lucideRegistry.generated'

import type { LucideIcon } from 'lucide-react'
import { LUCIDE_ICON_REGISTRY } from './lucideRegistry.generated'

export function registerAdditionalIcons(icons: Record<string, LucideIcon>): void {
  for (const [name, component] of Object.entries(icons)) {
    LUCIDE_ICON_REGISTRY[name] = component
  }
}
