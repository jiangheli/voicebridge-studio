Unicode True
ManifestSupportedOS all
RequestExecutionLevel admin

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef OUTPUT_DIR
    !define OUTPUT_DIR "offline-bundle"
!endif

Name "VoiceBridge Studio GPU 离线安装"
OutFile "${OUTPUT_DIR}\VoiceBridge-Offline-Setup.exe"
InstallDir "$TEMP\VoiceBridgeOfflineInstaller"
ShowInstDetails show
SetCompressor /SOLID lzma

VIProductVersion "0.6.3.0"
VIAddVersionKey /LANG=2052 "ProductName" "VoiceBridge Studio GPU 离线安装"
VIAddVersionKey /LANG=2052 "CompanyName" "VoiceBridge Studio"
VIAddVersionKey /LANG=2052 "FileDescription" "VoiceBridge Studio 完全离线安装入口"
VIAddVersionKey /LANG=2052 "LegalCopyright" "VoiceBridge Studio contributors"
VIAddVersionKey /LANG=2052 "FileVersion" "0.6.3"
VIAddVersionKey /LANG=2052 "ProductVersion" "0.6.3"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 VoiceBridge Studio 本机 GPU 环境"
!define MUI_WELCOMEPAGE_TEXT "本程序只读取同目录 payload 文件夹，不会联网下载。$\r$\n$\r$\n请完整复制 VoiceBridge 离线包后再运行本 EXE，并保持 payload 文件夹名称不变。继续安装表示你同意随包提供的 Meta Seamless 许可和 Docker Desktop 许可。$\r$\n$\r$\n需要 Windows 10 22H2/Windows 11 23H2、NVIDIA GPU、已开启 BIOS 虚拟化和至少 25 GB 可用空间。"
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "离线安装阶段完成"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "请查看下面的详细日志。"
!define MUI_FINISHPAGE_TITLE "VoiceBridge 离线安装程序已结束"
!define MUI_FINISHPAGE_TEXT "如果系统要求重启，请保留离线包所在磁盘。登录 Windows 后安装会自动继续。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "VoiceBridge 完整离线环境" MainSection
    SectionIn RO

    ${IfNot} ${FileExists} "$EXEDIR\payload\offline-manifest.json"
        MessageBox MB_OK|MB_ICONSTOP \
            "找不到 payload\offline-manifest.json。请完整复制整个离线包，不要单独运行 EXE。"
        Abort
    ${EndIf}

    SetOutPath "$INSTDIR"
    File /oname=install-windows-local-gpu.ps1 "..\..\scripts\install-windows-local-gpu.ps1"

    DetailPrint "正在校验并安装本地 payload..."
    DetailPrint "安装过程不会联网下载。模型校验和导入可能需要较长时间。"

    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\install-windows-local-gpu.ps1" -InstallerMode -SkipSelfUpdate -OfflinePayloadDirectory "$EXEDIR\payload"'
    Pop $0

    ${If} $0 == 3010
        DetailPrint "WSL2 已启用，Windows 必须重启。"
        MessageBox MB_YESNO|MB_ICONQUESTION \
            "WSL2 已启用，需要重启 Windows。登录后安装会从当前 payload 自动继续。现在重启吗？" \
            IDNO DeferRestart
        Reboot
DeferRestart:
        Quit
    ${ElseIf} $0 != 0
        DetailPrint "离线安装未完成，PowerShell 退出码：$0"
        MessageBox MB_OK|MB_ICONSTOP \
            "离线安装未完成。请查看详细日志。错误码：$0"
        Abort
    ${Else}
        DetailPrint "VoiceBridge Studio 本机 GPU 离线环境安装完成。"
    ${EndIf}
SectionEnd

Function .onInit
    SetShellVarContext all
FunctionEnd
