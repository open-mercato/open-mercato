# Implement pipeline deal card customization

Source doc: .ai/specs/2026-11-24-deal-card-customization.md
Spec PR: #10534
Issue: #7260

Register the card rendered by each lane and let apps show a reference from the deal data already returned to the board. Preserve the current card UI and default reference. Track aggregate filtering separately in #10531.

## Implementation Plan

1. Add the registered component, its reference prop, and a documented downstream transform. Retain the list row by reference for first and subsequent pages.
2. Exercise the lane override, memoized label changes, fallback behavior and the default board navigation flow. Run the configured validation and UI checks.

## Progress

### Phase 1: Deal card extension

- [ ] 1.1 Register the card and document the override contract
- [ ] 1.2 Verify custom and default references through the board
