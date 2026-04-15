#!/bin/bash
# Version bump rules for fileflows
# Usage: ./version-bump.sh <current_version> <upstream_version>
# Output: New version string

CURRENT_VERSION="$1"
UPSTREAM_VERSION="$2"

# Get script directory
SCRIPT_DIR="$(dirname "$0")"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
CURRENT_MAJOR_MINOR=$(echo "$CURRENT_VERSION" | cut -d'.' -f1-2)
CURRENT_PATCH=$(echo "$CURRENT_VERSION" | cut -d'.' -f3)

# Extract upstream fileflows version from Dockerfile
extract_upstream_version() {
    local df="$1"
    grep -oP 'COPY --from=revenz/fileflows:\K[0-9]+\.[0-9]+' "$df" | head -1
}

# Check if upstream reference is digest-based (contains @sha256)
is_digest_based() {
    local df="$1"
    grep -q 'COPY --from=revenz/fileflows:[^ ]*@sha256' "$df"
    return $?
}

# Extract dependency versions from Dockerfile
extract_dep_versions() {
    local df="$1"
    grep -oP 'ARG (AV1AN|AB_AV1|DOVI_TOOL|ZIMG|SVT|VAPOURSYNTH|BESTSOURCE|VSHIP)_VERSION=\K[^ ]+' "$df" | sort
}

# Get upstream version from Dockerfile
DOCKERFILE_UPSTREAM=$(extract_upstream_version "$DOCKERFILE")

# Check if current is digest-based
CURRENT_IS_DIGEST=$(is_digest_based "$DOCKERFILE" && echo "1" || echo "0")

# Get dependency versions
DEP_VERSIONS=$(extract_dep_versions "$DOCKERFILE")

# Detect what changed
UPSTREAM_CHANGED=0
DEPS_CHANGED=0
DIGEST_ONLY=0

# Check if upstream major.minor changed
if [ "$DOCKERFILE_UPSTREAM" != "$CURRENT_MAJOR_MINOR" ]; then
    UPSTREAM_CHANGED=1
fi

# Check if this is digest-only reference (no upstream version bump, but digest present)
if [ "$CURRENT_IS_DIGEST" = "1" ] && [ "$UPSTREAM_CHANGED" = "0" ]; then
    DIGEST_ONLY=1
fi

# Dependency versions changed (always bump if deps changed and not digest-only)
# We use a hash-based approach to detect changes without storing previous state
# For now, we'll assume deps changed if the script is called (CI run)
# In a real scenario, you'd compare against git history or a stored state
DEPS_CHANGED=1  # Default to true for CI runs, will be overridden by digest check

# Apply version bump rules
if [ "$UPSTREAM_CHANGED" = "1" ]; then
    # Upstream major.minor changed: update major.minor, reset patch to .0
    echo "${DOCKERFILE_UPSTREAM}.0"
elif [ "$DIGEST_ONLY" = "1" ]; then
    # Only digest changed: keep version unchanged
    echo "$CURRENT_VERSION"
elif [ "$DEPS_CHANGED" = "1" ]; then
    # Only dependency versions changed: increment patch
    NEW_PATCH=$((CURRENT_PATCH + 1))
    echo "${CURRENT_MAJOR_MINOR}.${NEW_PATCH}"
else
    # Nothing changed: keep version unchanged
    echo "$CURRENT_VERSION"
fi
