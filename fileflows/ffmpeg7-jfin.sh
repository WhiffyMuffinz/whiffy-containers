#!/bin/bash

# Function to handle errors
function handle_error {
    echo "An error occurred. Exiting..."
    exit 1
}

# Check if the --uninstall option is provided
if [ "$1" == "--uninstall" ]; then
    echo "Uninstalling FFmpeg and removing Jellyfin repository..."
    # Remove symbolic links
    rm -f /usr/local/bin/ffmpeg
    rm -f /usr/local/bin/ffprobe
    
    # Uninstall Jellyfin FFmpeg
    if apt-get remove --purge -y jellyfin-ffmpeg7; then
        echo "Jellyfin FFmpeg successfully uninstalled."
    else
        handle_error
    fi
    
    # Remove Jellyfin repository
    rm -f /etc/apt/sources.list.d/jellyfin.list
    
    # Remove Jellyfin GPG key
    gpg --keyring /etc/apt/trusted.gpg.d/debian-jellyfin.gpg --batch --yes --delete-key "$(gpg --list-keys --keyring /etc/apt/trusted.gpg.d/debian-jellyfin.gpg --batch | grep -B 1 'Jellyfin Team' | head -n 1 | awk '{print $1}')"
    rm -f "/etc/apt/trusted.gpg.d/debian-jellyfin.gpg"
    rm -f "/etc/apt/trusted.gpg.d/debian-jellyfin.gpg~"
    
    # Update package lists
    if ! apt-get update; then
        handle_error
    fi
    
    echo "Uninstallation complete."
    exit 0
fi

# Check if FFmpeg is installed
if command -v ffmpeg &>/dev/null; then
    echo "FFmpeg is already installed."
    exit 0
fi

architecture=$(uname -m)
echo "Architecture: $architecture"

if [ "$architecture" != "x86_64" ] && [ "$architecture" != "armv7l" ] && [ "$architecture" != "aarch64" ] && [[ ! "$architecture" =~ [Aa][Rr][Mm] ]]; then
    echo "The architecture is not recognized as AMD or ARM: $architecture."
    exit 1
fi

echo "The architecture is recognized."

# Add Jellyfin GPG key with a timeout of 15 seconds
if ! curl -m 15 -fsSL https://repo.jellyfin.org/debian/jellyfin_team.gpg.key | gpg --dearmor --batch --yes -o /etc/apt/trusted.gpg.d/debian-jellyfin.gpg; then
    handle_error
fi

# Add Jellyfin repository
os_id=$(awk -F'=' '/^ID=/{ print $NF }' /etc/os-release)
os_codename=$(awk -F'=' '/^VERSION_CODENAME=/{ print $NF }' /etc/os-release)
echo "deb [arch=$(dpkg --print-architecture)] https://repo.jellyfin.org/$os_id $os_codename main" | tee /etc/apt/sources.list.d/jellyfin.list

# Update package lists again
if ! apt-get update; then
    handle_error
fi

# Install Jellyfin FFmpeg
if ! apt-get install --no-install-recommends --no-install-suggests -y jellyfin-ffmpeg7; then
    handle_error
fi

# Create symbolic links
ln -s /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg
ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe

echo "FFmpeg installation and setup complete."
exit 0