#!/bin/bash
# Version bump rules for fileflows
# Usage: ./version-bump.sh <current_version> <upstream_version>
# Output: New version string

CURRENT_VERSION="$1"
UPSTREAM_VERSION="$2"

# Get script directory
SCRIPT_DIR="$(dirname "$0")"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
DEPS_FILE="$SCRIPT_DIR/VERSION.deps"

CURRENT_MAJOR_MINOR=$(echo "$CURRENT_VERSION" | cut -d'.' -f1-2)
CURRENT_PATCH=$(echo "$CURRENT_VERSION" | cut -d'.' -f3)

# Extract upstream fileflows version from Dockerfile
extract_upstream_version() {
    local df="$1"
    grep -oP 'COPY --from=revenz/fileflows:\K[0-9]+\.[0-9]+' "$df" | head -1
}

# Extract dependency versions from Dockerfile
extract_dep_versions() {
    local df="$1"
    grep -oP 'ARG (AV1AN|AB_AV1|DOVI_TOOL|ZIMG|SVT|VAPOURSYNTH|BESTSOURCE|VSHIP|AV_SCENECHANGE)_VERSION=\K[^ ]+' "$df" | sort
}

# Compute hash of dependency versions
compute_deps_hash() {
    local deps="$1"
    echo "$deps" | sha256sum | cut -d' ' -f1
}

# Get upstream version from Dockerfile
DOCKERFILE_UPSTREAM=$(extract_upstream_version "$DOCKERFILE")

# Get current dependency versions and hash
CURRENT_DEPS=$(extract_dep_versions "$DOCKERFILE")
CURRENT_DEPS_HASH=$(compute_deps_hash "$CURRENT_DEPS")

# Get previous dependency hash from VERSION.deps file
PREVIOUS_DEPS_HASH=""
if [ -f "$DEPS_FILE" ]; then
    PREVIOUS_DEPS_HASH=$(cat "$DEPS_FILE")
fi

# Detect what changed
UPSTREAM_CHANGED=0
DEPS_CHANGED=0

if [ "$DOCKERFILE_UPSTREAM" != "$CURRENT_MAJOR_MINOR" ]; then
    UPSTREAM_CHANGED=1
fi

if [ -n "$CURRENT_DEPS_HASH" ] && [ "$CURRENT_DEPS_HASH" != "$PREVIOUS_DEPS_HASH" ]; then
    DEPS_CHANGED=1
fi

# Apply version bump rules
if [ "$UPSTREAM_CHANGED" = "1" ]; then
    # Upstream major.minor changed: update major.minor, reset patch to .0
    NEW_VERSION="${DOCKERFILE_UPSTREAM}.0"
elif [ "$DEPS_CHANGED" = "1" ]; then
    # Only dependency versions changed: increment patch
    NEW_PATCH=$((CURRENT_PATCH + 1))
    NEW_VERSION="${CURRENT_MAJOR_MINOR}.${NEW_PATCH}"
else
    # Nothing changed: keep version unchanged
    NEW_VERSION="$CURRENT_VERSION"
fi

# Update dependency hash file
echo "$CURRENT_DEPS_HASH" > "$DEPS_FILE"

echo "$NEW_VERSION"
