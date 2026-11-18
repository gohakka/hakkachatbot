# 共下講 · 獨立客語對話介面

以 Morari 助理為後端的客語語音網站。預設 `voice_language: hak`，使用 LiveKit 的雙向音訊、實際音量波紋、即時辨識字幕及 SSE 助理回覆。包含麥克風暫停、助理靜音、文字對話與新對話。

## 本機開發

需要 Node.js 22.22 以上。執行 `npm install`，將 `.dev.vars.example` 複製為忽略追蹤的 `.dev.vars`，填入平台帳號與密碼。執行 `npm run dev`。麥克風需要 HTTPS 或 localhost；瀏覽器會自行詢問麥克風權限。

## 平台設定

- `MORARI_USERNAME`、`MORARI_PASSWORD`：後端環境秘密，部署由 Sites 管理。
- 平台主機固定為 `https://3c.ouob.net`，後端僅代理明確列出的助理 API。
- 網站目前為私人網站，服務使用設定好的同一個平台帳號。若需公開多人使用，應先加入個別使用者授權與用量限制。
- 不儲存錄音。音訊直接送往平台 LiveKit；訊息及歷史紀錄由 Morari 保存。刷新頁面會開始新的本地介面，既有紀錄仍在原平台。
- 文字對話會附上「請用客語回答」指示；實際回覆語言仍取決於平台模型。
- 語音僅設定客語，原平台未提供腔調欄位；不宣稱指定四縣或海陸。

## 檢查

`node --test tests/integration.test.mjs` 驗證 SSE 分段、跨來源阻擋、API 路徑限制、客語參數與憑證更新。`npx tsc --noEmit` 檢查型別；`npm run build` 建置 Worker 與前端。

語音測試仍需實體麥克風，請開啟頁面、允許收音，說一句話，確認字幕、客語回覆及音量波紋。
