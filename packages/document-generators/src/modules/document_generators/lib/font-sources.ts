import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { FontFamilyConfig, FontFamilyName, FontSourceConfig } from '../data/validators'

type ResolvedFontFamily = {
  family: string
  fonts: Array<{ src: string; fontWeight?: number | 'normal' | 'bold'; fontStyle?: 'normal' | 'italic' }>
}

function resolveFontSource(source: FontSourceConfig, appRoot: string = process.cwd()): string {
  if ('url' in source) return source.url
  if ('path' in source) {
    if (!existsSync(source.path)) throw new Error(`[internal] Font file not found: ${source.path}`)
    return source.path
  }
  const lookupDirectories = createRequire(path.join(appRoot, 'package.json')).resolve.paths(source.package) ?? []
  for (const directory of lookupDirectories) {
    const candidate = path.join(directory, source.package, source.file)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`[internal] Font file "${source.file}" not found in package "${source.package}"; install it in the application`)
}

export function resolveFontFamily(font: FontFamilyConfig, options: { appRoot?: string } = {}): ResolvedFontFamily {
  return {
    family: font.family,
    fonts: font.sources.map((source) => ({
      src: resolveFontSource(source, options.appRoot),
      ...(source.fontWeight !== undefined ? { fontWeight: source.fontWeight } : {}),
      ...(source.fontStyle !== undefined ? { fontStyle: source.fontStyle } : {}),
    })),
  }
}

export function preferredFontFamilyName(settings: { fontFamily?: FontFamilyName; fonts: FontFamilyConfig[] }): FontFamilyName | undefined {
  if (settings.fontFamily !== undefined) return settings.fontFamily
  return settings.fonts.length > 0 ? settings.fonts.map((font) => font.family) : undefined
}
