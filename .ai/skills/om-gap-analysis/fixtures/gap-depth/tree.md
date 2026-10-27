---
project: fixture-depth
phase: 3-synthesizing
coverage_categories:
  - error-path
---

# Gap Analysis — Fixture Depth

## Epic 3: Fulfillment

#### Coverage
- error-path: Story 3.1

### Story 3.1: Bulk order sync via ShipSync
- **Description**: as a warehouse manager, I sync order status via ShipSync
- **Acceptance criteria**:
  - [ ] order status can be synced via ShipSync on demand
- **Status**: done

#### Gap analysis
- **Verdict**: ❌ Missing
- **Upstream pipeline**: companion PR #29 (open)

### Story 3.2: Shipment tracking number formatting
- **Description**: as a warehouse manager, exported tracking numbers are formatted correctly
- **Acceptance criteria**:
  - [ ] numbers follow the configured format
- **Status**: done

#### Gap analysis
- **Verdict**: ❌ Missing
- **Upstream pipeline**: PR #15 (open)
