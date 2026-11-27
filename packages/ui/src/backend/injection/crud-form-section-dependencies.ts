import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { loadConfiguredFormWidgetsForSpot } from '@open-mercato/shared/modules/widgets/injection-loader'
import type { CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import { extensionSpotChildId } from '@open-mercato/shared/modules/widgets/extension-points'
import type { CrudFormSectionRuntime } from './crud-form-section-runtime'

export async function checkCrudFormSectionDependencies<TValues, TPayload>({
  surface, descriptors, spots, grantedFeatures,
}: {
  surface: CrudFormSectionSurfaceAlternativeFact
  descriptors: readonly CrudFormSectionRuntime<TValues, TPayload>[]
  spots: readonly string[]
  grantedFeatures: readonly string[] | undefined
}): Promise<boolean> {
  const widgets = (await Promise.all(spots.flatMap((spot) => [
    loadConfiguredFormWidgetsForSpot(spot, 'render', spot),
    loadConfiguredFormWidgetsForSpot(extensionSpotChildId(spot, 'header'), 'render', spot),
    loadConfiguredFormWidgetsForSpot(extensionSpotChildId(spot, 'fields'), 'data', spot),
  ]))).flat()
  if (grantedFeatures === undefined && widgets.some(({ metadata }) => metadata.features?.length)) return false
  const activeWidgets = new Map(widgets.filter(({ metadata }) =>
    hasAllFeatures(grantedFeatures, metadata.features),
  ).map(({ metadata }) => [metadata.id, metadata]))
  const sections = new Set(surface.orderedSectionIds)
  const contracts = new Set(descriptors.flatMap(({ providedDataContractIds }) => providedDataContractIds ?? []))
  const availableFields = new Set(descriptors.flatMap(({ group, ownedFieldPaths }) => [
    ...(group.fields ?? []).map((field) => typeof field === 'string' ? field : field.id), ...ownedFieldPaths,
  ]))
  const actions = new Set(surface.mutationSurfaceIds)
  if (descriptors.some((descriptor) =>
    descriptor.requiredSectionIds?.some((id) => !sections.has(id))
      || descriptor.requiredDataContractIds?.some((id) => !contracts.has(id))
      || descriptor.mutationSurfaceIds?.some((id) => !actions.has(id)),
  )) return false
  if ([...activeWidgets.values()].some(({ requiredFields }) => requiredFields?.some((id) => !availableFields.has(id)))) {
    return false
  }
  const consumers = new Set([...surface.contributionIds, ...activeWidgets.keys(), ...descriptors.map(({ id }) => id)])
  return surface.dependencies.every(({ consumerContributionId, requiredSectionIds, requiredDataContractIds }) =>
    !consumers.has(consumerContributionId)
      || (requiredSectionIds.every((id) => sections.has(id)) && requiredDataContractIds.every((id) => contracts.has(id))))
}
