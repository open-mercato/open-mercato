#!/bin/bash
# Create a user for publishing to the local registry

REGISTRY_URL="${VERDACCIO_URL:-http://localhost:4873}"

# Check if registry is running
if ! curl -s "$REGISTRY_URL/-/ping" > /dev/null 2>&1; then
  echo "Error: Verdaccio registry is not running at $REGISTRY_URL"
  echo "Run 'docker compose up -d verdaccio' first"
  exit 1
fi

npm adduser --registry "$REGISTRY_URL"
