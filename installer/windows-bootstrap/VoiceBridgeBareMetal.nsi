Unicode True
ManifestSupportedOS all
RequestExecutionLevel admin

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef OUTPUT_DIR
    !define OUTPUT_DIR "release"
!endif

Name "VoiceBridge Studio GPU 一键安装"
OutFile "${OUTPUT_DIR}\VoiceBridge-Studio-GPU-OneClick-Setup-0.5.0.exe"
InstallDir "$COMMONAPPDATA\VoiceBridge\Installer"
ShowInstDetails show
SetCompressor /SOLID lzma

VIProductVersion "0.5.0.0"
VIAddVersionKey /LANG=2052 "ProductName" "VoiceBridge Studio GPU 一键安装"
VIAddVersionKey /LANG=2052 "CompanyName" "VoiceBridge Studio"
VIAddVersionKey /LANG=2052 "FileDescription" "VoiceBridge Studio、WSL2、Docker Desktop 和 SeamlessExpressive 裸机安装器"
VIAddVersionKey /LANG=2052 "FileVersion" "0.5.0"
VIAddVersionKey /LANG=2052 "ProductVersion" "0.5.0"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 VoiceBridge Studio 本机 GPU 环境"
!define MUI_WELCOMEPAGE_TEXT "此向导适用于全新的 Windows 电脑。$\r$\n$\r$\n它将安装或配置 WSL2、Docker Desktop、SeamlessExpressive 模型、本机 GPU 服务和 VoiceBridge Studio。$\r$\n$\r$\n需要 NVIDIA GPU、已开启的 BIOS 虚拟化、互联网连接和至少 25 GB 可用空间。"
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "安装阶段完成"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "请查看下面的详细日志。"
!define MUI_FINISHPAGE_TITLE "VoiceBridge 安装程序已结束"
!define MUI_FINISHPAGE_TEXT "如果系统要求重启，登录 Windows 后安装会自动继续。全部完成后，VoiceBridge Studio 将自动启动。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "VoiceBridge 完整环境" MainSection
    SectionIn RO
    SetOutPath "$INSTDIR"
    File /oname=install-windows-local-gpu.ps1 "..\..\scripts\install-windows-local-gpu.ps1"

    DetailPrint "正在启动裸机环境检查与安装..."
    DetailPrint "首次安装需要下载模型和 GPU 镜像，可能需要 30–60 分钟。"

    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\install-windows-local-gpu.ps1" -InstallerMode'
    Pop $0

    ${If} $0 == 3010
        DetailPrint "WSL2 已启用，Windows 必须重启。"
        MessageBox MB_YESNO|MB_ICONQUESTION \
            "WSL2 已启用，需要重启 Windows。登录后安装器会自动继续。现在重启吗？" \
            IDNO DeferRestart
        Reboot
DeferRestart:
        Quit
    ${ElseIf} $0 != 0
        DetailPrint "安装未完成，PowerShell 退出码：$0"
        MessageBox MB_OK|MB_ICONSTOP \
            "安装未完成。请查看安装窗口中的详细日志。错误码：$0"
        Abort
    ${Else}
        DetailPrint "VoiceBridge Studio 本机 GPU 环境安装完成。"
    ${EndIf}
SectionEnd

Function .onInit
    SetShellVarContext current
FunctionEnd
