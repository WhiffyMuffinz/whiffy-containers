FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y \
    fonts-noto-core \
    fonts-noto-cjk \
    fontconfig \
    libgl1 && \
    fc-cache -fv && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir 'mineru[api]>=2.7.1'


ENV MINERU_MODEL_SOURCE=local

CMD ["mineru-api --host 0.0.0.0"]
