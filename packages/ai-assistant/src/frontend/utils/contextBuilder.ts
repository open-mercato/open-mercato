import type { PageContext, SelectedEntity } from '../types'

export function buildSystemPrompt(
  context: PageContext | null,
  selectedEntities: SelectedEntity[] = []
): string {
  const parts: string[] = [
    'You are an AI assistant for Open Mercato, a B2B commerce and ERP platform.',
    '',
    'You help users manage customers, products, sales orders, and other business operations.',
    'You have access to tools that can create, update, delete, and search records in the system.',
    '',
  ]

  if (context) {
    parts.push('## Current Context')
    parts.push(`- Page: ${context.path}`)

    if (context.module) {
      parts.push(`- Module: ${humanizeModule(context.module)}`)
    }

    if (context.entityType) {
      parts.push(`- Entity Type: ${humanizeEntity(context.entityType)}`)
    }

    if (context.recordId) {
      parts.push(`- Record ID: ${context.recordId}`)
    }

    parts.push('')
  }

  if (selectedEntities.length > 0) {
    parts.push(`## Selected Items (${selectedEntities.length})`)
    for (const entity of selectedEntities.slice(0, 10)) {
      parts.push(`- ${entity.displayName} (${entity.entityType}: ${entity.recordId})`)
    }
    if (selectedEntities.length > 10) {
      parts.push(`- ... and ${selectedEntities.length - 10} more`)
    }
    parts.push('')
  }

  parts.push('## Guidelines')
  parts.push('- Be concise and helpful')
  parts.push('- When executing actions, confirm destructive operations before proceeding')
  parts.push('- Use the available tools to fulfill user requests')
  parts.push('- If a request is ambiguous, ask for clarification')
  parts.push('- Focus on the current context when relevant')

  return parts.join('\n')
}

function humanizeModule(module: string): string {
  const moduleNames: Record<string, string> = {
    customers: 'Customers (CRM)',
    catalog: 'Product Catalog',
    sales: 'Sales & Orders',
    booking: 'Booking & Scheduling',
    search: 'Search',
    auth: 'Authentication',
    dictionaries: 'Dictionaries',
    directory: 'Directory',
    currencies: 'Currencies',
    feature_toggles: 'Feature Toggles',
  }
  return moduleNames[module] || module.charAt(0).toUpperCase() + module.slice(1)
}

function humanizeEntity(entity: string): string {
  return entity
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
