export const logisticsSections = [
  { id: 'transportJobs', href: '/backend/logistics/transport-jobs', titleKey: 'logistics.transportJobs.title', descriptionKey: 'logistics.transportJobs.description' },
  { id: 'fleet', href: '/backend/logistics/fleet', titleKey: 'logistics.fleet.title', descriptionKey: 'logistics.fleet.description' },
  { id: 'trips', href: '/backend/logistics/trips', titleKey: 'logistics.trips.title', descriptionKey: 'logistics.trips.description' },
  { id: 'map', href: '/backend/logistics/map', titleKey: 'logistics.map.title', descriptionKey: 'logistics.map.description' },
  { id: 'statistics', href: '/backend/logistics/statistics', titleKey: 'logistics.statistics.title', descriptionKey: 'logistics.statistics.description' },
  { id: 'proposalsDisruptions', href: '/backend/logistics/proposals-disruptions', titleKey: 'logistics.proposalsDisruptions.title', descriptionKey: 'logistics.proposalsDisruptions.description' },
] as const

export type LogisticsSectionId = 'dashboard' | typeof logisticsSections[number]['id']
