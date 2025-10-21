import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDictionaryEntry } from '../../../../data/entities'
import { mapDictionaryKind, resolveDictionaryRouteContext } from '../../context'
import { invalidateDictionaryCache } from '../../cache'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const patchSchema = z
  .object({
    value: z.string().trim().min(1).max(150).optional(),
    label: z.string().trim().max(150).optional(),
    color: z.union([z.string().trim(), z.null()]).optional(),
    icon: z.union([z.string().trim(), z.null()]).optional(),
  })
  .refine((input) => input.value !== undefined || input.label !== undefined || input.color !== undefined || input.icon !== undefined, {
    message: 'No changes provided',
  })

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
}

export async function PATCH(req: Request, ctx: { params?: { kind?: string; id?: string } }) {
  try {
    const routeContext = await resolveDictionaryRouteContext(req)
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const payload = patchSchema.parse(await req.json().catch(() => ({})))

    const entry = await routeContext.em.findOne(CustomerDictionaryEntry, { id })
    if (!entry || entry.kind !== mappedKind || entry.organizationId !== routeContext.organizationId || entry.tenantId !== routeContext.tenantId) {
      throw new CrudHttpError(404, { error: routeContext.translate('customers.errors.lookup_failed', 'Dictionary entry not found') })
    }

    let hasChanges = false

    if (payload.value !== undefined) {
      const value = payload.value.trim()
      const normalized = value.toLowerCase()
      if (!value) {
        throw new CrudHttpError(400, { error: routeContext.translate('customers.config.dictionaries.errors.required', 'Please provide a value') })
      }
      const duplicate = await routeContext.em.findOne(CustomerDictionaryEntry, {
        id: { $ne: entry.id },
        tenantId: routeContext.tenantId,
        organizationId: routeContext.organizationId,
        kind: mappedKind,
        normalizedValue: normalized,
      })
      if (duplicate) {
        throw new CrudHttpError(409, { error: routeContext.translate('customers.config.dictionaries.errors.duplicate', 'An entry with this value already exists') })
      }
      entry.value = value
      entry.normalizedValue = normalized
      if (payload.label === undefined) {
        entry.label = value
      }
      hasChanges = true
    }

    if (payload.label !== undefined) {
      const label = payload.label.trim()
      entry.label = label || entry.value
      hasChanges = true
    }

    if (payload.color !== undefined) {
      const colorInput = payload.color
      const normalizedColor =
        colorInput === null || colorInput === ''
          ? null
          : /^#([0-9A-Fa-f]{6})$/.test(colorInput)
            ? `#${colorInput.slice(1).toLowerCase()}`
            : null
      if (colorInput && !normalizedColor) {
        throw new CrudHttpError(400, { error: routeContext.translate('customers.config.dictionaries.errors.invalidColor', 'Color must be a valid hex value like #3366ff') })
      }
      if (entry.color !== normalizedColor) {
        entry.color = normalizedColor
        hasChanges = true
      }
    }

    if (payload.icon !== undefined) {
      const iconInput = payload.icon
      const normalizedIcon =
        iconInput === null || iconInput === ''
          ? null
          : iconInput.length > 48
            ? iconInput.slice(0, 48)
            : iconInput
      if (normalizedIcon && normalizedIcon.length === 0) {
        throw new CrudHttpError(400, { error: routeContext.translate('customers.config.dictionaries.errors.invalidIcon', 'Icon must be a short name or emoji') })
      }
      if (entry.icon !== normalizedIcon) {
        entry.icon = normalizedIcon
        hasChanges = true
      }
    }

    if (!hasChanges) {
      return NextResponse.json({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
        organizationId: entry.organizationId,
        isInherited: false,
      })
    }

    await routeContext.em.flush()

    await invalidateDictionaryCache(routeContext.cache, {
      tenantId: routeContext.tenantId,
      mappedKind,
      organizationIds: [routeContext.organizationId],
    })

    return NextResponse.json({
      id: entry.id,
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
      organizationId: entry.organizationId,
      isInherited: false,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.dictionaries.update failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') }, { status: 400 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { kind?: string; id?: string } }) {
  try {
    const routeContext = await resolveDictionaryRouteContext(req)
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    const { id } = paramsSchema.parse({ id: ctx.params?.id })

    const entry = await routeContext.em.findOne(CustomerDictionaryEntry, { id })
    if (!entry || entry.kind !== mappedKind || entry.organizationId !== routeContext.organizationId || entry.tenantId !== routeContext.tenantId) {
      throw new CrudHttpError(404, { error: routeContext.translate('customers.errors.lookup_failed', 'Dictionary entry not found') })
    }

    routeContext.em.remove(entry)
    await routeContext.em.flush()

    await invalidateDictionaryCache(routeContext.cache, {
      tenantId: routeContext.tenantId,
      mappedKind,
      organizationIds: [routeContext.organizationId],
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.dictionaries.delete failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to delete dictionary entry') }, { status: 400 })
  }
}
