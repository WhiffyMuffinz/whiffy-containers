#!/bin/bash
set -euo pipefail

# Configuration from Environment Variables
ZIMG_VERSION="${ZIMG_VERSION:-release-3.0.5}"
VAPOURSYNTH_VERSION="${VAPOURSYNTH_VERSION:-R70}"
AV1AN_VERSION="${AV1AN_VERSION:-master}"
LSMASH_VERSION="${LSMASH_VERSION:-v2.14.5}"
LSMASH_WORKS_VERSION="${LSMASH_WORKS_VERSION:-a090a57}"
BESTSOURCE_VERSION="${BESTSOURCE_VERSION:-R8}"

WORK_DIR="/tmp/av1an-source"
TARGET_DIR="/usr/local"

# Repositories
ZIMG_REPO="https://github.com/sekrit-twc/zimg.git"
VASynth_REPO="https://github.com/vapoursynth/vapoursynth.git"
AV1AN_REPO="https://github.com/master-of-zen/Av1an.git"
LSMASH_REPO="https://github.com/l-smash/l-smash.git"
LSMASH_WORKS_REPO="https://github.com/HomeOfAviSynthPlusEvolution/L-SMASH-Works.git"
VS_ZIP_REPO="https://github.com/dnjulek/vapoursynth-zip"
BESTSOURCE_REPO="https://github.com/vapoursynth/bestsource.git"

log() { echo "[INFO]  $*"; }

install_deps() {
  log "Installing dependencies"
  apt-get update
  apt-get install -y \
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
    libavformat-dev \
    libavfilter-dev \
    libavdevice-dev \
    python3-dev \
    python3-venv python3-setuptools \
    meson \
    ninja-build \
    wget \
    jq \
    git
}

build_zimg() {
  log "Building zimg ${ZIMG_VERSION}"
  git clone "$ZIMG_REPO" "$WORK_DIR/zimg"
  cd "$WORK_DIR/zimg"
  git checkout "$ZIMG_VERSION"
  git submodule update --init --recursive
  ./autogen.sh
  ./configure --enable-shared
  make -j$(nproc)
  make install
  ldconfig
}

build_vapoursynth() {
  log "Building VapourSynth ${VAPOURSYNTH_VERSION}"
  
  # Setup venv for cython
  python3 -m venv "$WORK_DIR/venv"
  source "$WORK_DIR/venv/bin/activate"
  pip install -U cython

  git clone "$VASynth_REPO" "$WORK_DIR/vapoursynth"
  cd "$WORK_DIR/vapoursynth"
  git checkout "$VAPOURSYNTH_VERSION"
  ./autogen.sh
  PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH:-}" ./configure --enable-shared
  make -j$(nproc)
  make install
  ldconfig

  deactivate
  python3 setup.py install
  ldconfig
  
  # Symlinks
  if [ ! -f /usr/lib/libvapoursynth.so ] && [ -f /usr/local/lib/libvapoursynth.so ]; then
    ln -sf /usr/local/lib/libvapoursynth* /usr/lib/
  fi
}

build_lsmash() {
    log "Building lsmash ${LSMASH_VERSION}"
    git clone "$LSMASH_REPO" "$WORK_DIR/lsmash"
    cd "$WORK_DIR/lsmash"
    git checkout "$LSMASH_VERSION"
    ./configure --prefix=/usr --enable-shared --disable-static
    make -j$(nproc)
    make install
    ldconfig
}

build_lsmash_works() {
    log "Building lsmash-works ${LSMASH_WORKS_VERSION}"
    git clone --recurse-submodules --shallow-submodules --remote-submodules "$LSMASH_WORKS_REPO" "$WORK_DIR/lsmash-works"
    cd "$WORK_DIR/lsmash-works/VapourSynth"
    git reset --hard "$LSMASH_WORKS_VERSION"
    mkdir build && cd build
    meson .. \
      --prefix=/usr \
      --libdir=/usr/local/lib/vapoursynth
    ninja -j$(nproc)
    ninja install
    ldconfig
}

build_bestsource() {
  log "Building bestsource ${BESTSOURCE_VERSION}"
  git clone "$BESTSOURCE_REPO" "$WORK_DIR/bestsource" --recurse-submodules --shallow-submodules --remote-submodules
  cd "$WORK_DIR/bestsource"
  git checkout "$BESTSOURCE_VERSION"
  meson setup build
  ninja -C build
  ninja -C build install
}

install_ssim2() {
  log "Installing cpu ssim2"
  git clone "$VS_ZIP_REPO" "$WORK_DIR/vapoursynth-zip"
  cd "$WORK_DIR/vapoursynth-zip/build-help"
  
  ZNAME="zig-x86_64-linux-0.14.1"
  wget "https://ziglang.org/download/0.14.1/zig-x86_64-linux-0.14.1.tar.xz"
  tar -xf "${ZNAME}.tar.xz"
  
  cd ..
  "build-help/${ZNAME}/zig" build -Doptimize=ReleaseFast
  
  mkdir -p /usr/local/lib/vapoursynth
  cp zig-out/lib/libvszip.so /usr/local/lib/vapoursynth
}

install_rust() {
  log "Installing Rust"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
}

build_av1an() {
  log "Building Av1an ${AV1AN_VERSION}"
  git clone "$AV1AN_REPO" "$WORK_DIR/Av1an"
  cd "$WORK_DIR/Av1an"
  git checkout "$AV1AN_VERSION"
  
  source "$HOME/.cargo/env"
  export LD_LIBRARY_PATH="/usr/local/lib:${LD_LIBRARY_PATH:-}"
  export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
  
  cargo build --release
  cp target/release/av1an /usr/local/bin/
  chmod +x /usr/local/bin/av1an
}

main() {
  mkdir -p "$WORK_DIR"
  install_deps
  build_zimg
  build_vapoursynth
  build_bestsource
  # build_lsmash # Commented out in original script, keeping it that way unless requested
  # build_lsmash_works # Commented out in original script
  install_ssim2
  install_rust
  build_av1an
  
  # Cleanup
  rm -rf "$WORK_DIR"
  rm -rf "$HOME/.cargo"
  rm -rf "$HOME/.rustup"
  apt-get clean
  rm -rf /var/lib/apt/lists/*
}

main
