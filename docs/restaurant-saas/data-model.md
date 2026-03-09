# Restaurant SaaS MVP Data Model

## Core aggregates

### Restaurant
- id
- name
- location
- service_mode
- currency
- brand_tone

### Table
- id
- label
- zone
- seats
- qr_path
- restaurant_id

### MenuItem
- id
- slug
- category
- name
- description
- base_price
- prep_minutes
- tags[]
- availability_status

### ModifierGroup
- id
- menu_item_id
- label
- required

### ModifierOption
- id
- modifier_group_id
- label
- price_delta

### Recipe
- id
- menu_item_id

### RecipeLine
- id
- recipe_id
- ingredient_id
- quantity
- unit

### IngredientStock
- id
- ingredient_id
- on_hand
- incoming
- safety_stock
- waste
- manual_adjustment
- supplier
- cost_per_unit
- base_unit

### Order
- id
- restaurant_id
- table_id
- source (`web-table`)
- payment_status
- kitchen_status
- priority
- guest_count
- total_amount
- created_at

### OrderLine
- id
- order_id
- menu_item_id
- quantity
- unit_price_snapshot
- selected_modifiers_snapshot
- note

### SupplierReceipt
- id
- supplier
- reference
- status
- received_at

### SupplierReceiptLine
- id
- supplier_receipt_id
- ingredient_id
- quantity
- unit

## Traceability chain

The intended auditable chain is:

`menu item sold -> order line -> recipe lines -> ingredient consumption -> stock position`

and

`supplier invoice -> supplier receipt -> receipt lines -> stock increment`

## Stock fields semantics

### current
What is physically available after:
- initial on hand
- plus received supplier receipts
- plus manual adjustments
- minus waste
- minus paid-order recipe consumption

### committed
Demand from the current unpaid cart / in-progress guest basket.
Used as an early warning signal.

### available
`current - committed`

### reorder_gap
`max(0, safety_stock - available)`

## Pragmatic MVP limitations

- no batch/lot tracking yet
- no split tender persistence yet
- no reservation ledger yet
- no purchase price history yet
- no per-ingredient unit conversion engine yet

These should be added when the MVP moves from demo-state to persisted module state.
