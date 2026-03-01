"use client"

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@/lib/i18n/context'

type InstructorDetail = {
  id: string
  displayName: string
  slug: string
  bio: string | null
  headline: string | null
  avatarUrl: string | null
  specializations: string[] | null
  experienceYears: number | null
  hourlyRate: string | null
  currency: string
  isAvailable: boolean
  isVerified: boolean
  websiteUrl: string | null
  githubUrl: string | null
  linkedinUrl: string | null
  createdAt: string | null
}

type CredentialItem = {
  id: string
  credentialUrl: string
  credentialType: string
  title: string | null
  issuer: string | null
  badgeImageUrl: string | null
  issuedAt: string | null
  verificationStatus: string
}

function mapInstructorData(items: Array<Record<string, unknown>>): InstructorDetail | null {
  const item = items[0]
  if (!item) return null
  return {
    id: item.id as string,
    displayName: (item.display_name ?? item.displayName ?? '') as string,
    slug: (item.slug ?? '') as string,
    bio: (item.bio ?? null) as string | null,
    headline: (item.headline ?? null) as string | null,
    avatarUrl: (item.avatar_url ?? item.avatarUrl ?? null) as string | null,
    specializations: Array.isArray(item.specializations) ? item.specializations as string[] : null,
    experienceYears: typeof item.experience_years === 'number' ? item.experience_years : null,
    hourlyRate: typeof item.hourly_rate === 'string' ? item.hourly_rate : null,
    currency: (item.currency ?? 'USD') as string,
    isAvailable: item.is_available === true,
    isVerified: item.is_verified === true,
    websiteUrl: (item.website_url ?? null) as string | null,
    githubUrl: (item.github_url ?? null) as string | null,
    linkedinUrl: (item.linkedin_url ?? null) as string | null,
    createdAt: (item.created_at ?? null) as string | null,
  }
}

function mapCredentialItems(items: Array<Record<string, unknown>>): CredentialItem[] {
  return items.map((item) => ({
    id: item.id as string,
    credentialUrl: (item.credential_url ?? '') as string,
    credentialType: (item.credential_type ?? 'other') as string,
    title: (item.title ?? null) as string | null,
    issuer: (item.issuer ?? null) as string | null,
    badgeImageUrl: (item.badge_image_url ?? null) as string | null,
    issuedAt: (item.issued_at ?? null) as string | null,
    verificationStatus: (item.verification_status ?? 'pending') as string,
  }))
}

function VerificationBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    verified: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    expired: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  )
}

export default function InstructorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const t = useT()
  const [instructor, setInstructor] = React.useState<InstructorDetail | null>(null)
  const [credentials, setCredentials] = React.useState<CredentialItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [newCredentialUrl, setNewCredentialUrl] = React.useState('')
  const [isAddingCredential, setIsAddingCredential] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const [profileCall, credentialsCall] = await Promise.all([
          apiCall<{ items?: Array<Record<string, unknown>> }>(`/api/instructors?id=${id}&pageSize=1`),
          apiCall<{ items?: Array<Record<string, unknown>> }>(`/api/credentials?instructorId=${id}&pageSize=100`),
        ])
        if (cancelled) return

        if (profileCall.ok && profileCall.result?.items) {
          const profile = mapInstructorData(profileCall.result.items)
          if (!profile) {
            setError(t('instructors.detail.notFound', 'Instructor not found.'))
            return
          }
          setInstructor(profile)
        } else {
          setError(t('instructors.detail.loadError', 'Failed to load instructor.'))
        }

        if (credentialsCall.ok && credentialsCall.result?.items) {
          setCredentials(mapCredentialItems(credentialsCall.result.items))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('instructors.detail.loadError', 'Failed to load instructor.'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const handleAddCredential = React.useCallback(async () => {
    if (!newCredentialUrl.trim() || !instructor) return
    setIsAddingCredential(true)
    try {
      const { result } = await readApiResultOrThrow<{ id?: string; verificationStatus?: string }>(
        '/api/credentials',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            instructorId: instructor.id,
            credentialUrl: newCredentialUrl.trim(),
          }),
        },
        { errorMessage: t('instructors.credentials.addError', 'Failed to add credential.') },
      )
      flash(t('instructors.credentials.addSuccess', 'Credential added.'), 'success')
      setNewCredentialUrl('')

      const credentialsCall = await apiCall<{ items?: Array<Record<string, unknown>> }>(`/api/credentials?instructorId=${instructor.id}&pageSize=100`)
      if (credentialsCall.ok && credentialsCall.result?.items) {
        setCredentials(mapCredentialItems(credentialsCall.result.items))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('instructors.credentials.addError', 'Failed to add credential.')
      flash(message, 'error')
    } finally {
      setIsAddingCredential(false)
    }
  }, [instructor, newCredentialUrl, t])

  const handleVerify = React.useCallback(async (credentialId: string) => {
    try {
      await readApiResultOrThrow(
        '/api/credentials/verify',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ credentialId }),
        },
        { errorMessage: t('instructors.credentials.verifyError', 'Verification failed.') },
      )
      flash(t('instructors.credentials.verifySuccess', 'Credential verified.'), 'success')

      if (instructor) {
        const credentialsCall = await apiCall<{ items?: Array<Record<string, unknown>> }>(`/api/credentials?instructorId=${instructor.id}&pageSize=100`)
        if (credentialsCall.ok && credentialsCall.result?.items) {
          setCredentials(mapCredentialItems(credentialsCall.result.items))
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('instructors.credentials.verifyError', 'Verification failed.')
      flash(message, 'error')
    }
  }, [instructor, t])

  if (isLoading) return <LoadingMessage />
  if (error) return <ErrorMessage message={error} />
  if (!instructor) return <ErrorMessage message={t('instructors.detail.notFound', 'Instructor not found.')} />

  return (
    <Page>
      <PageBody>
        <div className="space-y-8">
          {/* Profile Header */}
          <div className="flex items-start gap-6">
            {instructor.avatarUrl && (
              <img src={instructor.avatarUrl} alt={instructor.displayName} className="h-20 w-20 rounded-full object-cover" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{instructor.displayName}</h1>
                {instructor.isVerified && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                    {t('instructors.detail.verified', 'Verified')}
                  </span>
                )}
                {instructor.isAvailable && (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    {t('instructors.detail.available', 'Available')}
                  </span>
                )}
              </div>
              {instructor.headline && <p className="mt-1 text-muted-foreground">{instructor.headline}</p>}
              <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                {instructor.experienceYears && <span>{instructor.experienceYears} {t('instructors.detail.yearsExp', 'years experience')}</span>}
                {instructor.hourlyRate && <span>{instructor.currency} {instructor.hourlyRate}/hr</span>}
                <span className="font-mono text-xs">/{instructor.slug}</span>
              </div>
            </div>
            <Button variant="outline" onClick={() => router.push('/backend/instructors')}>
              {t('instructors.detail.backToList', 'Back to List')}
            </Button>
          </div>

          {/* Specializations */}
          {instructor.specializations && instructor.specializations.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-2">{t('instructors.detail.specializations', 'Specializations')}</h2>
              <div className="flex flex-wrap gap-2">
                {instructor.specializations.map((spec) => (
                  <span key={spec} className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                    {spec}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Bio */}
          {instructor.bio && (
            <div>
              <h2 className="text-lg font-semibold mb-2">{t('instructors.detail.bio', 'Bio')}</h2>
              <div className="prose dark:prose-invert max-w-none">
                <p className="whitespace-pre-wrap">{instructor.bio}</p>
              </div>
            </div>
          )}

          {/* Links */}
          {(instructor.websiteUrl || instructor.githubUrl || instructor.linkedinUrl) && (
            <div>
              <h2 className="text-lg font-semibold mb-2">{t('instructors.detail.links', 'Links')}</h2>
              <div className="flex gap-4">
                {instructor.websiteUrl && (
                  <a href={instructor.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                    {t('instructors.detail.website', 'Website')}
                  </a>
                )}
                {instructor.githubUrl && (
                  <a href={instructor.githubUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                    GitHub
                  </a>
                )}
                {instructor.linkedinUrl && (
                  <a href={instructor.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Credentials Section */}
          <div>
            <h2 className="text-lg font-semibold mb-4">{t('instructors.credentials.title', 'Credentials & Certifications')}</h2>

            {/* Add Credential */}
            <div className="mb-4 flex gap-2">
              <input
                type="url"
                value={newCredentialUrl}
                onChange={(event) => setNewCredentialUrl(event.target.value)}
                placeholder={t('instructors.credentials.urlPlaceholder', 'Paste credential URL (e.g., credential.unrealengine.com/...)')}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    handleAddCredential()
                  }
                }}
              />
              <Button onClick={handleAddCredential} disabled={isAddingCredential || !newCredentialUrl.trim()}>
                {isAddingCredential
                  ? t('instructors.credentials.adding', 'Adding...')
                  : t('instructors.credentials.add', 'Add Credential')}
              </Button>
            </div>

            {/* Credential Cards */}
            {credentials.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('instructors.credentials.empty', 'No credentials added yet.')}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {credentials.map((cred) => (
                  <div key={cred.id} className="rounded-lg border bg-card p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      {cred.badgeImageUrl && (
                        <img src={cred.badgeImageUrl} alt={cred.title ?? 'Badge'} className="h-16 w-16 rounded object-contain" />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm truncate">
                          {cred.title ?? t('instructors.credentials.untitled', 'Untitled Credential')}
                        </h3>
                        {cred.issuer && <p className="text-xs text-muted-foreground">{cred.issuer}</p>}
                        <div className="mt-1 flex items-center gap-2">
                          <VerificationBadge status={cred.verificationStatus} />
                          <span className="text-xs text-muted-foreground capitalize">{cred.credentialType.replace('_', ' ')}</span>
                        </div>
                        {cred.issuedAt && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('instructors.credentials.issued', 'Issued')}: {new Date(cred.issuedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <a
                        href={cred.credentialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        {t('instructors.credentials.viewCredential', 'View Credential')}
                      </a>
                      {cred.verificationStatus !== 'verified' && (
                        <button
                          onClick={() => handleVerify(cred.id)}
                          className="text-xs text-primary hover:underline"
                        >
                          {t('instructors.credentials.verify', 'Re-verify')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
