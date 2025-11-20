#!/bin/bash
#
# av1an installer/updater for FileFlows Docker
#
# Installs and compiles Av1an and required dependencies (zimg, VapourSynth, l-smash) from source
#
# Usage:
#   ./av1an.sh           # install or update
#   ./av1an.sh --uninstall
#   ./av1an.sh --help

set -euo pipefail

# Configuration
TARGET_DIR="/usr/local/av1an"
VERSION_FILE="$TARGET_DIR/version.txt"
ZIMG_REPO="https://github.com/sekrit-twc/zimg.git"
VASynth_REPO="https://github.com/vapoursynth/vapoursynth.git"
AV1AN_REPO="https://github.com/master-of-zen/Av1an.git"
WORK_DIR="/tmp/av1an-source"
LSMASH_REPO="https://github.com/l-smash/l-smash.git"
LSMASH_WORKS_REPO="https://github.com/HomeOfAviSynthPlusEvolution/L-SMASH-Works.git"
VS_ZIP_REPO="https://github.com/dnjulek/vapoursynth-zip"
BESTSOURCE_REPO="https://github.com/vapoursynth/bestsource.git"

# Helpers
log() { echo "[INFO]  $*"; }
error() {
  echo "[ERROR] $*" >&2
  exit 1
}

show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTION]

Options:
  -u, --uninstall    Remove Av1an and dependencies
  -h, --help         Show this help message

Installs Av1an and required dependencies (zimg, VapourSynth) from source.
Will recompile all components each time unless version matches.
EOF
  exit 0
}

uninstall() {
  log "Uninstalling Av1an"

  # Remove binaries
  if command -v av1an &>/dev/null; then
    log "Removing av1an binary"
    sudo rm /usr/local/bin/av1an
  fi

  # Remove version file
  if [ -f "$VERSION_FILE" ]; then
    sudo rm "$VERSION_FILE"
  fi

  ./configure --prefix=/usr --enable-shared --disable-static # Remove source directories
  if [ -d "$WORK_DIR" ]; then
    sudo rm -rf "$WORK_DIR"
  fi

  log "Av1an uninstalled"
  exit 0
}

install_deps() {
  log "Installing dependencies"

  sudo apt update
  sudo apt install -y \
    build-essential \
    aom-tools \
    nasm \
    svt-av1 \
    libxxhash-dev \
    xxhash \
    libtool \
    python3-pip \
    mkvtoolnix \
    python3 \
    clang \
    autoconf \
    automake \
    pkg-config \
    ffmpeg \
    libavformat-dev \
    libavfilter-dev \
    libavdevice-dev \
    python3-dev \
    python3-venv python3-setuptools \
    meson \
    ninja-build \
    wget \
    jq

  log "Dependencies installed"
}

build_zimg() {
  log "Building zimg"

  if [ -d "$WORK_DIR/zimg" ]; then
    log "Removing old zimg source"
    sudo rm -rf "$WORK_DIR/zimg"
  fi

  git clone "$ZIMG_REPO" "$WORK_DIR/zimg"
  cd "$WORK_DIR/zimg" || exit 1
  git submodule update --init --recursive
  ./autogen.sh
  ./configure --enable-shared
  make -j$(nproc)
  log "Installing zimg"
  sudo make install
  sudo ldconfig
  log "zimg built and installed"
}

build_vapoursynth() {
  log "Building VapourSynth"

  if [ -d "$WORK_DIR/vapoursynth" ]; then
    sudo rm -rf "$WORK_DIR/vapoursynth"
  fi
  log "creating venv for cython"
  if [ -d "$WORK_DIR/venv" ]; then
    sudo rm -rf "$WORK_DIR/venv"
  fi
  apt remove cython3 -y
  python3 -m venv "$WORK_DIR/venv"
  source "$WORK_DIR/venv/bin/activate"
  pip install -U cython

  git clone "$VASynth_REPO" "$WORK_DIR/vapoursynth"
  cd "$WORK_DIR/vapoursynth" || exit 1

  git checkout R71
  ./autogen.sh
  PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH:-}" ./configure --enable-shared
  make -j$(nproc)
  log "Installing vapoursynth"
  sudo make install
  sudo ldconfig

  deactivate # venv
  log "exiting venv"
  log "installing VapourSynth python bindings"
  sudo python3 setup.py install
  sudo ldconfig
  # Create symlinks if needed
  if [ ! -f /usr/lib/libvapoursynth.so ] && [ -f /usr/local/lib/libvapoursynth.so ]; then
    sudo ln -sf /usr/local/lib/libvapoursynth* /usr/lib/
  fi

  log "VapourSynth built and installed"
}

build_lsmash() {
  log "building lsmash"

  if [ -d "$WORK_DIR/lsmash" ]; then
    sudo rm -rf "$WORK_DIR/lsmash"
  fi
  git clone "$LSMASH_REPO" "$WORK_DIR/lsmash"
  cd "$WORK_DIR/lsmash" || exit 1
  git checkout v2.14.5
  ./configure --prefix=/usr --enable-shared --disable-static
  make -j$(nproc)
  sudo make install
  sudo ldconfig
  log "lsmash installed"
}

build_lsmash_works() {
  log "building lsmash-works"

  if [ -d "$WORK_DIR/lsmash-works" ]; then
    sudo rm -rf "$WORK_DIR/lsmash-works"
  fi
  git clone --recurse-submodules --shallow-submodules --remote-submodules "$LSMASH_WORKS_REPO" "$WORK_DIR/lsmash-works"
  cd "$WORK_DIR/lsmash-works/VapourSynth" || exit 1
  git reset --hard a090a57
  mkdir build && cd build
  meson .. \
    --prefix=/usr \
    --libdir=/usr/local/lib/vapoursynth
  ninja -j$(nproc)
  sudo ninja install
  sudo ldconfig
  log "lsmash-works installed"

}

build_bestsource() {
  log "building bestsource"

  if [ -d "$WORK_DIR/bestsource" ]; then
    sudo rm -rf "$WORK_DIR/bestsource"
  fi
  git clone "$BESTSOURCE_REPO" $WORK_DIR/bestsource --recurse-submodules --shallow-submodules --remote-submodules
  cd $WORK_DIR/bestsource
  git checkout R8 #thanks for ancient deps, ubuntu
  meson setup build
  ninja -C build
  ninja -C build install
  log "bestsource installed"
}

install_rust() {
  log "Installing Rust"

  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  log "Rust installed"
}

build_av1an() {
  log "Building Av1an"

  if [ -d "$WORK_DIR/Av1an" ]; then
    sudo rm -rf "$WORK_DIR/Av1an"
  fi

  git clone "$AV1AN_REPO" "$WORK_DIR/Av1an"
  cd "$WORK_DIR/Av1an" || exit 1

  # Make sure Rust is available
  source "$HOME/.cargo/env"

  # Set library path for compilation
  export LD_LIBRARY_PATH="/usr/local/lib:${LD_LIBRARY_PATH:-}"
  export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

  cargo build --release
  sudo cp target/release/av1an /usr/local/bin/
  sudo chmod +x /usr/local/bin/av1an
  log "Av1an built and installed"
}

install_ssim2() {
  log "Installing cpu ssim2"

  git clone "$VS_ZIP_REPO" "$WORK_DIR/vapoursynth-zip"
  cd "$WORK_DIR/vapoursynth-zip/build-help" || exit 1

  if ! command -v wget >/dev/null; then
    echo "Error: wget is not installed. Please install wget first."
    exit 1
  fi

  if ! command -v jq >/dev/null; then
    echo "Error: jq is not installed. Please install jq first."
    exit 1
  fi

  ZNAME="zig-x86_64-linux-0.14.1"

  if [ -e "${ZNAME}" ]; then
    echo "Using cached ${ZNAME}"
  else
    echo "Downloading ${ZNAME}..."
    wget "https://ziglang.org/download/0.14.1/zig-x86_64-linux-0.14.1.tar.xz"
    tar -xf "${ZNAME}.tar.xz"
  fi

  cd ..

  echo "Building..."
  "build-help/${ZNAME}/zig" build -Doptimize=ReleaseFast

  echo "Installing libvszip.so to /usr/lib/vapoursynth"
  if [ -e /usr/lib/vapoursynth ]; then
    sudo cp zig-out/lib/libvszip.so /usr/lib/vapoursynth
  else
    sudo mkdir -p /usr/local/lib/vapoursynth
    sudo cp zig-out/lib/libvszip.so /usr/local/lib/vapoursynth
  fi

  log "cpu ssim2 installed"

}

main() {
  if [[ "$*" == *--uninstall* ]]; then
    uninstall
  fi

  if [[ "$*" == *--help* ]]; then
    show_help
  fi

  log "Starting Av1an installation"

  # Create work directory
  mkdir -p "$WORK_DIR"

  install_deps
  build_zimg
  build_vapoursynth
  build_bestsource
  #build_lsmash
  #build_lsmash_works
  install_ssim2
  install_rust
  build_av1an

  log "Av1an installed successfully"
  exit 0
}

main "$@"
