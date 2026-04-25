#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
FETCHER="$ROOT_DIR/.ai/skills/wic-evaluator/scripts/wic_data_fetcher.mjs"

PROFILES=""
FROM=""
TO=""
OUTPUT=""
REPO="open-mercato/open-mercato"
FORMAT="markdown"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profiles)
      PROFILES="${2:-}"
      shift 2
      ;;
    --from)
      FROM="${2:-}"
      shift 2
      ;;
    --to)
      TO="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --format)
      FORMAT="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PROFILES" || -z "$FROM" || -z "$TO" || -z "$OUTPUT" ]]; then
  echo "Usage: $0 --profiles <logins> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --output <path> [--repo <owner/repo>] [--format markdown|json]" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
node "$FETCHER" --profiles "$PROFILES" --from "$FROM" --to "$TO" --repo "$REPO" --format "$FORMAT" > "$OUTPUT"
echo "Saved frozen WIC fixture to $OUTPUT"
