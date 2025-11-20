#!/bin/bash
#
# ab-av1 installer/updater for FileFlows Docker
# 
# Checks GitHub for the latest release, compares to installed version,
# downloads & extracts if newer, and records version. Also can uninstall.
#
# Usage:
#   ./ab-av1.sh           # install or update
#   ./ab-av1.sh --uninstall
#   ./ab-av1.sh --help

set -euo pipefail

# Configuration
TARGET_DIR="/app/Data/tools/ab-av1"
VERSION_FILE="$TARGET_DIR/version.txt"
ARCHIVE_NAME="ab-av1.tar.zst"
ARCHIVE_PATH="$TARGET_DIR/$ARCHIVE_NAME"
REPO_API="https://api.github.com/repos/alexheretic/ab-av1/releases/latest"

# Helpers
log()   { echo "[INFO]  $*"; }
error() { echo "[ERROR] $*" >&2; exit 1; }

show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTION]

Options:
  -u, --uninstall    Remove ab-av1 completely
  -h, --help         Show this help message

With no options, script checks for the latest ab-av1 release,
installs prerequisites (zstd, jq), compares versions, and updates if needed.
EOF
  exit 0
}

do_uninstall() {
  if [[ -d $TARGET_DIR ]]; then
    rm -rf "$TARGET_DIR"
    log "Removed directory $TARGET_DIR"
    log "ab-av1 uninstalled successfully."
  else
    log "Nothing to do: $TARGET_DIR does not exist."
  fi
  exit 0
}

# Parse options
if [[ ${1:-} =~ ^(-h|--help)$ ]]; then
  show_help
elif [[ ${1:-} =~ ^(-u|--uninstall)$ ]]; then
  do_uninstall
elif [[ $# -gt 1 ]]; then
  echo "Unknown arguments: $*" >&2
  show_help
fi

# Ensure prerequisites: curl, zstd, jq
if ! command -v curl &>/dev/null; then
  error "curl is required but not found."
fi

# We need zstd for decompression, jq for JSON parsing
INSTALL_PKGS=()
command -v unzstd &>/dev/null || INSTALL_PKGS+=(zstd)
command -v jq     &>/dev/null || INSTALL_PKGS+=(jq)

if (( ${#INSTALL_PKGS[@]} )); then
  log "Installing prerequisites: ${INSTALL_PKGS[*]}"
  apt-get update -qq
  apt-get install -y "${INSTALL_PKGS[@]}"
fi

# Fetch latest release info
log "Fetching latest release info from GitHub..."
RELEASE_JSON=$(curl -s "$REPO_API") || error "Failed to fetch release info."

# Parse tag_name
LATEST_TAG=$(printf '%s' "$RELEASE_JSON" | jq -r '.tag_name') \
  || error "Failed to parse latest version."

log "Latest version online: $LATEST_TAG"

# Read installed version, if any
INSTALLED_TAG=""
if [[ -f $VERSION_FILE ]]; then
  INSTALLED_TAG=$(<"$VERSION_FILE")
  log "Installed version: $INSTALLED_TAG"
fi

if [[ "$INSTALLED_TAG" == "$LATEST_TAG" ]]; then
  log "ab-av1 is already up-to-date."
  exit 0
fi

log "Updating from '$INSTALLED_TAG' → '$LATEST_TAG'"

# Find the .tar.zst asset URL
ASSET_URL=$(printf '%s' "$RELEASE_JSON" | \
  jq -r '.assets[] | select(.browser_download_url|endswith(".tar.zst")).browser_download_url')

if [[ -z $ASSET_URL ]]; then
  error "No .tar.zst asset found in release $LATEST_TAG"
fi

log "Download URL: $ASSET_URL"

# Ensure target dir exists
mkdir -p "$TARGET_DIR"

# Download archive
log "Downloading archive..."
curl -L --fail -o "$ARCHIVE_PATH" "$ASSET_URL" \
  || error "Download failed."

# Extract
log "Extracting to $TARGET_DIR..."
tar --use-compress-program=unzstd -xvf "$ARCHIVE_PATH" -C "$TARGET_DIR" \
  || error "Extraction failed."

# Record new version
echo "$LATEST_TAG" > "$VERSION_FILE"

log "Update complete: ab-av1 $LATEST_TAG installed in $TARGET_DIR"
exit 0