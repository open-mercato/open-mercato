import { previewDictionary } from './dictionaries'
import { createTranslator } from './translate'

export const serverT = createTranslator(previewDictionary())

export function variantTitle(title: string): string {
  return serverT(`design_system.gallery.variantTitles.${title}`, title)
}

export function entryDescription(descriptionKey: string | undefined): string | undefined {
  if (!descriptionKey) return undefined
  const text = serverT(descriptionKey, '')
  return text || undefined
}
