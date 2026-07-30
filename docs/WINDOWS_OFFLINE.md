# Windows 完全离线安装包

离线包采用一个启动程序和一个 payload 目录，复制时必须保留两者：

```text
offline-bundle/
├── VoiceBridge-Offline-Setup.exe
└── payload/
    ├── offline-manifest.json
    ├── Docker-Desktop-Installer.exe
    ├── wsl-x64.msi
    ├── VoiceBridge-Studio-Windows-x64.exe
    ├── SeamlessExpressive.tar.gz.part-00
    ├── SeamlessExpressive.tar.gz.part-01
    ├── SEAMLESS_LICENSE
    ├── NOTICE
    └── voicebridge-seamless-sidecar-amd64.tar
```

`VoiceBridge-Offline-Setup.exe` 只读取同目录的 `payload`，安装阶段不会下载
模型、Docker Desktop、WSL、VoiceBridge Studio 或 Sidecar 镜像。

## 制作离线包

在已安装 PowerShell、Docker 和 NSIS 的构建机上执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prepare-windows-offline-bundle.ps1
makensis.exe /INPUTCHARSET UTF8 /DOUTPUT_DIR=..\..\offline-bundle installer\windows-bootstrap\VoiceBridgeOfflineLauncher.nsi
```

在 macOS/Linux 使用 NSIS 时，把 `makensis.exe` 改为 `makensis`。

## 目标电脑安装

1. 完整复制 `offline-bundle` 文件夹；
2. 双击 `VoiceBridge-Offline-Setup.exe`；
3. 阅读并接受 Meta Seamless 与 Docker Desktop 的许可条款，然后接受 UAC；
4. 如果提示重启，保持离线包磁盘连接，重启后登录；
5. 安装逻辑会自动继续并启动 VoiceBridge Studio。

目标电脑仍必须具备兼容的 NVIDIA Windows 驱动。驱动与具体 GPU/笔记本厂商
有关，不能安全地用同一个安装包覆盖所有设备。需要一并部署驱动时，将目标电脑
对应的官方驱动安装包命名为 `NVIDIA-Driver.exe` 放进 `payload`，然后重新生成
`offline-manifest.json`。

所有 payload 文件在安装前都会按 `offline-manifest.json` 执行大小和 SHA-256
校验。损坏或缺失时会在更改系统前停止。
