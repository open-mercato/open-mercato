import type { SuggestionCard } from '../../types'

/**
 * Pre-recorded suggestion cards keyed by segment ID.
 * Used by the local replay system in CopilotPage.
 * The page fills in `id`, `triggerSegmentId`, `triggerText`, and `createdAt` at runtime.
 */
export const DEMO_SUGGESTIONS: Record<number, Partial<SuggestionCard>> = {
  // Segment 2 — customer introduces himself → fire CustomerContext immediately.
  2: {
    type: 'customer_context',
    priority: 'high',
    id: '',
    createdAt: 0,
    triggerSegmentId: 0,
    triggerText: '',
    matchConfidence: 100,
    detectedIntent: 'identyfikacja klienta',
    customer: {
      id: 'cust-acme-steel',
      name: 'Marek Nowakowski',
      company: 'ACME Steel Sp. z o.o.',
      lifetimeValue: 1_240_000,
      currency: 'PLN',
      lastOrderDate: '2026-03-18',
      orderCount: 47,
      avgOrderValue: 26_380,
      topCategories: ['Profile stalowe', 'Blachy', 'Pręty zbrojeniowe'],
      openTickets: 1,
      assignedRep: 'Anna Kowalska',
      notes: 'Kluczowy klient — negocjator, oczekuje rabatów wolumenowych.',
    },
  } as Partial<SuggestionCard>,

  // Segment 4 — product need (80x80 profiles) → ProductSuggestion.
  4: {
    type: 'product_suggestion',
    priority: 'high',
    id: '',
    createdAt: 0,
    triggerSegmentId: 0,
    triggerText: '',
    matchConfidence: 94,
    detectedIntent: 'zapotrzebowanie na produkt',
    products: [
      {
        id: 'prod-prof-80x80-s235',
        name: 'Profil stalowy zamknięty 80x80x4 S235JR',
        sku: 'PRF-80-80-4-S235',
        price: { amount: 189.90, currency: 'PLN', priceType: 'netto / szt.' },
        available: true,
        stockQuantity: 412,
        matchReason: 'Dopasowanie: "profile stalowe 80x80", w magazynie, standardowy chód',
      },
      {
        id: 'prod-prof-80x80-s355',
        name: 'Profil stalowy zamknięty 80x80x5 S355J2H',
        sku: 'PRF-80-80-5-S355',
        price: { amount: 228.00, currency: 'PLN', priceType: 'netto / szt.' },
        available: true,
        stockQuantity: 180,
        matchReason: 'Wyższa klasa stali — rekomendowane dla konstrukcji nośnych',
      },
    ],
  } as Partial<SuggestionCard>,

  // Segment 6 — price objection + competitor mention → PricingAlert.
  6: {
    type: 'pricing_alert',
    priority: 'high',
    id: '',
    createdAt: 0,
    triggerSegmentId: 0,
    triggerText: '',
    matchConfidence: 91,
    detectedIntent: 'obiekcja cenowa',
    currentPrice: 189.90,
    floorPrice: 171.00,
    maxDiscountPercent: 10,
    currency: 'PLN',
    activePromotions: [
      { name: 'Wolumen 200+ szt.', discount: '-6%', validUntil: '2026-04-30' },
      { name: 'Klient VIP Q2', discount: '-3%', validUntil: '2026-06-30' },
    ],
  } as Partial<SuggestionCard>,

  // Segment 8 — complaint / open ticket → DealStatus (reusing to show open items + stalled deal).
  8: {
    type: 'deal_status',
    priority: 'medium',
    id: '',
    createdAt: 0,
    triggerSegmentId: 0,
    triggerText: '',
    matchConfidence: 88,
    detectedIntent: 'otwarte sprawy klienta',
    deals: [
      {
        id: 'deal-acme-q2-frame',
        title: 'ACME Q2 – konstrukcja hali',
        stage: 'Negocjacje',
        value: 184_500,
        currency: 'PLN',
        daysInStage: 12,
        isStalled: true,
      },
      {
        id: 'deal-acme-roof',
        title: 'ACME – dach magazynu',
        stage: 'Oferta wysłana',
        value: 62_300,
        currency: 'PLN',
        daysInStage: 4,
        isStalled: false,
      },
    ],
  } as Partial<SuggestionCard>,

  // Segment 10 — order intent → QuickAction.
  10: {
    type: 'quick_action',
    priority: 'high',
    id: '',
    createdAt: 0,
    triggerSegmentId: 0,
    triggerText: '',
    matchConfidence: 97,
    detectedIntent: 'zamiar zakupu',
    actions: [
      { label: '📝 Utwórz ofertę z rabatem -6%', actionType: 'create_quote' },
      { label: '📅 Umów follow-up jutro 09:00', actionType: 'schedule_followup' },
      { label: '🗒️ Dodaj notatkę do CRM', actionType: 'add_note' },
    ],
  } as Partial<SuggestionCard>,
}
