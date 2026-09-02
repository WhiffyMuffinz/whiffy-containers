
FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea
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
