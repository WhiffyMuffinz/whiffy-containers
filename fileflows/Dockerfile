# ============================================================================
# SHARED BASE STAGE
# ============================================================================
FROM docker.io/ubuntu:24.04@sha256:c4a8d5503dfb2a3eb8ab5f807da5bc69a85730fb49b5cfca2330194ebcc41c7b AS base

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y sudo tzdata wget ca-certificates gnupg curl tar xz-utils zstd libssl-dev apt-transport-https openssl locales libfontconfig1 libfreetype6 pciutils vainfo git cmake llvm \
    build-essential autoconf automake libtool pkg-config nasm meson ninja-build python3-dev python3-venv python3-setuptools libvulkan1 libvulkan-dev mesa-vulkan-drivers libavformat-dev libavfilter-dev libavdevice-dev libavcodec-dev libswscale-dev libxxhash-dev clang && \
    rm -rf /var/lib/apt/lists/*

ENV PKG_CONFIG_PATH="/usr/local/lib/pkgconfig"

# Rust toolchain from official image
COPY --from=docker.io/rust:1.95-slim-bookworm /usr/local/cargo /root/.cargo
COPY --from=docker.io/rust:1.95-slim-bookworm /usr/local/rustup /root/.rustup
ENV CARGO_HOME=/root/.cargo
ENV RUSTUP_HOME=/root/.rustup
ENV PATH="/root/.cargo/bin:${PATH}"

# Prebuilt sccache binary
# renovate: datasource=github-releases depName=mozilla/sccache versioning=semver-coerced
ARG SCCACHE_VERSION=v0.14.0
ARG SCCACHE_REGION=garage
ENV SCCACHE_REGION=${SCCACHE_REGION}

RUN curl -L "https://github.com/mozilla/sccache/releases/download/${SCCACHE_VERSION}/sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" | \
    tar -xz --strip-components=1 -C /usr/local/bin "sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache" && \
    chmod +x /usr/local/bin/sccache

# Reads sccache S3 credentials from BuildKit secret mounts 
RUN printf '#!/bin/bash\nfor v in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY SCCACHE_BUCKET SCCACHE_ENDPOINT; do\n  [ -f "/run/secrets/$v" ] && export "$v=$(cat /run/secrets/$v)"\ndone\n' \
    > /usr/local/bin/sccache-env.sh && chmod +x /usr/local/bin/sccache-env.sh

# ============================================================================
# RUST BUILDER STAGE
# ============================================================================
FROM base AS rust-builder

# Install wild-linker before referencing it in cargo config
RUN cargo install --locked wild-linker && \
    rm -rf /root/.cargo/registry /root/.cargo/git

# Cargo config: sccache as rustc wrapper, wild-linker via clang driver
RUN printf '[build]\nrustc-wrapper = "sccache"\n\n[target.x86_64-unknown-linux-gnu]\nlinker = "clang"\nrustflags = ["-Clink-arg=--ld-path=wild"]\n' \
    > /root/.cargo/config.toml

# ============================================================================
# INDEPENDENT COMPONENTS
# ============================================================================

# --- BtbN FFmpeg (static build, prebuilt download) ---
FROM base AS ffmpeg-static
ARG FFMPEG_BTBN_VERSION=latest
RUN mkdir -p /opt/ffmpeg-static && \
    if [ "$FFMPEG_BTBN_VERSION" = "latest" ]; then \
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"; \
    else \
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BTBN_VERSION}/ffmpeg-master-${FFMPEG_BTBN_VERSION}-linux64-gpl.tar.xz"; \
    fi && \
    wget -qO- "$FFMPEG_URL" | tar -xJ -C /opt/ffmpeg-static --strip-components=1

# --- ab-av1 (prebuilt download) ---
FROM base AS ab-av1
# renovate: datasource=github-releases depName=alexheretic/ab-av1 versioning=semver-coerced
ARG AB_AV1_VERSION=v0.11.2
RUN curl -L -o /tmp/ab-av1.tar.zst "https://github.com/alexheretic/ab-av1/releases/download/${AB_AV1_VERSION}/ab-av1-${AB_AV1_VERSION}-x86_64-unknown-linux-musl.tar.zst" && \
    tar --use-compress-program=unzstd -xvf /tmp/ab-av1.tar.zst -C /usr/local/bin ab-av1 && \
    rm /tmp/ab-av1.tar.zst

# --- dovi_tool (prebuilt download) ---
FROM base AS dovi-tool
# renovate: datasource=github-releases depName=quietvoid/dovi_tool versioning=semver-coerced
ARG DOVI_TOOL_VERSION=2.3.2
RUN curl -L "https://github.com/quietvoid/dovi_tool/releases/download/${DOVI_TOOL_VERSION}/dovi_tool-${DOVI_TOOL_VERSION}-x86_64-unknown-linux-musl.tar.gz" | \
    tar -xzvf - -C /usr/local/bin

# --- zimg ---
FROM base AS zimg
# renovate: datasource=github-releases depName=sekrit-twc/zimg versioning=semver-coerced
ARG ZIMG_VERSION=release-3.0.6
RUN --mount=type=secret,id=AWS_ACCESS_KEY_ID \
    --mount=type=secret,id=AWS_SECRET_ACCESS_KEY \
    --mount=type=secret,id=SCCACHE_BUCKET \
    --mount=type=secret,id=SCCACHE_ENDPOINT \
    . /usr/local/bin/sccache-env.sh && \
    export CC="sccache gcc" CXX="sccache g++" && \
    git clone https://github.com/sekrit-twc/zimg.git /tmp/zimg && \
    cd /tmp/zimg && \
    git checkout ${ZIMG_VERSION} && \
    git submodule update --init --recursive && \
    ./autogen.sh && \
    ./configure --enable-shared && \
    make -j$(nproc) && \
    make install && \
    ldconfig && \
    sccache --show-stats && \
    rm -rf /tmp/zimg

# --- svt-av1 ---
FROM base AS svt-av1
# renovate: datasource=gitlab-releases depName=AOMediaCodec/SVT-AV1 versioning=semver-coerced
ARG SVT_VERSION=v4.1.0
RUN --mount=type=secret,id=AWS_ACCESS_KEY_ID \
    --mount=type=secret,id=AWS_SECRET_ACCESS_KEY \
    --mount=type=secret,id=SCCACHE_BUCKET \
    --mount=type=secret,id=SCCACHE_ENDPOINT \
    . /usr/local/bin/sccache-env.sh && \
    export CC="sccache gcc" CXX="sccache g++" && \
    git clone https://gitlab.com/AOMediaCodec/SVT-AV1/ /tmp/svt-av1 && \
    cd /tmp/svt-av1 && \
    git checkout ${SVT_VERSION} && \
    cd Build/linux && \
    ./build.sh release --enable-lto --enable-pgo -xi --disable-native --disable-avx512 && \
    mkdir -p /usr/local/bin && \
    if [ -f /tmp/svt-av1/Bin/Release/SvtAv1EncApp ]; then cp /tmp/svt-av1/Bin/Release/SvtAv1EncApp /usr/local/bin/; fi && \
    sccache --show-stats && \
    rm -rf /tmp/svt-av1

# ============================================================================
# DEPENDENT COMPONENTS
# ============================================================================

# --- VapourSynth (depends on zimg) ---
FROM zimg AS vapoursynth
# renovate: datasource=github-tags depName=vapoursynth/vapoursynth versioning=regex:^R(?<major>\d+)$
ARG VAPOURSYNTH_VERSION=R71
RUN apt-get update && apt-get install -y python3-dev python3-setuptools python3-pip && \
    pip install -U cython --break-system-packages && \
    rm -rf /var/lib/apt/lists/*
RUN --mount=type=secret,id=AWS_ACCESS_KEY_ID \
    --mount=type=secret,id=AWS_SECRET_ACCESS_KEY \
    --mount=type=secret,id=SCCACHE_BUCKET \
    --mount=type=secret,id=SCCACHE_ENDPOINT \
    . /usr/local/bin/sccache-env.sh && \
    export CC="sccache gcc" CXX="sccache g++" && \
    git clone https://github.com/vapoursynth/vapoursynth.git /tmp/vapoursynth && \
    cd /tmp/vapoursynth && \
    git checkout ${VAPOURSYNTH_VERSION} && \
    ./autogen.sh && \
    PKG_CONFIG_PATH="/usr/local/lib/pkgconfig" ./configure --enable-shared && \
    make -j$(nproc) && \
    make install && \
    ldconfig && \
    cd /tmp/vapoursynth && \
    pip install . --break-system-packages && \
    ldconfig && \
    if [ ! -f /usr/lib/libvapoursynth.so ] && [ -f /usr/local/lib/libvapoursynth.so ]; then ln -sf /usr/local/lib/libvapoursynth* /usr/lib/; fi && \
    sccache --show-stats && \
    rm -rf /tmp/vapoursynth

# --- BestSource (depends on vapoursynth) ---
FROM vapoursynth AS bestsource
# renovate: datasource=github-tags depName=vapoursynth/bestsource versioning=regex:^R(?<major>\d+)$
ARG BESTSOURCE_VERSION=R8
RUN --mount=type=secret,id=AWS_ACCESS_KEY_ID \
    --mount=type=secret,id=AWS_SECRET_ACCESS_KEY \
    --mount=type=secret,id=SCCACHE_BUCKET \
    --mount=type=secret,id=SCCACHE_ENDPOINT \
    . /usr/local/bin/sccache-env.sh && \
    export CC="sccache gcc" CXX="sccache g++" && \
    git clone https://github.com/vapoursynth/bestsource.git /tmp/bestsource --recurse-submodules --shallow-submodules --remote-submodules && \
    cd /tmp/bestsource && \
    git checkout ${BESTSOURCE_VERSION} && \
    meson setup build && \
    ninja -C build && \
    ninja -C build install && \
    sccache --show-stats && \
    rm -rf /tmp/bestsource

# --- Vship GPU SSIM2 (depends on vapoursynth, Vulkan) ---
FROM vapoursynth AS vship
# renovate: datasource=forgejo-releases depName=Line-fr/Vship registryUrl=https://codeberg.org versioning=semver-coerced
ARG VSHIP_VERSION=v5.0.1
RUN --mount=type=secret,id=AWS_ACCESS_KEY_ID \
    --mount=type=secret,id=AWS_SECRET_ACCESS_KEY \
    --mount=type=secret,id=SCCACHE_BUCKET \
    --mount=type=secret,id=SCCACHE_ENDPOINT \
    . /usr/local/bin/sccache-env.sh && \
    export CC="sccache gcc" CXX="sccache g++" && \
    git clone https://codeberg.org/Line-fr/Vship.git /tmp/Vship && \
    cd /tmp/Vship && \
    git checkout ${VSHIP_VERSION} && \
    make buildVulkan && \
    make install PREFIX=/usr && \
    mkdir -p /usr/local/lib/vapoursynth && \
    (cp libvship*.so /usr/local/lib/vapoursynth/ 2>/dev/null || true) && \
    sccache --show-stats && \
    rm -rf /tmp/Vship

# --- Av1an (depends on Rust + VapourSynth) ---
FROM vapoursynth AS av1an
# renovate: datasource=github-tags depName=master-of-zen/Av1an versioning=semver-coerced
ARG AV1AN_VERSION=v0.5.2
RUN apt-get update && apt-get install -y libffms2-dev && \
    rm -rf /var/lib/apt/lists/*
COPY --from=rust-builder /root/.cargo /root/.cargo
COPY --from=rust-builder /root/.rustup /root/.rustup
ENV PATH="/root/.cargo/bin:${PATH}"
RUN --mount=type=secret,id=AWS_ACCESS_KEY_ID \
    --mount=type=secret,id=AWS_SECRET_ACCESS_KEY \
    --mount=type=secret,id=SCCACHE_BUCKET \
    --mount=type=secret,id=SCCACHE_ENDPOINT \
    . /usr/local/bin/sccache-env.sh && \
    git clone https://github.com/master-of-zen/Av1an.git /tmp/Av1an && \
    cd /tmp/Av1an && \
    git checkout ${AV1AN_VERSION} && \
    export LD_LIBRARY_PATH="/usr/local/lib:${LD_LIBRARY_PATH}" && \
    export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH}" && \
    cargo build --release && \
    cp target/release/av1an /usr/local/bin/ && \
    chmod +x /usr/local/bin/av1an && \
    sccache --show-stats && \
    rm -rf /tmp/Av1an /root/.cargo/registry /root/.cargo/git

# ============================================================================
# FINAL RUNTIME STAGE
# ============================================================================
FROM docker.io/ubuntu:24.04@sha256:c4a8d5503dfb2a3eb8ab5f807da5bc69a85730fb49b5cfca2330194ebcc41c7b AS final

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget curl gnupg ca-certificates python3 libpython3.12 libffms2-5 libgomp1 rar unrar imagemagick mkvtoolnix libvulkan1 libvulkan-dev mesa-vulkan-drivers && \
    mkdir -p /usr/local/lib/vapoursynth && \
    ln -s /usr/lib/x86_64-linux-gnu/libffms2.so.5 /usr/local/lib/vapoursynth/libffms2.so && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Copy .NET from official image
COPY --from=mcr.microsoft.com/dotnet/sdk:8.0 /usr/share/dotnet /dotnet

# Jellyfin FFmpeg (system default)
RUN curl -fsSL https://repo.jellyfin.org/debian/jellyfin_team.gpg.key | gpg --dearmor --batch --yes -o /etc/apt/trusted.gpg.d/debian-jellyfin.gpg && \
    echo "deb [arch=$(dpkg --print-architecture)] https://repo.jellyfin.org/ubuntu $(awk -F'=' '/^VERSION_CODENAME=/{ print $NF }' /etc/os-release) main" | tee /etc/apt/sources.list.d/jellyfin.list && \
    apt-get update && \
    apt-get install -y jellyfin-ffmpeg7 && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe && \
    rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg-static /opt/ffmpeg-static /opt/ffmpeg-static
COPY --from=ab-av1 /usr/local/bin/ab-av1 /usr/local/bin/ab-av1
# ab-av1 symlink layout matches the dockermod detection path
RUN mkdir -p /app/common/ab-av1 && \
    ln -s /usr/local/bin/ab-av1 /app/common/ab-av1/ab-av1 && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /app/common/ab-av1/ffprobe && \
    printf '#!/bin/bash\nif [[ "$@" =~ libvmaf|libsvtav1|xpsnr|libaom-av1 ]]; then\n    /opt/ffmpeg-static/bin/ffmpeg "$@"\nelse\n    /usr/lib/jellyfin-ffmpeg/ffmpeg "$@"\nfi\nexit $?\n' \
    > /app/common/ab-av1/ffmpeg && \
    chmod +x /app/common/ab-av1/ffmpeg

COPY --from=dovi-tool /usr/local/bin/dovi_tool /usr/local/bin/dovi_tool
COPY --from=svt-av1 /usr/local/bin/SvtAv1EncApp /usr/local/bin/SvtAv1EncApp
COPY --from=av1an /usr/local/bin/av1an /usr/local/bin/av1an
COPY --from=vapoursynth /usr/local/bin/vspipe /usr/local/bin/vspipe

COPY --from=vapoursynth /usr/local/lib /usr/local/lib
COPY --from=bestsource /usr/local/lib/vapoursynth /usr/local/lib/vapoursynth
COPY --from=bestsource /usr/local/lib/x86_64-linux-gnu/libbestsource.so /usr/local/lib/

COPY --from=vship /usr/local/lib/vapoursynth/ /usr/local/lib/vapoursynth/

COPY --from=vapoursynth /usr/local/lib/python3.12/dist-packages /usr/local/lib/python3.12/dist-packages

RUN ldconfig

ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
ENV NVIDIA_VISIBLE_DEVICES=all
ENV DOTNET_ROOT=/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=true
ENV PATH=/dotnet:/dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/ffmpeg-static/bin

COPY --from=revenz/fileflows:26.04@sha256:f3b223f11285ab8b5f74ffaf32544c2f16daea8be52f4a0aae4f9dfc0deb70bc /app /app

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 5000/tcp

WORKDIR /app

ENTRYPOINT ["/app/docker-entrypoint.sh"]