import { Suspense } from 'react'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await resolveTranslations()
  return {
    title: t('instructors.profile.title', 'Instructor Profile'),
  }
}

export default async function InstructorPublicProfilePage({ params }: { params: { id: string } }) {
  const { t } = await resolveTranslations()
  return (
    <section className="max-w-4xl mx-auto p-6">
      <Suspense fallback={<div className="text-muted-foreground">{t('instructors.profile.loading', 'Loading profile...')}</div>}>
        <InstructorProfile instructorId={params.id} />
      </Suspense>
    </section>
  )
}

async function InstructorProfile({ instructorId }: { instructorId: string }) {
  const { t } = await resolveTranslations()

  return (
    <div className="space-y-8">
      <div className="text-center py-16">
        <div className="mb-4 text-5xl">👤</div>
        <h2 className="text-xl font-semibold mb-2">
          {t('instructors.profile.heading', 'Instructor Profile')}
        </h2>
        <p className="text-muted-foreground">
          {t('instructors.profile.comingSoon', 'Public instructor profiles with credential badges will be available here.')}
        </p>
        <p className="mt-2 text-sm font-mono text-muted-foreground">
          {t('instructors.profile.id', 'Profile ID')}: {instructorId}
        </p>
      </div>
    </div>
  )
}
