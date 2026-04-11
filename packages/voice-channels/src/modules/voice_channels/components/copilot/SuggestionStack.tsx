'use client'

import type { SuggestionCard } from '../../types'
import { ProductCard } from './cards/ProductCard'
import { PricingCard } from './cards/PricingCard'
import { ContextCard } from './cards/ContextCard'
import { DealCard } from './cards/DealCard'
import { ActionCard } from './cards/ActionCard'

interface SuggestionStackProps {
  suggestions: SuggestionCard[]
  onDismiss: (id: string) => void
}

function renderCard(card: SuggestionCard, onDismiss: (id: string) => void) {
  switch (card.type) {
    case 'product_suggestion':
      return <ProductCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'pricing_alert':
      return <PricingCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'customer_context':
      return <ContextCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'deal_status':
      return <DealCard card={card} onDismiss={() => onDismiss(card.id)} />
    case 'quick_action':
      return <ActionCard card={card} onDismiss={() => onDismiss(card.id)} />
    default:
      return null
  }
}

export function SuggestionStack({ suggestions, onDismiss }: SuggestionStackProps) {
  if (suggestions.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: '15px',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        AI Copilot nasłuchuje rozmowy i zasugeruje odpowiednie produkty, ceny i działania...
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          style={{
            marginBottom: '12px',
            animation: 'slideIn 0.4s ease-out',
          }}
        >
          {renderCard(suggestion, onDismiss)}
        </div>
      ))}
    </div>
  )
}
