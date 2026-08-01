import path from 'node:path'

export const KNOWLEDGE_CHANGE_CLASSES = Object.freeze(['knowledge-contract', 'asset-sync'])
export const KNOWLEDGE_CONTRACT_IDS = Object.freeze([
  'routing',
  'skill-link',
  'discovery',
  'context-read',
  'evaluator',
  'oracle',
])
export const CONTROLLER_OWNED_KNOWLEDGE_CHANGE_FIELDS = Object.freeze([
  'resolvedBaseSha',
  'headSha',
  'focusedExecutions',
])

const AUTHOR_OWNED_FIELDS = Object.freeze([
  'changeClass',
  'baseRef',
  'affectedCaseIds',
  'affectedRanges',
  'changedContracts',
  'focusedTestFiles',
  'authoritativeFiles',
  'generatedFiles',
  'expectedCatalogCount',
  'requiredReleaseLanes',
  'documentationFiles',
])
const HASH_PATTERN = /^[a-f0-9]{64}$/
const CASE_ID_PATTERN = /^OMH-[0-9]{3}$/
const RANGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const DERIVED_ITEM_KINDS = new Set(['generated', 'materialized'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSafeRelative(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || path.isAbsolute(value)) return false
  return !value.replaceAll('\\', '/').split('/').includes('..')
}

function isUniqueStringArray(value, predicate = () => true) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'string' && predicate(entry))
    && new Set(value).size === value.length
}

function validateFileRecords(value, label, includeSourcePath) {
  const errors = []
  if (!Array.isArray(value)) return [`${label} must be an array`]
  const paths = new Set()
  value.forEach((entry, index) => {
    const location = `${label}[${index}]`
    const expectedKeys = includeSourcePath ? ['path', 'sha256', 'sourcePath'] : ['path', 'sha256']
    if (!isPlainObject(entry) || Object.keys(entry).some((key) => !expectedKeys.includes(key))) {
      errors.push(`${location} has an invalid shape`)
      return
    }
    if (!isSafeRelative(entry.path)) errors.push(`${location}.path must be repository-relative`)
    else if (paths.has(entry.path)) errors.push(`${location}.path must be unique`)
    else paths.add(entry.path)
    if (!HASH_PATTERN.test(entry.sha256 ?? '')) errors.push(`${location}.sha256 must be a lowercase SHA-256 hash`)
    if (includeSourcePath && !isSafeRelative(entry.sourcePath)) errors.push(`${location}.sourcePath must be repository-relative`)
  })
  return errors
}

export function deriveKnowledgeChangeClass({ changedItems } = {}) {
  if (!Array.isArray(changedItems) || changedItems.length === 0) return 'knowledge-contract'
  const assetSync = changedItems.every((item) => {
    if (!isPlainObject(item) || !DERIVED_ITEM_KINDS.has(item.kind)) return false
    if (!isSafeRelative(item.path) || !isSafeRelative(item.sourcePath) || item.path === item.sourcePath) return false
    if (![item.baseSourceSha256, item.headSourceSha256, item.sha256, item.regeneratedSha256].every((hash) => HASH_PATTERN.test(hash ?? ''))) return false
    return item.baseSourceSha256 === item.headSourceSha256 && item.sha256 === item.regeneratedSha256
  })
  return assetSync ? 'asset-sync' : 'knowledge-contract'
}

export function validateAuthoredKnowledgeChangeManifest(manifest) {
  if (!isPlainObject(manifest)) return ['manifest must be an object']
  const errors = []
  const keys = Object.keys(manifest)
  for (const field of AUTHOR_OWNED_FIELDS) if (!Object.hasOwn(manifest, field)) errors.push(`${field} is required`)
  for (const field of keys) {
    if (CONTROLLER_OWNED_KNOWLEDGE_CHANGE_FIELDS.includes(field)) errors.push(`${field} is controller-owned and must be omitted`)
    else if (!AUTHOR_OWNED_FIELDS.includes(field)) errors.push(`${field} is not an allowed manifest field`)
  }
  if (!KNOWLEDGE_CHANGE_CLASSES.includes(manifest.changeClass)) errors.push('changeClass is invalid')
  if (typeof manifest.baseRef !== 'string' || !REF_PATTERN.test(manifest.baseRef)) errors.push('baseRef is invalid')
  if (!isUniqueStringArray(manifest.affectedCaseIds, (entry) => CASE_ID_PATTERN.test(entry))) errors.push('affectedCaseIds is invalid')
  if (!isUniqueStringArray(manifest.affectedRanges, (entry) => RANGE_ID_PATTERN.test(entry))) errors.push('affectedRanges is invalid')
  if (!isUniqueStringArray(manifest.changedContracts, (entry) => KNOWLEDGE_CONTRACT_IDS.includes(entry))) errors.push('changedContracts is invalid')
  for (const field of ['focusedTestFiles', 'documentationFiles']) {
    if (!isUniqueStringArray(manifest[field], isSafeRelative)) errors.push(`${field} is invalid`)
  }
  if (!isUniqueStringArray(manifest.requiredReleaseLanes, (entry) => RANGE_ID_PATTERN.test(entry))) errors.push('requiredReleaseLanes is invalid')
  if (!Number.isInteger(manifest.expectedCatalogCount) || manifest.expectedCatalogCount < 0) errors.push('expectedCatalogCount is invalid')
  errors.push(...validateFileRecords(manifest.authoritativeFiles, 'authoritativeFiles', false))
  errors.push(...validateFileRecords(manifest.generatedFiles, 'generatedFiles', true))
  return errors
}
