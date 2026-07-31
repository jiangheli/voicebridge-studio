ARG PYTORCH_VERSION=2.8.0
ARG CUDA_VERSION=12.8
ARG PYTORCH_REGISTRY=dockerproxy.net/pytorch/pytorch

FROM ${PYTORCH_REGISTRY}:${PYTORCH_VERSION}-cuda${CUDA_VERSION}-cudnn9-devel AS fairseq2_builder

ARG FAIRSEQ2_VERSION=v0.2.1
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
        build-essential \
        git \
        libsndfile1-dev

# SeamlessExpressive still uses the fairseq2 0.2 API. Rebuild its native
# extension against the Blackwell-capable PyTorch ABI instead of installing the
# old binary wheel, which is pinned to PyTorch 2.2.2 / CUDA 12.1.
RUN python -m pip install \
        --no-cache-dir \
        cmake~=3.31 \
        ninja~=1.11 \
        packaging~=23.1 \
        setuptools~=67.8 \
        tbb-devel==2021.8.0 \
        wheel~=0.40

# PyTorch's Conda image puts its GNU libiconv header ahead of the Ubuntu
# system header. Install the matching shared library so fairseq2n does not
# compile against libiconv declarations and then link against glibc iconv.
RUN conda install --yes libiconv \
    && conda clean --all --force-pkgs-dirs --yes

RUN git clone \
        --branch "${FAIRSEQ2_VERSION}" \
        --depth 1 \
        --recurse-submodules \
        --shallow-submodules \
        https://github.com/facebookresearch/fairseq2.git \
        /opt/fairseq2 \
    && cmake \
        -S /opt/fairseq2/fairseq2n \
        -B /opt/fairseq2/fairseq2n/build \
        -GNinja \
        -DBUILD_TESTING=OFF \
        -DFAIRSEQ2N_USE_CUDA=OFF \
        -DFAIRSEQ2N_PERFORM_LTO=OFF \
        -DIconv_IS_BUILT_IN=FALSE \
        -DIconv_INCLUDE_DIR=/opt/conda/include \
        -DIconv_LIBRARY=/opt/conda/lib/libiconv.so \
    && cmake --build /opt/fairseq2/fairseq2n/build --parallel 2 \
    && mkdir -p /wheels \
    && cd /opt/fairseq2/fairseq2n/python \
    && python -m pip wheel --no-deps --wheel-dir /wheels . \
    && cd /opt/fairseq2 \
    && python -m pip wheel --no-deps --wheel-dir /wheels .

FROM ${PYTORCH_REGISTRY}:${PYTORCH_VERSION}-cuda${CUDA_VERSION}-cudnn9-runtime

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
        gcc \
        git \
        libsndfile1

RUN conda install --yes libiconv \
    && conda clean --all --force-pkgs-dirs --yes

COPY --from=fairseq2_builder /wheels /wheels
RUN python -m pip install \
        --no-cache-dir \
        tbb==2021.8.0 \
    && python -m pip install --no-cache-dir /wheels/fairseq2n-*.whl /wheels/fairseq2-*.whl \
    && rm -rf /wheels

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
