import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'
import { CHECKOUT_ENTITY_IDS } from './lib/constants'

function asSearchText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: CHECKOUT_ENTITY_IDS.link,
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
      entityId: CHECKOUT_ENTITY_IDS.template,
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

export const config = searchConfig
export default searchConfig
