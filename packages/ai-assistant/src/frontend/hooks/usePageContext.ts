'use client'

import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import type { PageContext } from '../types'

interface UsePageContextOptions {
  tenantId: string
  organizationId: string | null
}

function extractModule(pathParts: string[]): string | null {
  // Path structure: /backend/[module]/[entity]/[id]
  // or /backend/[module]/[entity]
  const backendIndex = pathParts.indexOf('backend')
  if (backendIndex === -1 || backendIndex >= pathParts.length - 1) {
    return null
  }
  return pathParts[backendIndex + 1] || null
}

function extractEntityType(pathParts: string[]): string | null {
  const backendIndex = pathParts.indexOf('backend')
  if (backendIndex === -1 || backendIndex >= pathParts.length - 2) {
    return null
  }
  return pathParts[backendIndex + 2] || null
}

function extractRecordId(pathParts: string[]): string | null {
  const backendIndex = pathParts.indexOf('backend')
  if (backendIndex === -1 || backendIndex >= pathParts.length - 3) {
    return null
  }
  const potentialId = pathParts[backendIndex + 3]
  // Check if it looks like a UUID or ID
  if (potentialId && /^[a-f0-9-]{36}$/i.test(potentialId)) {
    return potentialId
  }
  return null
}

export function usePageContext(options: UsePageContextOptions): PageContext {
  const pathname = usePathname()
  const { tenantId, organizationId } = options

  const pageContext = useMemo<PageContext>(() => {
    const parts = pathname.split('/').filter(Boolean)

    return {
      path: pathname,
      module: extractModule(parts),
      entityType: extractEntityType(parts),
      recordId: extractRecordId(parts),
      tenantId,
      organizationId,
    }
  }, [pathname, tenantId, organizationId])

  return pageContext
}
