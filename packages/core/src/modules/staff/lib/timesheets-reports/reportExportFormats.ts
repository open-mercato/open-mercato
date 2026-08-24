/**
 * EP-35 — the report export format registry.
 *
 * It lives beside `reportExport.ts` rather than inside it because the built-in
 * `pdf`/`csv`/`xlsx` serializers ARE that file: keeping the registry here lets
 * `reportExport.ts` register into it at module load without an import cycle.
 *
 * Every consumer of the format list — `normalizeReportExportFormat`, the export
 * route's OpenAPI query enum, the 400 body listing the accepted formats — reads
 * this registry, so a contributed format is accepted and documented without
 * touching either file.
 */

import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from '../time-tracking/registries/registry'
import type { ReportExportInput, SerializedReportExport } from './reportExport'

export const BUILT_IN_REPORT_EXPORT_FORMAT_IDS = ['pdf', 'csv', 'xlsx'] as const

export type BuiltInReportExportFormat = (typeof BUILT_IN_REPORT_EXPORT_FORMAT_IDS)[number]

/**
 * Widened from the original `'pdf' | 'csv' | 'xlsx'` union so a contributed id
 * is assignable. The union arm keeps the three built-ins as completions.
 */
export type ReportExportFormat = BuiltInReportExportFormat | (string & {})

export type ReportExportFormatDefinition = {
  id: string
  labelKey: string
  mimeType: string
  extension: string
  priority?: number
  serialize(input: ReportExportInput): SerializedReportExport
}

export const REPORT_EXPORT_FORMAT_REGISTRY_ID = extensionPoints.hosts.reportExportFormatRegistry.spotId

const registry = createStrategyRegistry<ReportExportFormatDefinition>(REPORT_EXPORT_FORMAT_REGISTRY_ID)

export function registerReportExportFormat(format: ReportExportFormatDefinition): () => void {
  return registry.register(format)
}

/**
 * The three formats the module ships. They register at the built-in priority so
 * `listReportExportFormats()` orders any contribution ahead of them.
 */
export function registerBuiltInReportExportFormat(
  format: Omit<ReportExportFormatDefinition, 'priority'>,
): () => void {
  return registry.register({ ...format, priority: BUILT_IN_STRATEGY_PRIORITY })
}

export function listReportExportFormats(): ReportExportFormatDefinition[] {
  return registry.list()
}

/** Built-ins first, in the order the module shipped them, then contributions. */
export function reportExportFormatIds(): string[] {
  const builtIn = BUILT_IN_REPORT_EXPORT_FORMAT_IDS.filter((id) => registry.has(id))
  const contributed = registry.ids().filter((id) => !builtIn.includes(id as BuiltInReportExportFormat))
  return [...builtIn, ...contributed]
}

export function getReportExportFormat(
  id: string | null | undefined,
): ReportExportFormatDefinition | null {
  return registry.get(id)
}
