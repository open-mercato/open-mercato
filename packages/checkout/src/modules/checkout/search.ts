import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'

function asSearchText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'checkout:link',
      enabled: true,
      priority: 10,
      fieldPolicy: {
        searchable: ['name', 'title', 'slug'],
        excluded: ['passwordHash', 'gatewaySettings', 'customerFieldsSchema'],
      },
      buildSource: async (ctx) => ({
        text: [`${asSearchText(ctx.record.name)}: ${asSearchText(ctx.record.title)} (${asSearchText(ctx.record.slug)})`],
        presenter: { title: asSearchText(ctx.record.name), subtitle: asSearchText(ctx.record.slug) },
        checksumSource: { record: ctx.record, customFields: ctx.customFields },
      }),
      formatResult: async (ctx) => ({
        title: asSearchText(ctx.record.name),
        subtitle: `/pay/${asSearchText(ctx.record.slug)}`,
        icon: 'lucide:link',
      }),
    },
    {
      entityId: 'checkout:template',
      enabled: true,
      priority: 8,
      fieldPolicy: {
        searchable: ['name', 'title'],
        excluded: ['passwordHash', 'gatewaySettings', 'customerFieldsSchema'],
      },
      buildSource: async (ctx) => ({
        text: [`${asSearchText(ctx.record.name)}: ${asSearchText(ctx.record.title)}`],
        presenter: { title: asSearchText(ctx.record.name), subtitle: 'Link Template' },
        checksumSource: { record: ctx.record, customFields: ctx.customFields },
      }),
      formatResult: async (ctx) => ({
        title: asSearchText(ctx.record.name),
        subtitle: 'Link Template',
        icon: 'lucide:file-text',
      }),
    },
  ],
}

export default searchConfig
