#!/bin/bash
# ds-health-check.sh — run every sprint
# Usage: bash .ai/scripts/ds-health-check.sh
# Portable: works on macOS and Linux (uses grep, no rg dependency)

set -euo pipefail

REPORT_DIR=".ai/reports"
mkdir -p "$REPORT_DIR"

DATE=$(date +%Y-%m-%d)
REPORT_FILE="$REPORT_DIR/ds-health-$DATE.txt"

report() {
  echo "$1" | tee -a "$REPORT_FILE"
}

> "$REPORT_FILE"

report "=== DESIGN SYSTEM HEALTH CHECK ==="
report "Date: $DATE"
report ""

# Count matching lines across .ts/.tsx files, excluding tests and node_modules
count_matches() {
  local pattern="$1"
  { grep -r -E "$pattern" \
    --include='*.ts' --include='*.tsx' \
    packages/ apps/ \
    2>/dev/null \
    | grep -v '__tests__' | grep -v 'node_modules' | grep -v '.generated.' \
    || true; } | wc -l | tr -d ' '
}

# Count files with at least one match
count_files() {
  local pattern="$1"
  { grep -r -l -E "$pattern" \
    --include='*.ts' --include='*.tsx' \
    packages/ apps/ \
    2>/dev/null \
    | grep -v '__tests__' | grep -v 'node_modules' | grep -v '.generated.' \
    || true; } | wc -l | tr -d ' '
}

report "--- Hardcoded Status Colors ---"
HC=$(count_matches 'text-red-[0-9]|bg-red-[0-9]|border-red-[0-9]|text-green-[0-9]|bg-green-[0-9]|border-green-[0-9]|text-emerald-[0-9]|bg-emerald-[0-9]|border-emerald-[0-9]|text-amber-[0-9]|bg-amber-[0-9]|border-amber-[0-9]|text-blue-[0-9]|bg-blue-[0-9]|border-blue-[0-9]')
report "  Count: $HC (target: 0)"

report ""
report "--- Arbitrary Text Sizes ---"
AT=$(count_matches 'text-\[[0-9]+px\]')
report "  Count: $AT (target: 1)"

report ""
report "--- Deprecated Notice Usage ---"
NC=$(count_files "from.*primitives/Notice")
report "  Notice imports: $NC (target: 0)"
EN=$(count_files "ErrorNotice")
report "  ErrorNotice imports: $EN (target: 0)"

report ""
report "--- Inline SVG ---"
SVG=$(count_files '<svg ')
report "  Files with inline SVG: $SVG (target: 0)"

report ""
report "--- Raw fetch() in Backend ---"
RF=$({ grep -r -l -E 'fetch\(' \
  --include='*.ts' --include='*.tsx' \
  packages/*/src/**/backend/ packages/core/src/modules/*/backend/ apps/*/src/**/backend/ \
  2>/dev/null \
  | grep -v 'node_modules' | grep -v '__tests__' | grep -v 'apiCall' \
  || true; } | wc -l | tr -d ' ')
report "  Raw fetch files: $RF (target: 0)"

report ""
report "--- Empty State Coverage ---"
PAGES=$(find packages/core/src/modules/*/backend -name "page.tsx" 2>/dev/null | wc -l | tr -d ' ')
if [ "$PAGES" -gt 0 ]; then
  ES=$({ grep -r -l -E 'EmptyState|TabEmptyState' \
    --include='page.tsx' \
    packages/core/src/modules/*/backend/ \
    2>/dev/null || true; } | wc -l | tr -d ' ')
  PCT=$(( ES * 100 / PAGES ))
  report "  Pages with empty state: $ES / $PAGES ($PCT%)"
else
  report "  Pages with empty state: N/A (no pages found)"
fi

report ""
report "--- Loading State Coverage ---"
if [ "$PAGES" -gt 0 ]; then
  LS=$({ grep -r -l -E 'LoadingMessage|isLoading|Spinner' \
    --include='page.tsx' \
    packages/core/src/modules/*/backend/ \
    2>/dev/null || true; } | wc -l | tr -d ' ')
  LPCT=$(( LS * 100 / PAGES ))
  report "  Pages with loading state: $LS / $PAGES ($LPCT%)"
else
  report "  Pages with loading state: N/A (no pages found)"
fi

report ""
report "--- Semantic Token Adoption ---"
ST=$(count_matches 'status-error-|status-success-|status-warning-|status-info-|status-neutral-')
report "  Semantic token usages: $ST"

report ""
report "=== END REPORT ==="

# Compare with previous report
PREV=$(ls -1 "$REPORT_DIR"/ds-health-*.txt 2>/dev/null | grep -v "$DATE" | sort | tail -1 || true)
if [ -n "${PREV:-}" ] && [ -f "$PREV" ]; then
  echo ""
  echo "=== DELTA vs $(basename "$PREV") ==="
  diff --unified=0 "$PREV" "$REPORT_FILE" | grep '^[+-]  ' | head -20 || echo "  (no changes)"
else
  echo ""
  echo "=== First report — no previous data to compare ==="
fi

echo ""
echo "Report saved to: $REPORT_FILE"
