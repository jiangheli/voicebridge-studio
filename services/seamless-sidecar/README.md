# SeamlessExpressive Linux GPU Sidecar

The official Seamless Communication runtime depends on `fairseq2`, whose
prebuilt packages do not support Windows x64. VoiceBridge runs this Linux GPU
service either on a separate host or in Docker Desktop's WSL2 engine on the
same Windows NVIDIA machine.

The `0.6.0` image uses PyTorch 2.8 and CUDA 12.8 for RTX 50-series Blackwell
GPUs. The legacy fairseq2 0.2.1 native component is rebuilt from source against
that exact PyTorch ABI; installing the published 0.2.1 wheel would silently
downgrade the runtime to PyTorch 2.2.2 and break RTX 5060 Ti execution.

## Model directory

Deploy the private release from `RSXLX/voicebridge-models-private` so the
container host has:

```text
/srv/voicebridge/models/SeamlessExpressive/
├── m2m_expressive_unity.pt
├── pretssel_melhifigan_wm.pt
└── pretssel_melhifigan_wm-16khz.pt
```

The model remains governed by Meta's Seamless license and acceptable-use
policy. Do not make the model directory or the sidecar endpoint public.

## Run

```bash
docker build -t voicebridge-seamless-sidecar:0.6.0 .
docker run --rm --gpus all -p 127.0.0.1:8787:8787 \
  -e VOICEBRIDGE_SIDECAR_API_KEY='replace-me' \
  -v /srv/voicebridge/models/SeamlessExpressive:/models/SeamlessExpressive:ro \
  voicebridge-seamless-sidecar:0.6.0
```

For LAN deployment, bind the port deliberately and put TLS or a trusted
reverse proxy in front of the service. Configure the Windows GUI with the
resulting base URL and matching API key.

The packaged Windows GUI embeds this directory and can build/start the same
container from “模型与运行”. It binds only `127.0.0.1:8787` and mounts the
downloaded checkpoint directory read-only.
