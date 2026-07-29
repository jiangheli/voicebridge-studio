# SeamlessExpressive Linux GPU Sidecar

The official Seamless Communication runtime depends on `fairseq2`, whose
prebuilt packages do not support Windows x64. VoiceBridge therefore keeps the
Windows desktop app small and calls this Linux GPU service for the
`expressive_fast` route.

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
docker build -t voicebridge-seamless-sidecar .
docker run --rm --gpus all -p 127.0.0.1:8787:8787 \
  -e VOICEBRIDGE_SIDECAR_API_KEY='replace-me' \
  -v /srv/voicebridge/models/SeamlessExpressive:/models/SeamlessExpressive:ro \
  voicebridge-seamless-sidecar
```

For LAN deployment, bind the port deliberately and put TLS or a trusted
reverse proxy in front of the service. Configure the Windows GUI with the
resulting base URL and matching API key.
