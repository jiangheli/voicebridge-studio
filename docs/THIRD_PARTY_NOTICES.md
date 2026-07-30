# Third-party notices

## FFmpeg

VoiceBridge Studio bundles the Windows x64 LGPL shared build of FFmpeg produced by
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds):

- Build tag: `autobuild-2026-07-28-13-32`
- Archive: `ffmpeg-N-125829-gfe953596e9-win64-lgpl-shared.zip`
- Upstream commit: `fe953596e9`
- SHA-256: `51af6309b252e9eddb4a68b0c4b2122f4b1150a558ab390bbbb9e49cf3bc2d08`
- Corresponding source and build scripts:
  `https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-07-28-13-32`

FFmpeg is distributed under the terms reported by that LGPL shared build. Its
license file is copied beside the bundled runtime as `FFmpeg-LICENSE.txt`.
VoiceBridge invokes FFmpeg as a separate executable and does not modify FFmpeg.

## Seamless Communication and SeamlessExpressive

The optional Linux sidecar installs the official
[facebookresearch/seamless_communication](https://github.com/facebookresearch/seamless_communication)
code at commit `85199c276e761b2ec09ed8c1a293325df5971548`. The upstream
code identifies its applicable code license in `MIT_LICENSE`.

SeamlessExpressive checkpoints are not bundled in the VoiceBridge Windows
installer. They are downloaded only after an authorized user action from the
private deployment registry. The checkpoints remain governed by Meta's
Seamless License and acceptable-use policy. Users and deployers are responsible
for confirming that their intended use and distribution are permitted.

## Video Subtitle Remover

The optional video-cleanup workflow pulls
[YaoFANGUK/video-subtitle-remover](https://github.com/YaoFANGUK/video-subtitle-remover)
release `1.4.0` as a Docker image only after an explicit user action. The
upstream repository is licensed under Apache License 2.0. VoiceBridge does not
bundle this 6–7 GB image in its Windows installer.

VoiceBridge pins the following OCI index digests instead of floating tags:

- CUDA 11.8: `sha256:a09797f10549ca78efd7389eff4e5be9907638fef383cda0f72f9f16da380135`
- CUDA 12.6: `sha256:e58f9854b9d196a7ae8a614cac730096580dc23042223ee4a806f3b5595ae76a`
- CUDA 12.8: `sha256:7a9c720c0491f129ab39bffa6ca59b736dfcdab0350fe871005624fc8b6fe99a`

The image contains additional PaddleOCR and video-inpainting dependencies and
model files. Users and deployers must review the upstream image's dependency
and model terms for their intended use. VoiceBridge currently enables only the
NVIDIA image variants; it does not claim that the upstream CPU image is valid.
