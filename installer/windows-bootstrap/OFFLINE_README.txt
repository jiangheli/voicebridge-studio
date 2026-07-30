VoiceBridge Studio GPU 离线安装包
=================================

使用方法：

1. 必须完整复制本文件夹，不能只复制 EXE。
2. 确认 VoiceBridge-Offline-Setup.exe 和 payload 文件夹在同一级目录。
3. 双击 VoiceBridge-Offline-Setup.exe，并确认 Windows UAC。
4. 如果提示重启，请保持当前磁盘连接；重新登录后安装会自动继续。
5. 完成后 VoiceBridge Studio 会自动启动。

安装阶段不会联网下载 WSL、Docker Desktop、VoiceBridge Studio、
SeamlessExpressive 模型或 GPU Sidecar 镜像。

目标电脑要求：

- Windows 10 22H2 build 19045，或 Windows 11 23H2 build 22631 以上；
- x64 处理器；
- 至少 8 GB 内存，建议 16 GB；
- 至少 25 GB 可用空间；
- BIOS/UEFI 已开启 Intel VT-x/VT-d 或 AMD-V/SVM；
- 支持 WSL2 CUDA 的 NVIDIA GPU 与对应的 Windows 驱动。

如果目标电脑尚未安装 NVIDIA 驱动，请把适配该电脑显卡和整机厂商的
官方驱动安装包命名为 NVIDIA-Driver.exe，放入 payload，并重新生成
offline-manifest.json 后再安装。不要给不同显卡强行使用同一个驱动包。

继续安装表示你同意 payload 中的 Meta Seamless 许可，以及 Docker Desktop
的许可条款。所有 payload 文件会在修改系统前执行大小和 SHA-256 校验。
