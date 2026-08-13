# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32

# ============================================================================
# SHARED BASE STAGE - Common build dependencies
# ============================================================================
FROM rust:1.97@sha256:3382bd20aa942806c533e9a73cd000474fb3ef173f71e684cc9b942675781769 AS rust
FROM docker.io/ubuntu:26.04@sha256:678c6550cc43645e08669028bc177f50be4e7c5b8cca677067b1914d4afc7a03 AS base

ARG DEBIAN_FRONTEND=noninteractive

# Install common build dependencies (shared across all builder stages)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && \
    apt-get install -y sudo tzdata wget ca-certificates gnupg curl tar xz-utils zstd libssl-dev apt-transport-https openssl locales libfontconfig1 libfreetype6 pciutils vainfo git cmake llvm \
    build-essential autoconf automake libtool pkg-config nasm meson ninja-build python3-dev python3-venv python3-setuptools python3-pip libvulkan1 libvulkan-dev mesa-vulkan-drivers libavformat-dev libavfilter-dev libavdevice-dev libavcodec-dev libswscale-dev libxxhash-dev clang libffms2-dev

ENV PKG_CONFIG_PATH="/usr/local/lib/pkgconfig"
ENV CFLAGS="-O3 -march=x86-64-v3"
ENV CXXFLAGS="-O3 -march=x86-64-v3"




# Install Rust (needed for Av1an)
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
RUN /usr/local/cargo/bin/rustup default stable
ENV PATH="/usr/local/cargo/bin:${PATH}"

# Install wild linker for Rust
RUN --mount=type=cache,target=/root/.cargo/registry,sharing=locked \
    --mount=type=cache,target=/root/.cargo/git,sharing=locked \
    cargo install --locked wild-linker && \
    mkdir -p /root/.cargo && \
    printf '[target.x86_64-unknown-linux-gnu]\nlinker = "clang"\nrustflags = ["-Clink-arg=--ld-path=wild", "-Ctarget-cpu=x86-64-v3"]\n' > /root/.cargo/config.toml

# ============================================================================
# INDEPENDENT COMPONENTS - Can be built in parallel, no dependencies
# ============================================================================

# --- Stage: BtbN FFmpeg (static build) ---
FROM base AS ffmpeg-static
ARG FFMPEG_BTBN_VERSION=latest
RUN mkdir -p /opt/ffmpeg-static && \
    if [ "$FFMPEG_BTBN_VERSION" = "latest" ]; then \
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"; \
    else \
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BTBN_VERSION}/ffmpeg-master-${FFMPEG_BTBN_VERSION}-linux64-gpl.tar.xz"; \
    fi && \
    wget -qO- "$FFMPEG_URL" | tar -xJ -C /opt/ffmpeg-static --strip-components=1

# --- Stage: ab-av1 ---
FROM base AS ab-av1
# renovate: datasource=github-releases depName=alexheretic/ab-av1 versioning=semver-coerced
ARG AB_AV1_VERSION=v0.11.5
RUN curl -L -o /tmp/ab-av1.tar.zst "https://github.com/alexheretic/ab-av1/releases/download/${AB_AV1_VERSION}/ab-av1-${AB_AV1_VERSION}-x86_64-unknown-linux-musl.tar.zst" && \
    tar --use-compress-program=unzstd -xvf /tmp/ab-av1.tar.zst -C /usr/local/bin ab-av1 && \
    rm /tmp/ab-av1.tar.zst

# --- Stage: dovi_tool ---
FROM base AS dovi-tool
# renovate: datasource=github-releases depName=quietvoid/dovi_tool versioning=semver-coerced
ARG DOVI_TOOL_VERSION=2.3.3
RUN curl -L "https://github.com/quietvoid/dovi_tool/releases/download/${DOVI_TOOL_VERSION}/dovi_tool-${DOVI_TOOL_VERSION}-x86_64-unknown-linux-musl.tar.gz" | \
    tar -xzvf - -C /usr/local/bin

# --- Stage: zimg ---
FROM base AS zimg
# renovate: datasource=github-releases depName=sekrit-twc/zimg versioning=semver-coerced
ARG ZIMG_VERSION=release-3.0.6
RUN git clone --depth 1 --branch ${ZIMG_VERSION} https://github.com/sekrit-twc/zimg.git /tmp/zimg && \
    cd /tmp/zimg && \
    git submodule update --init --recursive --depth 1 && \
    ./autogen.sh && \
    ./configure --enable-shared && \
    make -j$(nproc) && \
    make install && \
    ldconfig && \
    rm -rf /tmp/zimg

# --- Stage: svt-av1 ---
FROM base AS svt-av1
# renovate: datasource=gitlab-releases depName=AOMediaCodec/SVT-AV1 versioning=semver-coerced
ARG SVT_VERSION=v4.2.0
RUN git clone --depth 1 --branch ${SVT_VERSION} https://gitlab.com/AOMediaCodec/SVT-AV1/ /tmp/svt-av1 && \
    cd /tmp/svt-av1 && \
    cd Build/linux && \
    ./build.sh release --enable-lto --enable-pgo -xi --disable-native && \
    mkdir -p /usr/local/bin && \
    if [ -f /tmp/svt-av1/Bin/Release/SvtAv1EncApp ]; then cp /tmp/svt-av1/Bin/Release/SvtAv1EncApp /usr/local/bin/; fi && \
    rm -rf /tmp/svt-av1

# --- Stage: av-scenechange ---
FROM base AS av-scenechange
# renovate: datasource=github-releases depName=rust-av/av-scenechange versioning=semver-coerced
ARG AV_SCENECHANGE_VERSION=v0.24.1
RUN --mount=type=cache,target=/root/.cargo/registry,sharing=locked \
    --mount=type=cache,target=/root/.cargo/git,sharing=locked \
    git clone --depth 1 --branch ${AV_SCENECHANGE_VERSION} https://github.com/rust-av/av-scenechange.git /tmp/av-scenechange && \
    cd /tmp/av-scenechange && \
    cargo build --release --features ffms2 && \
    cp target/release/av-scenechange /usr/local/bin/ && \
    chmod +x /usr/local/bin/av-scenechange && \
    rm -rf /tmp/av-scenechange

# ============================================================================
# DEPENDENT COMPONENTS - Build after their dependencies
# ============================================================================

# --- Stage: VapourSynth (depends on zimg) ---
FROM zimg AS vapoursynth
# renovate: datasource=github-tags depName=vapoursynth/vapoursynth versioning=regex:^R(?<major>\d+)$
ARG VAPOURSYNTH_VERSION=R79
# Install Python packages needed for VapourSynth
RUN pip install -U cython --break-system-packages
RUN git clone --depth 1 --branch ${VAPOURSYNTH_VERSION} https://github.com/vapoursynth/vapoursynth.git /tmp/vapoursynth && \
    cd /tmp/vapoursynth && \
    PKG_CONFIG_PATH="/usr/local/lib/pkgconfig" pip install . --break-system-packages && \
    ldconfig && \
    ln -sf /usr/local/lib/python3.14/dist-packages/vapoursynth/libvapoursynth.so.4 /usr/local/lib/libvapoursynth.so.4 && \
    ln -sf /usr/local/lib/python3.14/dist-packages/vapoursynth/libvapoursynth.so.4 /usr/local/lib/libvapoursynth.so && \
    ln -sf /usr/local/lib/python3.14/dist-packages/vapoursynth/libvsscript.so /usr/local/lib/libvsscript.so && \
    ln -sf /usr/local/lib/python3.14/dist-packages/vapoursynth/libvsscript.so /usr/local/lib/libvapoursynth-script.so && \
    ldconfig && \
    rm -rf /tmp/vapoursynth

# --- Stage: BestSource (depends on vapoursynth) ---
FROM vapoursynth AS bestsource
# renovate: datasource=github-tags depName=vapoursynth/bestsource versioning=regex:^R(?<major>\d+)$
ARG BESTSOURCE_VERSION=R20
RUN git clone --depth 1 --branch ${BESTSOURCE_VERSION} https://github.com/vapoursynth/bestsource.git /tmp/bestsource --no-recurse-submodules && \
    cd /tmp/bestsource && \
    git config --file .gitmodules submodule.libp2p.url https://github.com/sekrit-twc/libp2p.git && \
    git submodule update --init --recursive --depth 1 && \
    meson setup build || (cat build/meson-logs/meson-log.txt && exit 1) && \
    ninja -C build && \
    ninja -C build install && \
    rm -rf /tmp/bestsource

# --- Stage: Vship GPU SSIM2 (depends on vapoursynth + CUDA) ---
FROM vapoursynth AS vship
# renovate: datasource=forgejo-releases depName=Line-fr/Vship registryUrl=https://codeberg.org versioning=semver-coerced
ARG VSHIP_VERSION=v5.1.0
RUN git clone --depth 1 --branch ${VSHIP_VERSION} https://codeberg.org/Line-fr/Vship.git /tmp/Vship && \
    cd /tmp/Vship && \
    make build BACKEND=Vulkan && \
    make install PREFIX=/usr && \
    mkdir -p /usr/local/lib/vapoursynth && \
    cp libvship*.so /usr/local/lib/vapoursynth/ 2>/dev/null || true && \
    rm -rf /tmp/Vship

# --- Stage: Av1an (depends on Rust + VapourSynth) ---
FROM vapoursynth AS av1an
# renovate: datasource=github-tags depName=master-of-zen/Av1an versioning=semver-coerced
ARG AV1AN_VERSION=v0.5.2
RUN --mount=type=cache,target=/root/.cargo/registry,sharing=locked \
    --mount=type=cache,target=/root/.cargo/git,sharing=locked \
    git clone --depth 1 --branch ${AV1AN_VERSION} https://github.com/master-of-zen/Av1an.git /tmp/Av1an && \
    cd /tmp/Av1an && \
    export LD_LIBRARY_PATH="/usr/local/lib:${LD_LIBRARY_PATH}" && \
    export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH}" && \
    export VAPOURSYNTH_LIB_DIR="/usr/local/lib" && \
    cargo build --release && \
    cp target/release/av1an /usr/local/bin/ && \
    chmod +x /usr/local/bin/av1an && \
    rm -rf /tmp/Av1an

# ============================================================================
# FINAL RUNTIME STAGE
# ============================================================================
FROM docker.io/ubuntu:26.04@sha256:678c6550cc43645e08669028bc177f50be4e7c5b8cca677067b1914d4afc7a03  AS final

ARG DEBIAN_FRONTEND=noninteractive

# Install runtime packages
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    wget curl gnupg ca-certificates python3 libpython3.14 libffms2-5 libgomp1 rar unrar imagemagick mkvtoolnix libegl1 libvulkan1 libvulkan-dev mesa-vulkan-drivers && \
    mkdir -p /usr/local/lib/vapoursynth && \
    ln -s /usr/lib/x86_64-linux-gnu/libffms2.so.5 /usr/local/lib/vapoursynth/libffms2.so && \
    rm -rf /tmp/* /var/tmp/*

COPY --from=mcr.microsoft.com/dotnet/aspnet:10.0 /usr/share/dotnet /dotnet

RUN ln -s /dotnet/dotnet /usr/bin/dotnet

# Install Jellyfin FFmpeg (System Default)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    curl -fsSL https://repo.jellyfin.org/debian/jellyfin_team.gpg.key | gpg --dearmor --batch --yes -o /etc/apt/trusted.gpg.d/debian-jellyfin.gpg && \
    echo "deb [arch=$(dpkg --print-architecture)] https://repo.jellyfin.org/ubuntu $(awk -F'=' '/^VERSION_CODENAME=/{ print $NF }' /etc/os-release) main" | tee /etc/apt/sources.list.d/jellyfin.list && \
    apt-get update && \
    apt-get install -y jellyfin-ffmpeg8 && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe

COPY --from=ffmpeg-static /opt/ffmpeg-static /opt/ffmpeg-static
COPY --from=ab-av1 /usr/local/bin/ab-av1 /usr/local/bin/ab-av1 
# ab-av1 path is for the script to detect like it's from the dockermod
RUN mkdir -p /app/common/ab-av1 && \
    ln -s /usr/local/bin/ab-av1 /app/common/ab-av1/ab-av1 && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /app/common/ab-av1/ffprobe && \
    printf '#!/bin/bash\nif [[ "$@" =~ libvmaf|libsvtav1|xpsnr|libaom-av1 ]]; then\n    /opt/ffmpeg-static/bin/ffmpeg "$@"\nelse\n    /usr/lib/jellyfin-ffmpeg/ffmpeg "$@"\nfi\nexit $?\n' \
    > /app/common/ab-av1/ffmpeg && \
    chmod +x /app/common/ab-av1/ffmpeg

COPY --from=dovi-tool /usr/local/bin/dovi_tool /usr/local/bin/dovi_tool
COPY --from=svt-av1 /usr/local/bin/SvtAv1EncApp /usr/local/bin/SvtAv1EncApp
COPY --from=av1an /usr/local/bin/av1an /usr/local/bin/av1an
COPY --from=av-scenechange /usr/local/bin/av-scenechange /usr/local/bin/av-scenechange
COPY --from=vapoursynth /usr/local/bin/vspipe /usr/local/bin/vspipe
COPY --from=vapoursynth /usr/local/bin/vapoursynth /usr/local/bin/vapoursynth

# Copy compiled libraries from vapoursynth stage (includes zimg, vapoursynth, bestsource)
COPY --from=vapoursynth /usr/local/lib /usr/local/lib
COPY --from=bestsource /usr/local/lib/python3/dist-packages/vapoursynth/plugins/libbestsource.so /usr/local/lib/vapoursynth/bestsource.so

# Copy Vship VapourSynth plugins
COPY --from=vship /usr/local/lib/vapoursynth/ /usr/local/lib/vapoursynth/

# Copy Python packages (VapourSynth bindings)
COPY --from=vapoursynth /usr/local/lib/python3.14/dist-packages /usr/local/lib/python3.14/dist-packages

# Configure VapourSynth runtime (maps all libvsscript load paths to this Python installation)
RUN python3 - <<'EOF'
import os
import sys
from vapoursynth._utils import _find_python_symbol_path, _mangle_vsscript_key, _get_vapoursynth_config_path, _escape_toml_string

py = sys.executable
pylib = _find_python_symbol_path()
mtime = int(os.stat(py).st_mtime)

cfg = {}
for vss in ["/usr/local/lib/python3.14/dist-packages/vapoursynth/libvsscript.so",
            "/usr/local/lib/libvsscript.so",
            "/usr/local/lib/libvapoursynth-script.so"]:
    cfg[_mangle_vsscript_key(vss)] = [py, pylib, mtime]

cfg_path = _get_vapoursynth_config_path()
cfg_path.parent.mkdir(parents=True, exist_ok=True)
with open(cfg_path, "w") as f:
    for key in cfg:
        f.write(f"{_escape_toml_string(key)} = [{_escape_toml_string(cfg[key][0])},{_escape_toml_string(cfg[key][1])},{cfg[key][2]}]\n")
EOF

# Update library cache
RUN ldconfig

# Set environment variables
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
ENV NVIDIA_VISIBLE_DEVICES=all
ENV DOTNET_ROOT=/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=true
# Extra VapourSynth plugin search path (ffms2, bestsource, vship)
ENV VAPOURSYNTH_EXTRA_PLUGIN_PATH=/usr/local/lib/vapoursynth
# Add BtbN FFmpeg to PATH (after /usr/local/bin so Jellyfin version is default)
ENV PATH=/dotnet:/dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/ffmpeg-static/bin

# Copy application code from the appdata stage
COPY --from=revenz/fileflows:26.07@sha256:a9ce79d8ad21a37ff1579f59cfa8844aded4026fd094e5a893ff476ffe0eaf93 /app /app

# Make entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

# Expose port
EXPOSE 5000/tcp

# Set working directory
WORKDIR /app

# Set entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]
