import type { DictionaryEntryOption } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

export type CustomerRoleTypeSeed = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

export const DEFAULT_CUSTOMER_ROLE_TYPES: CustomerRoleTypeSeed[] = [
  { value: 'sales_owner', label: 'Sales Owner', color: '#2563eb', icon: 'lucide:briefcase' },
  { value: 'service_owner', label: 'Service Owner', color: '#16a34a', icon: 'lucide:headphones' },
  { value: 'account_manager', label: 'Account Manager', color: '#f59e0b', icon: 'lucide:user-check' },
]

export function createDefaultCustomerRoleTypeOptions(): DictionaryEntryOption[] {
  return DEFAULT_CUSTOMER_ROLE_TYPES.map((entry) => ({
    id: `default:${entry.value}`,
    value: entry.value,
    label: entry.label,
    color: entry.color,
    icon: entry.icon,
  }))
}
