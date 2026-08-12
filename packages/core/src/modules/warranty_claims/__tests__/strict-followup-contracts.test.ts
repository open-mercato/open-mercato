import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { notificationTypes as serverNotificationTypes } from '../notifications'
import { warrantyClaimsNotificationTypes as clientNotificationTypes } from '../notifications.client'

function moduleSource(relativePath: string): string {
  return readFileSync(join(__dirname, '..', relativePath), 'utf8')
}

describe('strict review follow-up contracts', () => {
  it('registers escalated notifications consistently on the server and client', () => {
    const server = serverNotificationTypes.find((entry) => entry.type === 'warranty_claims.claim.escalated')
    const client = clientNotificationTypes.find((entry) => entry.type === 'warranty_claims.claim.escalated')
    const rendererSource = moduleSource('widgets/notifications/WarrantyClaimNotificationRenderer.tsx')

    expect(server).toMatchObject({ icon: 'alarm-clock', severity: 'warning' })
    expect(client).toMatchObject({ icon: 'alarm-clock', severity: 'warning' })
    expect(rendererSource).toContain("'warranty_claims.claim.escalated': {")
    expect(rendererSource).toContain('Icon: AlarmClock')
  })

  it('keeps portal list visuals on semantic tokens and supported scale values', () => {
    const source = moduleSource('frontend/[orgSlug]/portal/claims/page.tsx')

    expect(source).toContain('<ClaimStatusBadge status={row.original.status} />')
    expect(source).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(source).not.toMatch(/(?:text|bg|border)-\[[^\]]+\]/)
    expect(source).not.toContain('rounded-2xl')
  })

  it('reloads scope-sensitive detail data and submits live dictionary form values', () => {
    const detailSource = moduleSource('backend/warranty_claims/[id]/page.tsx')
    const settingsSource = moduleSource('backend/warranty_claims/settings/page.tsx')

    expect(detailSource).toContain('const scopeVersion = useOrganizationScopeVersion()')
    expect(detailSource).toContain('}, [id, scopeVersion, t])')
    expect(settingsSource).toContain("event.currentTarget.querySelector('form')?.requestSubmit()")
    expect(settingsSource).not.toContain('void submitForm(currentValues)')
  })

  it('validates claimed quantity instead of silently defaulting invalid input', () => {
    const source = moduleSource('backend/warranty_claims/create/page.tsx')

    expect(source).toContain("t('warranty_claims.form.lines.error.qtyPositive'")
    expect(source).toContain('lines.some((line) => parsePositiveNumber(line.qtyClaimed) === null)')
  })

  it('keeps strict follow-up reads, compensation, and design values hardened', () => {
    const registrationSource = moduleSource('api/registrations/route.ts')
    const portalSource = moduleSource('api/portal/claims/route.ts')
    const kpiSource = moduleSource('backend/components/ClaimsKpiStrip.tsx')
    const stageSource = moduleSource('backend/components/ClaimStageProgress.tsx')

    expect(registrationSource).toContain('const existing = await findOneWithDecryption(')
    expect(portalSource).toContain('compensation failed — orphaned draft claim')
    expect(portalSource).not.toContain('.catch(() => undefined)')
    expect(kpiSource).toContain('hover:bg-muted/30')
    expect(kpiSource).not.toContain('hover:bg-muted/40')
    expect(stageSource).toContain('className="size-4"')
    expect(stageSource).not.toContain('size-3.5')
  })
})
