# BrightSign WebAccess Alarm Display

Windows 免安裝的 WebAccess 警報平面圖與 BrightSign 顯示系統。

## 下載使用

前往 [最新版本下載](https://github.com/HouKaiYen/brightsign-webaccess-alarm-display/releases/latest)。

1. 在 Assets 下載 **BrightSignAlarm-v0.3.0-win-x64.zip**。GitHub 自動提供的 Source code 是原始碼，不是免安裝程式。
2. 將 ZIP 完整解壓縮到固定資料夾，例如 `C:\BrightSignAlarm`。請勿直接在 ZIP 內啟動。
3. 雙擊「開啟設定頁.cmd」。套件內含 Node.js，不需要另外安裝 Node.js 或 npm。
4. 進入「工程設定」，設定 WebAccess 連線、平面圖及測點。
5. BrightSign 播放器開啟 `http://主機IP:3006/display`。

## Windows 系統匣

啟動警報系統或開啟設定頁時，Windows 右下角會顯示系統匣圖示。

- 按兩下圖示：開啟設定頁。
- 按右鍵：查看服務狀態、啟動、停止或重新啟動服務。
- 啟用開機自動啟動後：背景服務會在開機時啟動，系統匣圖示會在登入 Windows 後顯示。
- 結束系統匣程式不會停止背景服務。

日常使用指令位於套件根目錄；停止服務、自啟動、權限修復等備用指令位於「進階管理工具」資料夾。

## 何時需要系統管理員權限

- 一般啟動、內容編輯、媒體上傳及網頁中的監控開關：通常不需要。
- 啟用或取消開機自動啟動：以系統管理員身分執行對應指令；網頁操作會在需要時要求 UAC 授權。
- 停止或重新啟動服務：若服務由開機排程以 SYSTEM 或其他管理員啟動，可能需要系統管理員權限。
- 修復連線設定權限：由平常使用本程式的帳號雙擊指令，再同意 UAC。
- 修改 Windows 防火牆規則：需要系統管理員權限。

套件應放在使用者可寫入的固定資料夾。詳見[完整權限操作表](WebaccessAPI/README.md#windows-管理員權限)。

## 功能

- WebAccess 警報監控與測點專屬平面圖。
- 圖片、GIF、MP4、PDF 待機輪播及跑馬燈。
- Windows 系統匣與開機自動啟動。
- Windows DPAPI 密碼保護。
- 設定版本衝突防護、缺檔復原及媒體延遲重試。

## 使用環境與更新

支援 Windows x64。服務與管理頁供可信任的內網使用；WebAccess 連線設定請在服務主機以 localhost 開啟工程設定頁操作。BrightSign 播放能力依型號及韌體而定。

更新前請先停止程式，並備份 `data` 資料夾與 `portable.config.json`；更新時保留這兩項資料。

若舊版已啟用開機自動啟動，更新後請重新執行「進階管理工具」中的「啟用開機自啟動.cmd」，以建立系統匣登入排程。

完整操作與開發說明請參閱 [WebaccessAPI/README.md](WebaccessAPI/README.md)。

## v0.3.0 更新內容

- 新增 Windows 系統匣，可查看狀態及管理服務。
- 啟用開機自動啟動後，登入 Windows 時自動顯示系統匣。
- 改善系統匣操作，避免啟動服務時選單卡住。
- 整理可攜式套件的指令，將備用工具集中至「進階管理工具」。
