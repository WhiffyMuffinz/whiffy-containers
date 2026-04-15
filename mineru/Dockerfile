
FROM python:3.12-slim
LABEL org.opencontainers.image.source https://github.com/whiffymuffinz/whiffy-containers

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
ARG MINERU_VERSION=2.7.1
RUN pip install --no-cache-dir "mineru[api]>=${MINERU_VERSION}"


ENV MINERU_MODEL_SOURCE=local

CMD ["mineru-api", "--host", "0.0.0.0"]
