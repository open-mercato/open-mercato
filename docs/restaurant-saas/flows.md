# Restaurant SaaS MVP Key Flows

## 1. Customer order from table

1. Guest scans QR and lands on `/restaurant/table/t12`
2. The UI already knows the table context
3. Guest browses menu categories
4. Guest adds dishes to cart and writes notes
5. Checkout models online payment
6. On success, a paid order is created and added to the kitchen queue

## 2. Kitchen execution

1. Kitchen sees new paid orders ordered by priority
2. Staff starts preparation
3. Staff marks order as ready
4. Ready order becomes visible to floor staff

## 3. Floor delivery

1. Floor panel only shows ready orders
2. The target table is explicit
3. Waiter delivers to the correct table
4. Order is marked served

## 4. Inventory reaction

### On sale
- recipe lines are expanded per sold menu item
- ingredient consumption is deducted automatically
- admin sees current stock and available stock immediately

### On supplier invoice / receipt
- admin registers a pending receipt as received
- receipt quantities increase stock for linked ingredients
- replenishment pressure decreases

## 5. Operational analytics

The dashboard surfaces a basic but useful operating view:

- paid order count
- revenue snapshot
- average ticket
- ready vs preparing orders
- ingredients below safety stock

## Honest MVP shortcuts

- payment is modeled, not gateway-backed yet
- data is seeded/in-memory, not persisted yet
- committed stock is cart-based, not reservation-ledger based

These shortcuts are intentional and visible so the next implementation phase can replace them cleanly.


## 6. Invalid table handling

- The table route now fails closed.
- Unknown table ids return a not-found state instead of falling back to another table.
- This protects the core operational invariant that every order must remain tied to the correct physical table.
