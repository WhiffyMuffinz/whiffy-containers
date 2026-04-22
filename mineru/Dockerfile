
FROM python:3.12-slim@sha256:804ddf3251a60bbf9c92e73b7566c40428d54d0e79d3428194edf40da6521286
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
ARG MINERU_VERSION=3.1.2
RUN pip install --no-cache-dir "mineru[api]==${MINERU_VERSION}"


ENV MINERU_MODEL_SOURCE=local

EXPOSE 8000/tcp

CMD ["mineru-api", "--host", "0.0.0.0"]
