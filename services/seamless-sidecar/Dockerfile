FROM pytorch/pytorch:2.1.2-cuda12.1-cudnn8-runtime

ARG SEAMLESS_COMMIT=85199c276e761b2ec09ed8c1a293325df5971548

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/facebookresearch/seamless_communication.git /opt/seamless_communication \
    && cd /opt/seamless_communication \
    && git checkout "${SEAMLESS_COMMIT}" \
    && python -m pip install --no-cache-dir .

WORKDIR /service
COPY requirements.txt /service/requirements.txt
RUN python -m pip install --no-cache-dir -r /service/requirements.txt
COPY app.py /service/app.py

EXPOSE 8787
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8787"]
