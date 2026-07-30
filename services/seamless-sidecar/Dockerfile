FROM dockerproxy.net/pytorch/pytorch:2.2.2-cuda12.1-cudnn8-runtime

ARG SEAMLESS_COMMIT=85199c276e761b2ec09ed8c1a293325df5971548
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    sed -i \
        -e 's|http://archive.ubuntu.com/ubuntu|https://mirrors.aliyun.com/ubuntu|g' \
        -e 's|http://security.ubuntu.com/ubuntu|https://mirrors.aliyun.com/ubuntu|g' \
        /etc/apt/sources.list \
    && apt-get -o Acquire::Retries=10 update \
    && apt-get -o Acquire::Retries=10 install \
        -y \
        --fix-missing \
        --no-install-recommends \
        ffmpeg \
        git \
        libsndfile1

RUN python -m pip install \
        --no-cache-dir \
        tbb==2021.9.0

RUN mkdir -p /opt/seamless_communication \
    && cd /opt/seamless_communication \
    && git init \
    && git remote add origin https://github.com/facebookresearch/seamless_communication.git \
    && git fetch --depth 1 origin "${SEAMLESS_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && python -m pip install --no-cache-dir .

WORKDIR /service
COPY requirements.txt /service/requirements.txt
RUN python -m pip install --no-cache-dir -r /service/requirements.txt
COPY app.py /service/app.py

EXPOSE 8787
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8787"]
