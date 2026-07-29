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
