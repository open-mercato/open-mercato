// Plain-language echo line for the benefit card (Step 1.8, SPEC-055 §UI/UX "Rule
// Group Tree Builder": "The benefit card renders a one-line plain-language echo of
// the configured combination (*'20% off — the first 5 pieces across the cart, max
// $50'*), because applies_to + selector + three caps is precisely the combination
// operators mis-read").
//
// Split into a pure descriptor builder (`computeBenefitEchoDescriptor`, no i18n, unit
// -testable on its own) and a render step (`renderBenefitEcho`) that turns the
// descriptor into translated text via `useT()`'s `(key, fallback, params)` contract —
// the same `{{var}}` interpolation convention `i18n/en.json` already uses elsewhere
// (e.g. `customers.changelog.showing`).

import type { AppliesToId, DiscountTypeId, LocalBenefitNode, TierRow } from './ruleTreeTypes'

type EchoNoun = 'piece' | 'pieces' | 'line' | 'lines'

export type EchoScope =
  | { kind: 'order' }
  | { kind: 'each'; noun: 'piece' | 'line' }
  | { kind: 'firstAdded'; n: number; noun: 'pieces' | 'lines'; step: number | null }
  | { kind: 'cheapest'; n: number; noun: 'pieces' | 'lines'; step: number | null }
  | { kind: 'mostExpensive'; n: number; noun: 'pieces' | 'lines'; step: number | null }
  | { kind: 'nth'; position: number; noun: 'piece' | 'line' }

export type BenefitEchoDescriptor =
  | { kind: 'discount'; discountType: DiscountTypeId; value: string; upTo: boolean; scope: EchoScope; maxDiscount: string | null }
  | { kind: 'freeProduct'; quantity: number; scope: EchoScope; maxDiscount: string | null }

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function resolveScope(appliesTo: AppliesToId, config: Record<string, unknown>): EchoScope {
  if (appliesTo === 'order') return { kind: 'order' }
  const maxQuantity = asNumber(config.maxQuantity)
  const maxLines = asNumber(config.maxLines)
  const quantityStep = appliesTo === 'unit' ? asNumber(config.quantityStep) : null
  const selector = typeof config.selector === 'string' ? config.selector : null
  const singularNoun: 'piece' | 'line' = appliesTo === 'unit' ? 'piece' : 'line'

  if (selector === 'nth') {
    const position = asNumber(config.nthPosition)
    if (position != null) return { kind: 'nth', position, noun: singularNoun }
  }

  if (maxQuantity != null || maxLines != null) {
    const n = maxQuantity ?? maxLines ?? 0
    const noun: 'pieces' | 'lines' = maxQuantity != null ? 'pieces' : 'lines'
    const step = maxQuantity != null ? quantityStep : null
    if (selector === 'cheapest') return { kind: 'cheapest', n, noun, step }
    if (selector === 'most_expensive') return { kind: 'mostExpensive', n, noun, step }
    return { kind: 'firstAdded', n, noun, step }
  }

  return { kind: 'each', noun: singularNoun }
}

function resolveMaxDiscount(config: Record<string, unknown>): string | null {
  const raw = config.maxDiscount
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null
}

export function computeBenefitEchoDescriptor(benefit: Pick<LocalBenefitNode, 'benefitType' | 'appliesTo' | 'config'>): BenefitEchoDescriptor {
  const { benefitType, appliesTo, config } = benefit
  const scope = resolveScope(appliesTo, config)
  const maxDiscount = resolveMaxDiscount(config)

  if (benefitType === 'free_product') {
    const quantity = asNumber(config.quantity) ?? 1
    return { kind: 'freeProduct', quantity, scope, maxDiscount }
  }

  if (benefitType === 'tiered_discount') {
    const tiers = Array.isArray(config.tiers) ? (config.tiers as TierRow[]) : []
    const topTier = tiers[tiers.length - 1]
    const discountType: DiscountTypeId = topTier?.discountType === 'fixed' ? 'fixed' : 'percentage'
    const value = topTier?.value ?? '0'
    return { kind: 'discount', discountType, value, upTo: true, scope, maxDiscount }
  }

  const discountType: DiscountTypeId = config.discountType === 'fixed' ? 'fixed' : 'percentage'
  const rawValue = config.value
  const value = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '0')
  return { kind: 'discount', discountType, value, upTo: false, scope, maxDiscount }
}

export type EchoTranslate = (key: string, fallback: string, params?: Record<string, string | number>) => string

const NOUN_FALLBACKS: Record<EchoNoun, string> = {
  piece: 'piece',
  pieces: 'pieces',
  line: 'line',
  lines: 'lines',
}

function renderNoun(noun: EchoNoun, t: EchoTranslate): string {
  return t(`promotions.benefits.echo.noun.${noun}`, NOUN_FALLBACKS[noun])
}

function renderScope(scope: EchoScope, t: EchoTranslate): string {
  switch (scope.kind) {
    case 'order':
      return t('promotions.benefits.echo.scope.order', 'the whole order')
    case 'each':
      return t('promotions.benefits.echo.scope.each', 'each {{noun}}', { noun: renderNoun(scope.noun, t) })
    case 'nth':
      return t('promotions.benefits.echo.scope.nth', 'the {{noun}} at position {{position}}', {
        noun: renderNoun(scope.noun, t),
        position: scope.position,
      })
    case 'firstAdded':
    case 'cheapest':
    case 'mostExpensive': {
      const noun = renderNoun(scope.noun, t)
      const base =
        scope.kind === 'firstAdded'
          ? t('promotions.benefits.echo.scope.firstAdded', 'the first {{n}} {{noun}} across the cart', { n: scope.n, noun })
          : scope.kind === 'cheapest'
            ? t('promotions.benefits.echo.scope.cheapest', 'the {{n}} cheapest {{noun}}', { n: scope.n, noun })
            : t('promotions.benefits.echo.scope.mostExpensive', 'the {{n}} most expensive {{noun}}', { n: scope.n, noun })
      if (scope.step == null) return base
      return t('promotions.benefits.echo.scope.withStep', '{{scope}}, in blocks of {{n}}', { scope: base, n: scope.step })
    }
    default:
      return ''
  }
}

function renderHead(descriptor: BenefitEchoDescriptor, t: EchoTranslate): string {
  if (descriptor.kind === 'freeProduct') {
    return t('promotions.benefits.echo.head.freeProduct', '{{quantity}} free item(s)', { quantity: descriptor.quantity })
  }
  if (descriptor.discountType === 'fixed') {
    return descriptor.upTo
      ? t('promotions.benefits.echo.head.discountFixedUpTo', 'Up to {{value}} off', { value: descriptor.value })
      : t('promotions.benefits.echo.head.discountFixed', '{{value}} off', { value: descriptor.value })
  }
  return descriptor.upTo
    ? t('promotions.benefits.echo.head.discountPercentageUpTo', 'Up to {{value}}% off', { value: descriptor.value })
    : t('promotions.benefits.echo.head.discountPercentage', '{{value}}% off', { value: descriptor.value })
}

export function renderBenefitEcho(benefit: Pick<LocalBenefitNode, 'benefitType' | 'appliesTo' | 'config'>, t: EchoTranslate): string {
  const descriptor = computeBenefitEchoDescriptor(benefit)
  const head = renderHead(descriptor, t)
  const scope = renderScope(descriptor.scope, t)
  const cap =
    descriptor.maxDiscount != null
      ? t('promotions.benefits.echo.cap.maxDiscount', ', max {{amount}}', { amount: descriptor.maxDiscount })
      : ''
  return t('promotions.benefits.echo.combined', '{{head}} — {{scope}}{{cap}}', { head, scope, cap })
}
