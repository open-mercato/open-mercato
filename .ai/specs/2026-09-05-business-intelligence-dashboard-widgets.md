# Business Intelligence Dashboard Widgets

## Overview

This specification defines three standalone, deterministic business intelligence dashboard widgets for Open Mercato:
1. **Business Health Score**: A composite score (0–100) assessing overall business trajectory across revenue, volume, customer growth, and average order value.
2. **Needs Attention**: A prioritized rule-based alert widget surfacing business anomalies and highlights requiring operational focus.
3. **Executive Brief**: A concise, executive-friendly natural language summary distilling multi-metric performance into actionable insights without relying on external LLM services.

All three widgets leverage Open Mercato's existing analytics aggregation infrastructure (`WidgetDataService`, `useWidgetData`, and `dateRanges`), avoiding code duplication via a shared, pure-function business intelligence utility (`businessIntelligence.ts`).

## Problem Statement

While Open Mercato provides granular KPI cards (`revenue-kpi`, `orders-kpi`, `aov-kpi`, `new-customers-kpi`) and visual charts, business operators and executives must mentally synthesize disparate metrics to gauge holistic health, prioritize operational fires, and brief leadership. 

Furthermore, introducing third-party LLM dependencies for basic metric summarization introduces latency, API costs, privacy concerns, and non-deterministic variability into core dashboards.

## Proposed Solution

1. **Shared Business Intelligence Domain Logic (`businessIntelligence.ts`)**:
   - Pure, deterministic functions with comprehensive unit test coverage.
   - Transparent, weighted scoring model (Revenue: 35%, Orders: 25%, AOV: 20%, Customer Growth: 20%).
   - Explicit thresholds for critical declines, operational warnings, and positive milestones.
   - Template-based, factual natural language generator that eliminates LLM hallucinations and causal guesswork.
   - Shared analytics batch-fetching helper reusing `WidgetDataBatchProvider`.

2. **Widget 1: Business Health Score (`dashboards.analytics.businessHealthScore`)**:
   - Category: `analytics`, Size: `sm`, Features: `['analytics.view']`
   - Numeric score (0–100) with visual indicator and semantic status (`Healthy`, `Watch`, `Critical`).
   - Factual summary of primary positive and drag factors.

3. **Widget 2: Needs Attention (`dashboards.analytics.needsAttention`)**:
   - Category: `analytics`, Size: `md`, Features: `['analytics.view']`
   - Categorized and prioritized alert items: Critical (Red) > Warning (Amber) > Positive (Green).
   - Graceful empty state ("All key metrics are stable or within normal operating range").

4. **Widget 3: Executive Brief (`dashboards.analytics.executiveBrief`)**:
   - Category: `analytics`, Size: `md`, Features: `['analytics.view']`
   - Structured headline, narrative paragraph, and key metric bullet takeaways.
   - Factual prose with strict avoidance of unsupported causal assertions.

## Security & Access Control

- Requires `analytics.view` permission for access.
- Inherits tenant and organization scoping automatically via `WidgetDataService`.

## Changelog

### 2026-09-05
- Initial specification for Business Health Score, Needs Attention, and Executive Brief dashboard widgets.
