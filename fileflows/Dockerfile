FROM revenz/fileflows:25.11 AS appdata

# ============================================================================
# SHARED BASE STAGE - Common build dependencies
# ============================================================================
FROM nvidia/cuda:13.0.2-devel-ubuntu24.04 AS base

ARG DEBIAN_FRONTEND=noninteractive

# Install common build dependencies (shared across all builder stages)
RUN apt-get update && \
    apt-get install -y sudo tzdata wget ca-certificates gnupg curl tar xz-utils zstd libssl-dev apt-transport-https openssl locales libfontconfig1 libfreetype6 pciutils vainfo git cmake llvm \
    build-essential autoconf automake libtool pkg-config nasm meson ninja-build python3-dev python3-venv python3-setuptools libavformat-dev libavfilter-dev libavdevice-dev libavcodec-dev libswscale-dev libxxhash-dev clang && \
    rm -rf /var/lib/apt/lists/*

ENV PKG_CONFIG_PATH="/usr/local/lib/pkgconfig"

# Install Rust (needed for Av1an)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install wild linker for Rust
RUN cargo install --locked wild-linker && \
    mkdir -p /root/.cargo && \
    printf '[target.x86_64-unknown-linux-gnu]\nlinker = "clang"\nrustflags = ["-Clink-arg=--ld-path=wild"]\n' > /root/.cargo/config.toml

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
ARG AB_AV1_VERSION=v0.10.1
RUN curl -L -o /tmp/ab-av1.tar.zst "https://github.com/alexheretic/ab-av1/releases/download/${AB_AV1_VERSION}/ab-av1-${AB_AV1_VERSION}-x86_64-unknown-linux-musl.tar.zst" && \
    tar --use-compress-program=unzstd -xvf /tmp/ab-av1.tar.zst -C /usr/local/bin ab-av1 && \
    rm /tmp/ab-av1.tar.zst

# --- Stage: dovi_tool ---
FROM base AS dovi-tool
ARG DOVI_TOOL_VERSION=2.3.1
RUN curl -L "https://github.com/quietvoid/dovi_tool/releases/download/${DOVI_TOOL_VERSION}/dovi_tool-${DOVI_TOOL_VERSION}-x86_64-unknown-linux-musl.tar.gz" | \
    tar -xzvf - -C /usr/local/bin

# --- Stage: zimg ---
FROM base AS zimg
ARG ZIMG_VERSION=release-3.0.6
RUN git clone https://github.com/sekrit-twc/zimg.git /tmp/zimg && \
    cd /tmp/zimg && \
    git checkout ${ZIMG_VERSION} && \
    git submodule update --init --recursive && \
    ./autogen.sh && \
    ./configure --enable-shared && \
    make -j$(nproc) && \
    make install && \
    ldconfig && \
    rm -rf /tmp/zimg

# --- Stage: svt-av1 ---
FROM base AS svt-av1
ARG SVT_VERSION=v4.0.1
RUN git clone https://gitlab.com/AOMediaCodec/SVT-AV1/ /tmp/svt-av1 && \
    cd /tmp/svt-av1 && \
    git checkout ${SVT_VERSION} && \
    cd Build/linux && \
    ./build.sh release --enable-lto --enable-pgo -xi --disable-native --disable-avx512 && \
    mkdir -p /usr/local/bin && \
    if [ -f /tmp/svt-av1/Bin/Release/SvtAv1EncApp ]; then cp /tmp/svt-av1/Bin/Release/SvtAv1EncApp /usr/local/bin/; fi && \
    rm -rf /tmp/svt-av1

# ============================================================================
# DEPENDENT COMPONENTS - Build after their dependencies
# ============================================================================

# --- Stage: VapourSynth (depends on zimg) ---
FROM zimg AS vapoursynth
ARG VAPOURSYNTH_VERSION=R71
# Install Python packages needed for VapourSynth
RUN apt-get update && apt-get install -y python3-dev python3-setuptools python3-pip && \
    pip install -U cython --break-system-packages && \
    rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/vapoursynth/vapoursynth.git /tmp/vapoursynth && \
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
    rm -rf /tmp/vapoursynth

# --- Stage: BestSource (depends on vapoursynth) ---
FROM vapoursynth AS bestsource
ARG BESTSOURCE_VERSION=R8
RUN git clone https://github.com/vapoursynth/bestsource.git /tmp/bestsource --recurse-submodules --shallow-submodules --remote-submodules && \
    cd /tmp/bestsource && \
    git checkout ${BESTSOURCE_VERSION} && \
    meson setup build || (cat build/meson-logs/meson-log.txt && exit 1) && \
    ninja -C build && \
    ninja -C build install && \
    rm -rf /tmp/bestsource

# --- Stage: SSIM2 CPU (depends on vapoursynth + Zig) ---
FROM vapoursynth AS ssim2
ARG ZIG_VERSION=0.15.2
# Install Zig (only needed for SSIM2)
RUN mkdir -p /opt/zig && \
    wget "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" && \
    tar -xf "zig-x86_64-linux-${ZIG_VERSION}.tar.xz" -C /opt/zig && \
    rm "zig-x86_64-linux-${ZIG_VERSION}.tar.xz"
ENV PATH="/opt/zig/zig-x86_64-linux-${ZIG_VERSION}:${PATH}"
RUN git clone https://github.com/dnjulek/vapoursynth-zip /tmp/vapoursynth-zip && \
    cd /tmp/vapoursynth-zip && \
    git checkout R10 && \
    /opt/zig/zig-x86_64-linux-${ZIG_VERSION}/zig build -Doptimize=ReleaseFast && \
    mkdir -p /usr/local/lib/vapoursynth && \
    cp zig-out/lib/libvszip.so /usr/local/lib/vapoursynth && \
    rm -rf /tmp/vapoursynth-zip

# --- Stage: Vship GPU SSIM2 (depends on vapoursynth + CUDA) ---
FROM vapoursynth AS vship
ARG VSHIP_VERSION=v4.0.0
RUN git clone https://github.com/Line-fr/Vship.git /tmp/Vship && \
    cd /tmp/Vship && \
    git checkout ${VSHIP_VERSION} && \
    make buildcudaall && \
    mkdir -p /usr/local/lib/vapoursynth && \
    find . -name "*.so" -exec cp {} /usr/local/lib/vapoursynth/ \; && \
    rm -rf /tmp/Vship

# --- Stage: Av1an (depends on Rust + VapourSynth) ---
FROM vapoursynth AS av1an
ARG AV1AN_VERSION=0.5
RUN apt-get update && apt-get install -y libffms2-dev && \
    rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/master-of-zen/Av1an.git /tmp/Av1an && \
    cd /tmp/Av1an && \
    git checkout ${AV1AN_VERSION} && \
    export LD_LIBRARY_PATH="/usr/local/lib:${LD_LIBRARY_PATH}" && \
    export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:${PKG_CONFIG_PATH}" && \
    cargo build --release && \
    cp target/release/av1an /usr/local/bin/ && \
    chmod +x /usr/local/bin/av1an && \
    rm -rf /tmp/Av1an

# ============================================================================
# FINAL RUNTIME STAGE
# ============================================================================
FROM nvidia/cuda:13.0.2-runtime-ubuntu24.04 AS final

ARG DEBIAN_FRONTEND=noninteractive

# Install runtime packages
RUN apt-get update && \
    apt-get install -y sudo tzdata wget ca-certificates gnupg curl tar xz-utils zstd libssl-dev apt-transport-https openssl locales libfontconfig1 libfreetype6 pciutils vainfo \
    python3 python3-pip libffms2-5 libgomp1 rar unrar imagemagick mkvtoolnix && \
    mkdir -p /usr/local/lib/vapoursynth && \
    ln -s /usr/lib/x86_64-linux-gnu/libffms2.so.5 /usr/local/lib/vapoursynth/libffms2.so && \
    rm -rf /var/lib/apt/lists/*

# Install .NET 8
RUN wget https://dot.net/v1/dotnet-install.sh && \
    bash dotnet-install.sh -c 8.0 --install-dir /dotnet && \
    rm -f dotnet-install.sh && \
    chmod 775 /dotnet

# Install Jellyfin FFmpeg (System Default)
RUN curl -fsSL https://repo.jellyfin.org/debian/jellyfin_team.gpg.key | gpg --dearmor --batch --yes -o /etc/apt/trusted.gpg.d/debian-jellyfin.gpg && \
    echo "deb [arch=$(dpkg --print-architecture)] https://repo.jellyfin.org/ubuntu $(awk -F'=' '/^VERSION_CODENAME=/{ print $NF }' /etc/os-release) main" | tee /etc/apt/sources.list.d/jellyfin.list && \
    apt-get update && \
    apt-get install -y jellyfin-ffmpeg7 && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg && \
    ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe && \
    rm -rf /var/lib/apt/lists/*

# Copy artifacts from independent stages (order doesn't matter for caching)
COPY --from=ffmpeg-static /opt/ffmpeg-static /opt/ffmpeg-static
COPY --from=ab-av1 /usr/local/bin/ab-av1 /usr/local/bin/ab-av1
COPY --from=dovi-tool /usr/local/bin/dovi_tool /usr/local/bin/dovi_tool
COPY --from=svt-av1 /usr/local/bin/SvtAv1EncApp /usr/local/bin/SvtAv1EncApp
COPY --from=av1an /usr/local/bin/av1an /usr/local/bin/av1an
COPY --from=vapoursynth /usr/local/bin/vspipe /usr/local/bin/vspipe

# Copy compiled libraries from vapoursynth stage (includes zimg, vapoursynth, bestsource, ssim2, vship)
COPY --from=vapoursynth /usr/local/lib /usr/local/lib
COPY --from=bestsource /usr/local/lib/vapoursynth /usr/local/lib/vapoursynth
COPY --from=ssim2 /usr/local/lib/vapoursynth/libvszip.so /usr/local/lib/vapoursynth/libvszip.so
COPY --from=vship /usr/local/lib/vapoursynth/ /usr/local/lib/vapoursynth/

# Copy Python packages (VapourSynth bindings)
COPY --from=vapoursynth /usr/local/lib/python3.12/dist-packages /usr/local/lib/python3.12/dist-packages

# Update library cache
RUN ldconfig

# Set environment variables
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
ENV NVIDIA_VISIBLE_DEVICES=all
ENV DOTNET_ROOT=/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=true
# Add BtbN FFmpeg to PATH (after /usr/local/bin so Jellyfin version is default)
ENV PATH=/dotnet:/dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/ffmpeg-static/bin

# Copy application code from the appdata stage
COPY --from=appdata /app /app

# Make entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

# Expose port
EXPOSE 5000/tcp

# Set working directory
WORKDIR /app

# Set entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]
