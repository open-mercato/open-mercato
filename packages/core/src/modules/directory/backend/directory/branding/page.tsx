'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Loader2, RotateCcw, Save } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type BrandingPayload = {
  organizationId: string
  organizationName: string
  tenantId: string
  logoUrl: string | null
}

type UploadPayload = {
  ok: true
  item: {
    id: string
    url: string
    thumbnailUrl?: string
  }
}

const BRANDING_API = '/api/directory/organization-branding'
const BRANDING_ENTITY_ID = 'directory.organization'

export default function OrganizationBrandingPage() {
  const t = useT()
  const queryClient = useQueryClient()
  const [logoUrl, setLogoUrl] = React.useState('')
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const { runMutation } = useGuardedMutation({
    contextId: 'directory.organization-branding',
    blockedMessage: t('directory.branding.errors.blocked', 'Branding save was blocked.'),
  })

  const { data, isLoading, error } = useQuery<BrandingPayload>({
    queryKey: ['directory-organization-branding'],
    queryFn: () => readApiResultOrThrow<BrandingPayload>(
      BRANDING_API,
      undefined,
      { errorMessage: t('directory.branding.errors.load', 'Failed to load organization branding') },
    ),
  })

  React.useEffect(() => {
    setLogoUrl(data?.logoUrl ?? '')
    setSelectedFile(null)
  }, [data?.logoUrl])

  React.useEffect(() => {
    if (!selectedFile || typeof URL === 'undefined') {
      setFilePreviewUrl(null)
      return
    }
    const nextPreviewUrl = URL.createObjectURL(selectedFile)
    setFilePreviewUrl(nextPreviewUrl)
    return () => URL.revokeObjectURL(nextPreviewUrl)
  }, [selectedFile])

  const currentPreviewUrl = filePreviewUrl ?? logoUrl

  const uploadLogo = React.useCallback(async (organizationId: string): Promise<string | null> => {
    if (!selectedFile) return null
    const form = new FormData()
    form.set('entityId', BRANDING_ENTITY_ID)
    form.set('recordId', organizationId)
    form.set('file', selectedFile)
    form.set('tags', JSON.stringify(['organization-logo']))

    const upload = await readApiResultOrThrow<UploadPayload>(
      '/api/attachments',
      {
        method: 'POST',
        body: form,
      },
      { errorMessage: t('directory.branding.errors.upload', 'Failed to upload logo') },
    )
    return upload?.item.thumbnailUrl ?? upload?.item.url ?? null
  }, [selectedFile, t])

  const saveBranding = React.useCallback(async (nextLogoUrl?: string, options?: { skipUpload?: boolean }) => {
    if (!data) return
    const shouldUpload = Boolean(selectedFile && !options?.skipUpload)
    setSaving(true)
    try {
      await runMutation({
        operation: async () => {
          const uploadedLogoUrl = shouldUpload ? await uploadLogo(data.organizationId) : null
          const resolvedLogoUrl = uploadedLogoUrl ?? nextLogoUrl ?? logoUrl.trim()
          const response = await apiCallOrThrow<BrandingPayload>(
            BRANDING_API,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ logoUrl: resolvedLogoUrl || null }),
            },
            { errorMessage: t('directory.branding.errors.save', 'Failed to update organization branding') },
          )
          return response.result
        },
        context: {
          entityId: BRANDING_ENTITY_ID,
          recordId: data.organizationId,
          operation: 'update-branding',
        },
        mutationPayload: {
          organizationId: data.organizationId,
          logoUrl: (nextLogoUrl ?? logoUrl.trim()) || null,
          hasUpload: shouldUpload,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['directory-organization-branding'] })
      window.dispatchEvent(new Event('om:refresh-sidebar'))
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      flash(t('directory.branding.flash.saved', 'Organization branding updated'), 'success')
    } catch (err: unknown) {
      const fallback = t('directory.branding.errors.save', 'Failed to update organization branding')
      const message = err instanceof Error ? err.message : fallback
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [data, logoUrl, queryClient, runMutation, selectedFile, t, uploadLogo])

  const handleSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveBranding()
  }, [saveBranding])

  if (isLoading) {
    return <LoadingMessage label={t('directory.branding.loading', 'Loading organization branding...')} />
  }

  if (error || !data) {
    return (
      <ErrorMessage
        label={t('directory.branding.errors.load', 'Failed to load organization branding')}
        description={error instanceof Error ? error.message : undefined}
      />
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('directory.branding.title', 'Organization branding')}
        description={t(
          'directory.branding.description',
          'Set the logo used in the backend sidebar for the currently selected organization.',
        )}
      />
      <PageBody>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
            <div className="space-y-3">
              <div className="flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
                {currentPreviewUrl ? (
                  <img
                    src={currentPreviewUrl}
                    alt={t('directory.branding.previewAlt', '{{name}} logo preview', { name: data.organizationName })}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImagePlus className="size-10 text-muted-foreground" aria-hidden />
                )}
              </div>
              <p className="text-sm font-medium text-foreground">{data.organizationName}</p>
              <p className="text-xs text-muted-foreground">
                {t('directory.branding.currentScope', 'Current organization')}
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="organization-logo-file" className="text-sm font-medium">
                  {t('directory.branding.file.label', 'Upload logo')}
                </label>
                <Input
                  ref={fileInputRef}
                  id="organization-logo-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null
                    setSelectedFile(file)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t('directory.branding.file.hint', 'PNG, JPG, WebP, or SVG works best. Uploaded files are stored as organization attachments.')}
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="organization-logo-url" className="text-sm font-medium">
                  {t('directory.branding.url.label', 'Logo URL')}
                </label>
                <Input
                  id="organization-logo-url"
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.currentTarget.value)}
                  placeholder={t('directory.branding.url.placeholder', 'https://example.com/logo.svg')}
                />
                <p className="text-xs text-muted-foreground">
                  {t('directory.branding.url.hint', 'Use an external image URL or leave empty to fall back to the default Open Mercato logo.')}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <Save className="mr-2 size-4" aria-hidden />}
                  {t('directory.branding.actions.save', 'Save branding')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setSelectedFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                    setLogoUrl('')
                    void saveBranding('', { skipUpload: true })
                  }}
                >
                  <RotateCcw className="mr-2 size-4" aria-hidden />
                  {t('directory.branding.actions.reset', 'Use default logo')}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </PageBody>
    </Page>
  )
}
