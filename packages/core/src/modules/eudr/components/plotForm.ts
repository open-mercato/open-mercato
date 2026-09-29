import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { POINT_MAX_AREA_HA, validatePlotGeometry, type EudrPlotGeometryType } from '../lib/geometry'
import type { Translator } from './formConfig'

export type ParsedPlotGeometry = {
  geometry: unknown
  plotType: EudrPlotGeometryType
}

export function parsePlotGeometryForSubmit(raw: unknown, translate: Translator): ParsedPlotGeometry {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    const message = translate('eudr.errors.geometryRequired')
    throw createCrudFormError(message, { geometry: message })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const message = translate('eudr.errors.geometryInvalid')
    throw createCrudFormError(message, { geometry: message })
  }
  const validation = validatePlotGeometry(parsed)
  if (!validation.ok) {
    const message = translate(`eudr.errors.${validation.errorKey}`)
    throw createCrudFormError(message, { geometry: message })
  }
  return { geometry: parsed, plotType: validation.plotType }
}

export function isPolygonGeometry(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.trim().length === 0) return false
  try {
    const validation = validatePlotGeometry(JSON.parse(raw))
    return validation.ok && validation.plotType === 'polygon'
  } catch {
    return false
  }
}

export function parsePlotAreaInput(value: unknown, translate: Translator): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!text.length) return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    const message = translate('eudr.plots.form.areaHaInvalid')
    throw createCrudFormError(message, { areaHa: message })
  }
  return parsed
}

export function assertPointAreaWithinLimit(
  plotType: EudrPlotGeometryType,
  areaHa: number | null,
  translate: Translator,
): void {
  if (plotType !== 'point') return
  if (areaHa === null || areaHa <= 0) {
    const message = translate('eudr.errors.pointAreaRequired')
    throw createCrudFormError(message, { areaHa: message })
  }
  if (areaHa > POINT_MAX_AREA_HA) {
    const message = translate('eudr.errors.polygonRequired')
    throw createCrudFormError(message, { areaHa: message })
  }
}

export function pointAreaExceedsLimit(plotType: EudrPlotGeometryType, areaHa: unknown): boolean {
  if (plotType !== 'point') return false
  if (typeof areaHa !== 'string' && typeof areaHa !== 'number') return false
  const text = String(areaHa).trim()
  if (!text.length) return false
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > POINT_MAX_AREA_HA
}
