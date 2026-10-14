# BrightSign WebAccess Alarm Display

Windows 免安裝的 WebAccess 警報平面圖與 BrightSign 顯示系統。

## 下載使用

前往右側 **Releases**，或開啟 [最新版本下載](https://github.com/LMonkey1025/brightsign-webaccess-alarm-display/releases/latest)。

1. 在 Assets 下載 **BrightSignAlarm-v0.1.0-win-x64.zip**。GitHub 自動提供的 Source code 是原始碼，不是免安裝程式。
2. 將 ZIP 完整解壓縮到固定資料夾，例如 `C:\BrightSignAlarm`（不要直接在 ZIP 內啟動）。
3. 雙擊「開啟設定頁.cmd」。套件內含 Node.js，不需另外安裝 Node.js 或 npm。
4. 進入「工程設定」設定 WebAccess 連線、平面圖及測點。
5. BrightSign 播放器開啟 `http://主機IP:3006/display`。

## 何時需要系統管理員權限

- 一般啟動、內容編輯、媒體上傳及網頁中的監控開關：通常不需要。
- 「啟用／取消開機自啟動.cmd」：按右鍵 →「以系統管理員身分執行」。網頁操作會在需要時要求 UAC 管理員授權。
- 「停止警報系統.cmd」：若服務由開機排程以 SYSTEM 或其他管理員啟動，請以系統管理員身分執行。
- 「修復連線設定權限.cmd」：由平常使用本程式的帳號直接雙擊，再同意 UAC，才能保留正確的使用者權限。
- 修改 Windows 防火牆規則：需要管理員權限。

套件應放在使用者可寫入的固定資料夾。詳見 [完整權限操作表](WebaccessAPI/README.md#windows-管理員權限)。

## 功能

- WebAccess 警報監控與測點專屬平面圖。
- 圖片、GIF、MP4、PDF 待機輪播及跑馬燈。
- Windows 開機自啟動與 DPAPI 密碼保護。
- 設定版本衝突防護、缺檔復原及媒體延遲重試。

## 使用環境與更新

Windows x64；服務與管理頁供可信任內網使用。WebAccess 連線設定請在服務主機以 localhost 開啟工程頁操作。BrightSign 播放能力仍依型號及韌體而定。

更新前先停止程式並備份 data，更新時保留 data 與 portable.config.json。

完整操作與開發說明請參閱 [WebaccessAPI/README.md](WebaccessAPI/README.md)。
