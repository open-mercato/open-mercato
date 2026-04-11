#!/bin/bash
# ds-health-check.sh — uruchamiac co sprint
# Uzycie: bash .ai/scripts/ds-health-check.sh
# Portable: dziala na macOS i Linux

set -euo pipefail

REPORT_DIR=".ai/reports"
mkdir -p "$REPORT_DIR"

DATE=$(date +%Y-%m-%d)
REPORT_FILE="$REPORT_DIR/ds-health-$DATE.txt"

# Funkcja zapisu do stdout i pliku jednoczesnie
report() {
  echo "$1" | tee -a "$REPORT_FILE"
}

# Wyczysc plik raportu (nowy raport)
> "$REPORT_FILE"

report "=== DESIGN SYSTEM HEALTH CHECK ==="
report "Date: $DATE"
report ""

report "--- Hardcoded Status Colors ---"
HC=$(rg 'text-red-[0-9]|bg-red-[0-9]|border-red-[0-9]|text-green-[0-9]|bg-green-[0-9]|border-green-[0-9]|text-emerald-[0-9]|bg-emerald-[0-9]|border-emerald-[0-9]|text-amber-[0-9]|bg-amber-[0-9]|border-amber-[0-9]|text-blue-[0-9]|bg-blue-[0-9]|border-blue-[0-9]' \
  --type tsx --glob '!**/__tests__/**' --glob '!**/node_modules/**' -c 2>/dev/null | \
  awk -F: '{s+=$2} END{print s+0}')
report "  Count: $HC (target: 0)"

report ""
report "--- Arbitrary Text Sizes ---"
AT=$(rg 'text-\[\d+px\]' --type tsx --glob '!**/__tests__/**' -c 2>/dev/null | \
  awk -F: '{s+=$2} END{print s+0}')
report "  Count: $AT (target: 1)"

report ""
report "--- Deprecated Notice Usage ---"
NC=$(rg "from.*primitives/Notice" --type tsx -l 2>/dev/null | wc -l | tr -d ' ')
report "  Notice imports: $NC (target: 0)"
EN=$(rg "ErrorNotice" --type tsx -l 2>/dev/null | wc -l | tr -d ' ')
report "  ErrorNotice imports: $EN (target: 0)"

report ""
report "--- Inline SVG ---"
SVG=$(rg '<svg' --type tsx --glob '!**/__tests__/**' --glob '!**/node_modules/**' -l 2>/dev/null | wc -l | tr -d ' ')
report "  Files with inline SVG: $SVG (target: 0)"

report ""
report "--- Raw fetch() in Backend ---"
RF=$(rg 'fetch\(' --type tsx --glob '**/backend/**' --glob '!**/node_modules/**' -l 2>/dev/null | wc -l | tr -d ' ')
report "  Raw fetch files: $RF (target: 0)"

report ""
report "--- Empty State Coverage ---"
PAGES=$(find packages/core/src/modules/*/backend -name "page.tsx" 2>/dev/null | wc -l | tr -d ' ')
ES=$(rg 'EmptyState|TabEmptyState' --type tsx --glob '**/backend/**/page.tsx' -l 2>/dev/null | wc -l | tr -d ' ')
PCT=$(( ES * 100 / PAGES ))
report "  Pages with empty state: $ES / $PAGES ($PCT%)"

report ""
report "--- Loading State Coverage ---"
LS=$(rg 'LoadingMessage|isLoading|Spinner' --type tsx --glob '**/backend/**/page.tsx' -l 2>/dev/null | wc -l | tr -d ' ')
LPCT=$(( LS * 100 / PAGES ))
report "  Pages with loading state: $LS / $PAGES ($LPCT%)"

report ""
report "=== END REPORT ==="

# Porownanie z poprzednim raportem
PREV=$(ls -1 "$REPORT_DIR"/ds-health-*.txt 2>/dev/null | grep -v "$DATE" | sort | tail -1)
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
