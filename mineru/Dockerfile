
FROM python:3.12-slim@sha256:09f7da3bc104798d0afb40bc08d23ab2da20a76130cec1f2ef170848f5d85217
LABEL org.opencontainers.image.source=https://github.com/whiffymuffinz/whiffy-containers

RUN apt-get update && \
    apt-get install -y \
    fonts-noto-core \
    fonts-noto-cjk \
    fontconfig \
    libgl1 \
    libglib2.0-0 \
    curl && \
    fc-cache -fv && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# renovate: datasource=pypi depName=mineru
ARG MINERU_VERSION=3.4.5
RUN pip install --no-cache-dir "mineru[api]==${MINERU_VERSION}"


ENV MINERU_MODEL_SOURCE=local

EXPOSE 8000/tcp

CMD ["mineru-api", "--host", "0.0.0.0"]
