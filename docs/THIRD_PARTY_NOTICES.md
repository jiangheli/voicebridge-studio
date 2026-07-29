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
