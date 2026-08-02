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
    {
      entityId: CHECKOUT_ENTITY_IDS.transaction,
      enabled: true,
      priority: 6,
      fieldPolicy: {
        searchable: ['email', 'firstName', 'lastName'],
      },
      buildSource: async (ctx) => ({
        text: [
          asSearchText(ctx.record.email),
          asSearchText(ctx.record.firstName),
          asSearchText(ctx.record.lastName),
        ],
        fields: {
          email: ctx.record.email,
          first_name: ctx.record.firstName,
          last_name: ctx.record.lastName,
        },
        presenter: {
          title: asSearchText(ctx.record.email),
          subtitle: `${asSearchText(ctx.record.firstName)} ${asSearchText(ctx.record.lastName)}`.trim(),
        },
        checksumSource: { record: ctx.record },
      }),
      formatResult: async (ctx) => ({
        title: asSearchText(ctx.record.email),
        subtitle: `${asSearchText(ctx.record.firstName)} ${asSearchText(ctx.record.lastName)}`.trim(),
        icon: 'lucide:receipt',
      }),
    },
  ],
}

export const config = searchConfig
export default searchConfig
