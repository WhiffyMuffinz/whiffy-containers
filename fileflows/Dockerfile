FROM revenz/fileflows:25.11 AS appdata

FROM nvidia/cuda:13.0.2-devel-ubuntu24.04

ARG DEBIAN_FRONTEND=noninteractive

# Tool Versions
ARG AB_AV1_VERSION=v0.10.1
ARG DOVI_TOOL_VERSION=2.3.1
ARG AV1AN_VERSION=fed7fc0cf579a1af8c1b08862fad16a66233cf65
ARG ZIMG_VERSION=release-3.0.6
ARG VAPOURSYNTH_VERSION=R71
ARG LSMASH_VERSION=v2.14.5
ARG LSMASH_WORKS_VERSION=a090a57
ARG BESTSOURCE_VERSION=R8
ARG FFMPEG_BTBN_VERSION=latest

# Install required packages
RUN apt-get update && \
    apt-get install -y sudo tzdata wget ca-certificates gnupg curl tar xz-utils libssl-dev apt-transport-https openssl locales libfontconfig1 libfreetype6 pciutils vainfo git

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
    ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe

# Install BtbN FFmpeg (Static Build)
RUN mkdir -p /opt/ffmpeg-static && \
    if [ "$FFMPEG_BTBN_VERSION" = "latest" ]; then \
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"; \
    else \
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BTBN_VERSION}/ffmpeg-master-${FFMPEG_BTBN_VERSION}-linux64-gpl.tar.xz"; \
    fi && \
    wget -qO- "$FFMPEG_URL" | tar -xJ -C /opt/ffmpeg-static --strip-components=1

# Install ab-av1
RUN curl -L "https://github.com/alexheretic/ab-av1/releases/download/${AB_AV1_VERSION}/ab-av1-${AB_AV1_VERSION}-x86_64-unknown-linux-musl.tar.zst" | \
    tar --use-compress-program=unzstd -xvf - -C /usr/local/bin ab-av1

# Install dovi_tool
RUN curl -L "https://github.com/quietvoid/dovi_tool/releases/download/${DOVI_TOOL_VERSION}/dovi_tool-${DOVI_TOOL_VERSION}-x86_64-unknown-linux-musl.tar.gz" | \
    tar -xzvf - -C /usr/local/bin dovi_tool

# Install Rar and ImageMagick
RUN apt-get update && apt-get install -y rar unrar imagemagick

# Build Av1an and dependencies
COPY build_av1an.sh /tmp/build_av1an.sh
RUN chmod +x /tmp/build_av1an.sh && \
    /tmp/build_av1an.sh && \
    rm /tmp/build_av1an.sh

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