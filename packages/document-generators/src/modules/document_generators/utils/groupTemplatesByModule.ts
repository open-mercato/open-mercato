import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'

export function groupTemplatesByModule(templates: TemplateMeta[]): Map<string, TemplateMeta[]> {
  const modules = new Map<string, TemplateMeta[]>()
  for (const template of templates) {
    const entries = modules.get(template.module) ?? []
    entries.push(template)
    modules.set(template.module, entries)
  }
  return modules
}
