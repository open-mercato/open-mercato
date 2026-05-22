#!/bin/bash
# ds-health-check.sh — run every sprint
# Usage: bash .ai/skills/ds-guardian/scripts/ds-health-check.sh
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

count_matches() {
  local pattern="$1"
  { grep -r -E "$pattern" \
    --include='*.ts' --include='*.tsx' \
    packages/ apps/ \
    2>/dev/null \
    | grep -v '__tests__' | grep -v 'node_modules' | grep -v '.generated.' \
    || true; } | wc -l | tr -d ' '
}

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
report "--- Raw HTML Form Controls (use DS primitives) ---"
RAW_TEXT_INPUT=$(count_matches '<input[^>]*type=["'\''](text|email|password|number|tel|url|search)["'\'']')
report "  Raw <input type='text|email|password|number|tel|url|search'>: $RAW_TEXT_INPUT (target: 0)"
RAW_CHECKBOX=$(count_matches '<input[^>]*type=["'\'']checkbox["'\'']')
report "  Raw <input type='checkbox'>: $RAW_CHECKBOX (target: 0)"
RAW_RADIO=$(count_matches '<input[^>]*type=["'\'']radio["'\'']')
report "  Raw <input type='radio'>: $RAW_RADIO (target: 0)"
RAW_SELECT=$(count_matches '<select[ >]')
report "  Raw <select>: $RAW_SELECT (target: 0)"
RAW_TEXTAREA=$(count_matches '<textarea[ >]')
report "  Raw <textarea>: $RAW_TEXTAREA (target: 0)"
CUSTOM_SWITCH=$(count_matches 'role=["'\'']switch["'\'']')
report "  Custom role='switch': $CUSTOM_SWITCH (target: 0)"

report ""
report "--- Disabled state (use --bg-disabled / --text-disabled tokens) ---"
OPACITY_DISABLED=$(count_matches 'disabled:opacity-50')
report "  disabled:opacity-50: $OPACITY_DISABLED (target: 0)"

report ""
report "--- Selection control color contract (use --accent-indigo) ---"
WRONG_SELECTION_COLOR=$(count_matches 'data-\[state=checked\]:bg-primary')
report "  data-[state=checked]:bg-primary on selection controls: $WRONG_SELECTION_COLOR (target: 0)"

report ""
report "--- Brand colors hardcoded (use --brand-* tokens / SocialButton) ---"
BRAND_HEX=$(count_matches '#1877F2|#0A66C2|#0061FF|#181717|#BC9AFF|#D4F372')
report "  Hardcoded brand hex: $BRAND_HEX (target: 0)"

report ""
report "--- Old focus rings (use --shadow-focus token) ---"
OLD_FOCUS=$(count_matches 'focus.*ring-2.*ring-offset-2')
report "  focus:ring-2 ring-offset-2: $OLD_FOCUS (target: 0)"

report ""
report "=== END REPORT ==="

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
