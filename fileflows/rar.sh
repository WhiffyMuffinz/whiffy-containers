#!/bin/bash

# Function to handle errors
function handle_error {
    echo "An error occurred. Exiting..."
    exit 1
}

# Check if the --uninstall option is provided
if [ "$1" == "--uninstall" ]; then
    echo "Uninstalling Rar..."
    if apt-get remove -y rar unrar; then
        echo "Rar successfully uninstalled."
        exit 0
    else
        handle_error
    fi
fi


# Check if rar is installed
if command -v unrar &>/dev/null; then
    echo "rar is already installed."
    exit 0
fi

echo "rar is not installed. Installing..."

# Update package lists and install rar
if ! apt update || ! apt install -y rar unrar; then
    handle_error
fi

echo "Installation complete."

# Verify installation
if command -v unrar &>/dev/null; then
    echo "rar successfully installed."
    exit 0
fi

echo "Failed to install rar."
exit 1