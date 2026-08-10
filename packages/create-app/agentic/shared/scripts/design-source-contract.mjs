const DESIGN_SOURCE_TARGETS = Object.freeze({
  'design-system-gallery': /^node_modules\/@open-mercato\/core\/src\/modules\/design_system\/gallery\/entries\/[a-z0-9-]+\.tsx$/,
  'design-system-implementation': /^node_modules\/@open-mercato\/ui\/src\/(?:[a-z0-9_-]+\/)*[a-z0-9-]+\.tsx$/,
  'figma-code-connect': /^node_modules\/@open-mercato\/ui\/figma\/[a-z0-9-]+\.figma\.tsx$/,
  'design-foundation-token': /^src\/app\/globals\.css$/,
})

const GALLERY_PR_URL = 'https://github.com/open-mercato/open-mercato/pull/4301'
const GALLERY_PROVENANCE_HEAD_SHA = '186af58044c7530885a889c41f53bb36a5093d82'
const GALLERY_BASELINE_SHA = 'bf25803d7a8c85c8552db9e76c7cc4398d1768be'

export const DESIGN_SOURCE_ROLES = Object.freeze(Object.keys(DESIGN_SOURCE_TARGETS))

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectedRoleForTarget(resolvedPath) {
  return DESIGN_SOURCE_ROLES.find((role) => DESIGN_SOURCE_TARGETS[role].test(resolvedPath)) ?? null
}

function foundationEnvelopeErrors(role, resolvedPath, reference) {
  const errors = []
  const foundation = reference?.designFoundation
  if (!isPlainObject(reference) || !isPlainObject(foundation)) {
    return ['must carry a designFoundation object on every visual reference']
  }
  if (typeof reference.galleryItemId !== 'string' || reference.galleryItemId.length === 0) {
    errors.push('must carry a galleryItemId on every visual reference')
  }
  if (reference.baselinePrUrl !== GALLERY_PR_URL) {
    errors.push(`must carry gallery baselinePrUrl "${GALLERY_PR_URL}"`)
  }
  if (reference.provenanceHeadSha !== GALLERY_PROVENANCE_HEAD_SHA) {
    errors.push(`must carry gallery provenanceHeadSha "${GALLERY_PROVENANCE_HEAD_SHA}"`)
  }
  if (reference.baselineSha !== GALLERY_BASELINE_SHA) {
    errors.push(`must carry gallery baselineSha "${GALLERY_BASELINE_SHA}"`)
  }
  if (foundation.publicationStatus !== 'not-evidenced') {
    errors.push('must keep publicationStatus "not-evidenced"')
  }
  if (role === 'design-system-gallery' && reference.featureId !== 'design_system.view') {
    errors.push('must carry featureId "design_system.view"')
  }
  if (role === 'design-system-implementation') {
    if (typeof reference.importPath !== 'string' || !reference.importPath.startsWith('@open-mercato/ui/')) {
      errors.push('must carry an @open-mercato/ui public import')
    }
    if (foundation.packageName !== '@open-mercato/ui') {
      errors.push('must identify @open-mercato/ui as the implementation package')
    }
  }
  if (role === 'figma-code-connect') {
    if (foundation.codeConnectStatus !== 'mapped') errors.push('must carry codeConnectStatus "mapped"')
    if (foundation.codeConnectArtifactAvailability !== 'installed-packed-auxiliary') {
      errors.push('must carry codeConnectArtifactAvailability "installed-packed-auxiliary"')
    }
    if (foundation.codeConnectExportStatus !== 'not-exported') {
      errors.push('must carry codeConnectExportStatus "not-exported"')
    }
    if (foundation.codeConnectSourceReferenceId !== resolvedPath) {
      errors.push(`must carry codeConnectSourceReferenceId "${resolvedPath}"`)
    }
  }
  if (role === 'design-foundation-token') {
    if (foundation.tokenApplicability !== 'local-css') errors.push('must carry tokenApplicability "local-css"')
    if (foundation.snapshotAvailability !== 'unavailable') {
      errors.push('must carry snapshotAvailability "unavailable"')
    }
    if (foundation.codeConnectStatus !== 'not-applicable') {
      errors.push('must carry codeConnectStatus "not-applicable"')
    }
  }
  return errors
}

export function designSourceReferenceErrors(record, { requireEnvelope = false } = {}) {
  const resolvedPath = typeof record?.resolvedPath === 'string' ? record.resolvedPath : ''
  const role = typeof record?.referenceRole === 'string' ? record.referenceRole : null
  const expectedRole = expectedRoleForTarget(resolvedPath)
  const errors = []

  if (role !== null && !DESIGN_SOURCE_ROLES.includes(role)) {
    errors.push(`declares unknown design referenceRole "${role}"`)
    return errors
  }
  if (expectedRole !== null && role !== expectedRole) {
    errors.push(`must declare referenceRole "${expectedRole}" for target "${resolvedPath}"`)
    return errors
  }
  if (role !== null && !DESIGN_SOURCE_TARGETS[role].test(resolvedPath)) {
    errors.push(`declares referenceRole "${role}" for incompatible target "${resolvedPath}"`)
    return errors
  }
  if (role === null || !requireEnvelope) return errors

  if (!Array.isArray(record.visualReferences) || record.visualReferences.length === 0) {
    errors.push(`referenceRole "${role}" must carry a non-empty visualReferences envelope`)
    return errors
  }
  for (const [index, reference] of record.visualReferences.entries()) {
    for (const error of foundationEnvelopeErrors(role, resolvedPath, reference)) {
      errors.push(`visualReferences[${index}] ${error}`)
    }
  }
  return errors
}
