/**
 * @jest-environment node
 */
/**
 * Every example widget injected into ANOTHER module's spot must declare that module in
 * `metadata.requiredModules`.
 *
 * Context: the injection table used to be gated by an env flag. Retiring that flag (so the
 * fact extractor could read the registry at all) made every entry unconditional, and the
 * maintainer decision covering it assumed the entries were "gated only by
 * `metadata.requiredModules`". That was NOT true — no example widget declared the field, so
 * the only thing keeping a cross-module entry inert was that its host module happens not to
 * render the spot. This test makes the assumed gate real and keeps it real.
 *
 * `injection-loader.ts` enforces `requiredModules` (`applyRequiredModuleGate` /
 * `widgetMissingRequiredModules`), so a declared gate is load-bearing, not decorative.
 */
import fs from 'node:fs'
import path from 'node:path'
import injectionTable from '../injection-table'

const widgetsRoot = path.join(__dirname, '..', 'injection')

/** Host module for a spot id, or null when the spot belongs to the example module itself. */
function hostModuleOf(spotId: string): string | null {
  const target = spotId
    .replace(/^(data-table|crud-form|menu|widget|detail):/, '')
    .replace(/:(columns|row-actions|bulk-actions|filters|fields|header|toolbar|footer|tabs|sidebar|search-trailing|addon)$/, '')
  const moduleId = target.split(/[.:]/)[0]
  if (!moduleId || moduleId === 'example' || moduleId === 'portal' || moduleId === 'sidebar' || moduleId === 'topbar') return null
  return moduleId
}

function widgetIdsFor(slot: unknown): string[] {
  if (typeof slot === 'string') return [slot]
  if (Array.isArray(slot)) return slot.flatMap(widgetIdsFor)
  if (slot && typeof slot === 'object' && typeof (slot as { widgetId?: unknown }).widgetId === 'string') {
    return [(slot as { widgetId: string }).widgetId]
  }
  return []
}

function declaredRequiredModules(widgetId: string): string[] | null {
  const folder = widgetId.replace(/^example\.injection\./, '')
  const file = path.join(widgetsRoot, folder, 'widget.ts')
  if (!fs.existsSync(file)) return null
  const source = fs.readFileSync(file, 'utf8')
  const match = source.match(/requiredModules:\s*\[([^\]]*)\]/)
  if (!match) return []
  return match[1].split(',').map((entry) => entry.trim().replace(/['"]/g, '')).filter(Boolean)
}

describe('example cross-module injection widgets', () => {
  const crossModuleBindings: Array<{ spotId: string; widgetId: string; host: string }> = []
  for (const [spotId, slot] of Object.entries(injectionTable)) {
    const host = hostModuleOf(spotId)
    if (!host) continue
    for (const widgetId of widgetIdsFor(slot)) crossModuleBindings.push({ spotId, widgetId, host })
  }

  it('finds cross-module bindings to check', () => {
    expect(crossModuleBindings.length).toBeGreaterThan(0)
  })

  it('declares requiredModules when EVERY binding of a widget is into one other module', () => {
    // `applyRequiredModuleGate` nulls the WHOLE widget when a required module is absent — the
    // gate is per-widget, not per-binding. So it is only correct for a widget whose bindings
    // are exclusively into other modules. A widget also bound to an example-owned spot (e.g.
    // `crud-validation`, which serves both `crud-form:example.todo` and catalog's forms) MUST
    // NOT declare one, or disabling catalog would take the example's own demo down with it.
    const bindingsByWidget = new Map<string, Set<string | null>>()
    for (const [spotId, slot] of Object.entries(injectionTable)) {
      const host = hostModuleOf(spotId)
      for (const widgetId of widgetIdsFor(slot)) {
        if (!bindingsByWidget.has(widgetId)) bindingsByWidget.set(widgetId, new Set())
        bindingsByWidget.get(widgetId)!.add(host)
      }
    }

    const problems: string[] = []
    for (const [widgetId, hosts] of bindingsByWidget) {
      const declared = declaredRequiredModules(widgetId)
      if (declared === null) continue
      const foreign = [...hosts].filter((host): host is string => host !== null)
      const ownsAnExampleSpot = hosts.has(null)

      if (foreign.length > 0 && !ownsAnExampleSpot) {
        for (const host of foreign) {
          if (!declared.includes(host)) problems.push(`${widgetId} binds only into '${host}' but declares [${declared.join(', ')}]`)
        }
      }
      if (ownsAnExampleSpot && declared.length > 0) {
        problems.push(`${widgetId} also serves an example-owned spot, so a per-widget gate [${declared.join(', ')}] would disable its own-module binding`)
      }
    }
    expect(problems).toEqual([])
  })
})
