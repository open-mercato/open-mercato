import type { SearchModuleConfig, SearchBuildContext } from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'instructors:instructor_profile',
      enabled: true,
      priority: 15,

      buildSource: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const displayName = typeof record.display_name === 'string' ? record.display_name : ''
        const headline = typeof record.headline === 'string' ? record.headline : ''
        const bio = typeof record.bio === 'string' ? record.bio : ''
        const specializations = Array.isArray(record.specializations)
          ? (record.specializations as string[]).join(', ')
          : ''

        const textParts = [
          `Name: ${displayName}`,
          headline ? `Headline: ${headline}` : '',
          specializations ? `Specializations: ${specializations}` : '',
          bio ? `Bio: ${bio.slice(0, 500)}` : '',
        ].filter(Boolean)

        return {
          text: textParts,
          presenter: {
            title: displayName,
            subtitle: headline || specializations || 'KARIANA Instructor',
            icon: 'lucide:graduation-cap',
          },
        }
      },

      fieldPolicy: {
        searchable: ['display_name', 'headline', 'bio', 'slug'],
        hashOnly: [],
        excluded: ['avatar_url', 'website_url', 'github_url', 'linkedin_url'],
      },

      formatResult: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        const displayName = typeof record.display_name === 'string' ? record.display_name : 'Unknown'
        const headline = typeof record.headline === 'string' ? record.headline : null
        const isVerified = record.is_verified === true

        return {
          title: displayName,
          subtitle: headline ?? 'KARIANA Instructor',
          icon: 'lucide:graduation-cap',
          badge: isVerified ? 'Verified' : undefined,
        }
      },

      resolveUrl: async (ctx: SearchBuildContext) => {
        const record = ctx.record as Record<string, unknown>
        return `/backend/instructors/${record.id}`
      },
    },
  ],
}

export default searchConfig
