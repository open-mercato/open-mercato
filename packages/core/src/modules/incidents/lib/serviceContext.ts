import { incidentFind } from './read'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  IncidentImpact,
  IncidentServiceComponent,
  IncidentServiceDependency,
} from '../data/entities'

export type IncidentServiceContextScope = {
  organizationId: string
  tenantId: string
}

export type IncidentServiceContextComponent = {
  id: string
  key: string
  name: string
  description: string | null
  componentType: string
  ownerTeamId: string | null
  ownerUserId: string | null
  criticality: string
  tier: string | null
  sloTargetBasisPoints: number | null
  sourceType: string | null
  sourceId: string | null
  snapshot: Record<string, unknown> | null
  isActive: boolean
  impacted: boolean
  createdAt: string
  updatedAt: string
}

export type IncidentServiceContextDependency = {
  id: string
  sourceComponentId: string
  targetComponentId: string
  dependencyKind: string
  snapshot: Record<string, unknown> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type IncidentServiceContext = {
  incidentId: string
  impactedComponentIds: string[]
  freeformComponentLabels: string[]
  components: IncidentServiceContextComponent[]
  dependencies: IncidentServiceContextDependency[]
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

function serializeComponent(
  component: IncidentServiceComponent,
  impactedComponentIds: Set<string>,
): IncidentServiceContextComponent {
  return {
    id: component.id,
    key: component.key,
    name: component.name,
    description: component.description ?? null,
    componentType: component.componentType,
    ownerTeamId: component.ownerTeamId ?? null,
    ownerUserId: component.ownerUserId ?? null,
    criticality: component.criticality,
    tier: component.tier ?? null,
    sloTargetBasisPoints: component.sloTargetBasisPoints ?? null,
    sourceType: component.sourceType ?? null,
    sourceId: component.sourceId ?? null,
    snapshot: component.snapshot ?? null,
    isActive: component.isActive,
    impacted: impactedComponentIds.has(component.id),
    createdAt: component.createdAt.toISOString(),
    updatedAt: component.updatedAt.toISOString(),
  }
}

function serializeDependency(dependency: IncidentServiceDependency): IncidentServiceContextDependency {
  return {
    id: dependency.id,
    sourceComponentId: dependency.sourceComponentId,
    targetComponentId: dependency.targetComponentId,
    dependencyKind: dependency.dependencyKind,
    snapshot: dependency.snapshot ?? null,
    isActive: dependency.isActive,
    createdAt: dependency.createdAt.toISOString(),
    updatedAt: dependency.updatedAt.toISOString(),
  }
}

function sortByNameThenKey(left: IncidentServiceContextComponent, right: IncidentServiceContextComponent): number {
  return left.name.localeCompare(right.name) || left.key.localeCompare(right.key) || left.id.localeCompare(right.id)
}

function sortDependencies(left: IncidentServiceContextDependency, right: IncidentServiceContextDependency): number {
  return (
    left.sourceComponentId.localeCompare(right.sourceComponentId) ||
    left.targetComponentId.localeCompare(right.targetComponentId) ||
    left.dependencyKind.localeCompare(right.dependencyKind) ||
    left.id.localeCompare(right.id)
  )
}

export async function resolveIncidentServiceContext(
  em: EntityManager,
  scope: IncidentServiceContextScope,
  incidentId: string,
): Promise<IncidentServiceContext> {
  const impacts = await incidentFind(em, IncidentImpact, {
    incidentId,
    ...scope,
    deletedAt: null,
  })

  const impactedComponentIds = uniqueStrings(
    impacts
      .filter((impact) => impact.targetType === 'service_component')
      .map((impact) => impact.targetId ?? null),
  )
  const freeformComponentLabels = uniqueStrings(
    impacts
      .filter((impact) => impact.targetType === 'component')
      .map((impact) => impact.componentLabel?.trim() ?? null),
  ).sort((left, right) => left.localeCompare(right))

  if (impactedComponentIds.length === 0) {
    return {
      incidentId,
      impactedComponentIds,
      freeformComponentLabels,
      components: [],
      dependencies: [],
    }
  }

  const impactedComponents = await incidentFind(em,
    IncidentServiceComponent,
    {
      id: { $in: impactedComponentIds },
      ...scope,
      isActive: true,
      deletedAt: null,
    },
  )
  const activeImpactedComponentIds = impactedComponents.map((component) => component.id)
  const activeImpactedComponentIdSet = new Set(activeImpactedComponentIds)

  if (activeImpactedComponentIds.length === 0) {
    return {
      incidentId,
      impactedComponentIds: [],
      freeformComponentLabels,
      components: [],
      dependencies: [],
    }
  }

  const dependencies = await incidentFind(em,
    IncidentServiceDependency,
    {
      ...scope,
      isActive: true,
      deletedAt: null,
      $or: [
        { sourceComponentId: { $in: activeImpactedComponentIds } },
        { targetComponentId: { $in: activeImpactedComponentIds } },
      ],
    },
    { orderBy: { dependencyKind: 'asc' } },
  )

  const componentIds = uniqueStrings([
    ...activeImpactedComponentIds,
    ...dependencies.map((dependency) => dependency.sourceComponentId),
    ...dependencies.map((dependency) => dependency.targetComponentId),
  ])

  const components = await incidentFind(em,
    IncidentServiceComponent,
    {
      id: { $in: componentIds },
      ...scope,
      isActive: true,
      deletedAt: null,
    },
  )
  const activeComponentIds = new Set(components.map((component) => component.id))
  const activeDependencies = dependencies.filter((dependency) =>
    activeComponentIds.has(dependency.sourceComponentId) && activeComponentIds.has(dependency.targetComponentId),
  )

  return {
    incidentId,
    impactedComponentIds: activeImpactedComponentIds,
    freeformComponentLabels,
    components: components
      .map((component) => serializeComponent(component, activeImpactedComponentIdSet))
      .sort(sortByNameThenKey),
    dependencies: activeDependencies
      .map(serializeDependency)
      .sort(sortDependencies),
  }
}
