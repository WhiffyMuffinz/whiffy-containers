#!/bin/bash

# Function to handle errors
function handle_error {
    echo "An error occurred. Exiting..."
    exit 1
}

# Check if the --uninstall option is provided
if [ "$1" == "--uninstall" ]; then
    echo "Uninstalling dovi_tool..."
    if rm -f /bin/dovi_tool; then
        echo "dovi_tool successfully uninstalled."
        exit 0
    else
        handle_error
    fi
fi

# Check if dovi_tool is installed
if command -v dovi_tool &>/dev/null; then
    echo "already installed."
    exit 0
fi

echo "dovi_tool is not installed. Installing..."

# Update package lists and install dependencies
if ! apt-get -qq update || ! apt-get install -yqq libfontconfig-dev; then
    handle_error
fi

# Install dovi_tool
wget --no-verbose -O /tmp/dovi_tool.tar.gz $(curl https://api.github.com/repos/quietvoid/dovi_tool/releases/latest | grep 'browser_' | grep -m 1 x86_64-unknown-linux | cut -d\" -f4)
tar xvf /tmp/dovi_tool.tar.gz
mv dovi_tool /bin
rm /tmp/dovi_tool.tar.gz

echo "Installation complete."

# Verify installation
if command -v dovi_tool &>/dev/null; then
    echo "Successfully installed."
    exit 0
fi

echo "Failed to install."
exit 1