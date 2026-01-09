import type { ContractorRoleCategory } from '../data/entities'

interface RoleTypeSeed {
  code: string
  name: string
  category: ContractorRoleCategory
  description: string
  color: string
  sortOrder: number
}

export const defaultRoleTypes: RoleTypeSeed[] = [
  // Trading Parties
  {
    code: 'client',
    name: 'Client',
    category: 'trading',
    description: 'Customer who requests services, Beneficial Cargo Owner (BCO)',
    color: '#3B82F6',
    sortOrder: 1,
  },
  {
    code: 'shipper',
    name: 'Shipper',
    category: 'trading',
    description: 'Party responsible for shipping goods (consignor/exporter)',
    color: '#3B82F6',
    sortOrder: 2,
  },
  {
    code: 'consignee',
    name: 'Consignee',
    category: 'trading',
    description: 'Party receiving goods (importer/buyer)',
    color: '#3B82F6',
    sortOrder: 3,
  },
  {
    code: 'notify_party',
    name: 'Notify Party',
    category: 'trading',
    description: 'Party to be notified on cargo arrival',
    color: '#3B82F6',
    sortOrder: 4,
  },
  {
    code: 'manufacturer',
    name: 'Manufacturer',
    category: 'trading',
    description: 'Product maker (required by customs)',
    color: '#3B82F6',
    sortOrder: 5,
  },

  // Carriers
  {
    code: 'shipping_line',
    name: 'Shipping Line',
    category: 'carrier',
    description: 'Ocean carrier, Vessel Operating Common Carrier (VOCC)',
    color: '#10B981',
    sortOrder: 1,
  },
  {
    code: 'airline',
    name: 'Airline',
    category: 'carrier',
    description: 'Air cargo carrier',
    color: '#10B981',
    sortOrder: 2,
  },
  {
    code: 'trucking_company',
    name: 'Trucking Company',
    category: 'carrier',
    description: 'Road haulage/transport provider',
    color: '#10B981',
    sortOrder: 3,
  },
  {
    code: 'rail_operator',
    name: 'Rail Operator',
    category: 'carrier',
    description: 'Rail freight operator',
    color: '#10B981',
    sortOrder: 4,
  },
  {
    code: 'nvocc',
    name: 'NVOCC',
    category: 'carrier',
    description: 'Non-Vessel Operating Common Carrier, issues own B/L',
    color: '#10B981',
    sortOrder: 5,
  },
  {
    code: 'carrier',
    name: 'Carrier',
    category: 'carrier',
    description: 'Generic/multimodal carrier',
    color: '#10B981',
    sortOrder: 6,
  },

  // Intermediaries
  {
    code: 'forwarder',
    name: 'Freight Forwarder',
    category: 'intermediary',
    description: 'Arranges and coordinates shipments',
    color: '#8B5CF6',
    sortOrder: 1,
  },
  {
    code: 'customs_broker',
    name: 'Customs Broker',
    category: 'intermediary',
    description: 'Handles customs clearance and documentation',
    color: '#8B5CF6',
    sortOrder: 2,
  },
  {
    code: 'agent',
    name: 'Agent',
    category: 'intermediary',
    description: 'General intermediary/representative',
    color: '#8B5CF6',
    sortOrder: 3,
  },
  {
    code: 'origin_agent',
    name: 'Origin Agent',
    category: 'intermediary',
    description: 'Agent at origin port/location',
    color: '#8B5CF6',
    sortOrder: 4,
  },
  {
    code: 'destination_agent',
    name: 'Destination Agent',
    category: 'intermediary',
    description: 'Agent at destination port/location',
    color: '#8B5CF6',
    sortOrder: 5,
  },
  {
    code: 'lsp',
    name: 'LSP',
    category: 'intermediary',
    description: 'Logistics Service Provider / 3PL',
    color: '#8B5CF6',
    sortOrder: 6,
  },
  {
    code: 'freight_broker',
    name: 'Freight Broker',
    category: 'intermediary',
    description: 'Connects shippers with carriers',
    color: '#8B5CF6',
    sortOrder: 7,
  },
  {
    code: 'coloader',
    name: 'Coloader',
    category: 'intermediary',
    description: 'Partner forwarder for co-loading/consolidation',
    color: '#8B5CF6',
    sortOrder: 8,
  },

  // Facility Operators
  {
    code: 'terminal',
    name: 'Terminal',
    category: 'facility',
    description: 'Port/airport terminal operator',
    color: '#F59E0B',
    sortOrder: 1,
  },
  {
    code: 'warehouse',
    name: 'Warehouse',
    category: 'facility',
    description: 'Storage facility operator',
    color: '#F59E0B',
    sortOrder: 2,
  },
  {
    code: 'container_depot',
    name: 'Container Depot',
    category: 'facility',
    description: 'Empty container storage/maintenance yard',
    color: '#F59E0B',
    sortOrder: 3,
  },
  {
    code: 'cfs',
    name: 'CFS',
    category: 'facility',
    description: 'Container Freight Station operator',
    color: '#F59E0B',
    sortOrder: 4,
  },
]
