#!/bin/bash
# Version bump rules for mineru
# Usage: ./version-bump.sh <current_version>
# Output: New version string

CURRENT="$1"

# Get script directory
SCRIPT_DIR="$(dirname "$0")"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"

# Extract mineru version from Dockerfile ARG line
# Look for: ARG MINERU_VERSION=X.Y.Z
VERSION=$(grep -oP "ARG MINERU_VERSION=\K[0-9]+\.[0-9]+\.[0-9]+" "$DOCKERFILE")

if [ -z "$VERSION" ]; then
    echo "Error: Could not extract mineru version from Dockerfile" >&2
    exit 1
fi

echo "$VERSION"
