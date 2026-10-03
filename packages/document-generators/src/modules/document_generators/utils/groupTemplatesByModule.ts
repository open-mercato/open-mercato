import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'

export function groupTemplatesByModule(templates: TemplateMeta[]): Map<string, TemplateMeta[]> {
  const groups = new Map<string, TemplateMeta[]>()
  for (const template of templates) {
    const group = groups.get(template.module) ?? []
    group.push(template)
    groups.set(template.module, group)
  }
  return groups
}
