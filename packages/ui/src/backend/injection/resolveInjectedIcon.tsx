import * as React from 'react'
import { resolveRegisteredLucideIconNode } from '../icons/lucideRegistry'

export function resolveInjectedIcon(icon?: string, className = 'size-4'): React.ReactNode | null {
  return resolveRegisteredLucideIconNode(icon, className)
}
