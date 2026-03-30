#!/bin/bash
# Install orcha from GitHub Releases
# Usage: curl -fsSL https://raw.githubusercontent.com/aikix/orcha/main/install.sh | bash

set -euo pipefail

REPO="aikix/orcha"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux)  TARGET="linux-x64" ;;
  darwin)
    case "$ARCH" in
      arm64) TARGET="darwin-arm64" ;;
      *)     TARGET="darwin-x64" ;;
    esac
    ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

# Get latest release tag
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST" ]; then
  echo "Could not determine latest release. Install from source:"
  echo "  git clone https://github.com/$REPO && cd orcha && bun install && bun link"
  exit 1
fi

echo "Installing orcha $LATEST ($TARGET)..."

# Download binary
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST/orcha-$TARGET"
mkdir -p "$INSTALL_DIR"
curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/orcha"
chmod +x "$INSTALL_DIR/orcha"

echo "Installed to $INSTALL_DIR/orcha"

# Check if in PATH
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  echo ""
  echo "Add to your PATH:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

echo ""
echo "Run 'orcha --help' to get started."
