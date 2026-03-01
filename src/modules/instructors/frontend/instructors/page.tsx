import { Suspense } from 'react'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await resolveTranslations()
  return {
    title: t('instructors.directory.title', 'KARIANA Instructor Directory'),
    description: t('instructors.directory.description', 'Find verified Unreal Engine instructors with KARIANA expertise.'),
  }
}

export default async function InstructorDirectoryPage() {
  const { t } = await resolveTranslations()
  return (
    <section className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          {t('instructors.directory.heading', 'KARIANA Instructor Directory')}
        </h1>
        <p className="text-muted-foreground text-lg">
          {t('instructors.directory.subheading', 'Browse verified Unreal Engine professionals who teach and support KARIANA workflows.')}
        </p>
      </div>
      <Suspense fallback={<div className="text-muted-foreground">{t('instructors.directory.loading', 'Loading instructors...')}</div>}>
        <InstructorGrid />
      </Suspense>
    </section>
  )
}

async function InstructorGrid() {
  const { t } = await resolveTranslations()

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 text-5xl">🎓</div>
        <h2 className="text-xl font-semibold mb-2">
          {t('instructors.directory.comingSoon', 'Instructor Directory Coming Soon')}
        </h2>
        <p className="text-muted-foreground max-w-md">
          {t('instructors.directory.comingSoonDescription', 'We are building a marketplace where KARIANA instructors can showcase their Unreal Engine credentials and offer their expertise. Check back soon!')}
        </p>
      </div>
    </div>
  )
}
