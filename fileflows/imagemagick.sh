#!/bin/bash

# Function to handle errors
function handle_error {
    echo "An error occurred. Exiting..."
    exit 1
}

# Check if the --uninstall option is provided
if [ "$1" == "--uninstall" ]; then
    echo "Uninstalling ImageMagick..."
    if apt-get remove -y imagemagick; then
        echo "ImageMagick successfully uninstalled."
        exit 0
    else
        handle_error
    fi
fi

# Check if ImageMagick is installed
if command -v convert &>/dev/null; then
    echo "ImageMagick is already installed."
    exit 0
fi

echo "ImageMagick is not installed. Installing..."

# Update package lists and install ImageMagick
if ! apt update || ! apt install -y imagemagick; then
    handle_error
fi

# Verify installation
if command -v convert &>/dev/null; then
    echo "ImageMagick successfully installed."
    exit 0
fi

echo "Failed to install ImageMagick."
exit 1