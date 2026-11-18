# 哈妮 Hani · 客語即時聊天機器人

國立聯合大學客家研究學院客家AI生態系的客語通話介面，標題為「想講客話，打分哈妮」。以 Morari 助理為後端，預設 `voice_language: hak`，使用 LiveKit 雙向音訊與 SSE 字幕串流。

包含圓圈音量波紋、通話計時、掛斷、麥克風暫停、助理靜音、語音恢復、可開關的置頂字幕與文字對話。固定招呼為「你好，食飽吂？」，掛斷道別為「承蒙你，正來尞」。招呼若被瀏覽器阻擋自動播放，會在按下開始通話後重試。

## 本機開發

需要 Node.js 22.22 以上。執行 `npm install`，將 `.dev.vars.example` 複製為忽略追蹤的 `.dev.vars`，填入平台帳號與密碼。執行 `npm run dev`。麥克風需要 HTTPS 或 localhost；瀏覽器會自行詢問麥克風權限。

## 平台設定

- `MORARI_USERNAME`、`MORARI_PASSWORD`：僅設定在後端環境，不可寫入前端、Git 或公開設定檔。現行部署由 Sites 管理。
- 平台主機固定為 `https://3c.ouob.net`，後端僅代理明確列出的助理 API。
- 網站目前為私人網站，服務使用設定好的同一個平台帳號。若需公開多人使用，應先加入個別使用者授權與用量限制。
- 不儲存錄音。音訊直接送往平台 LiveKit；訊息及歷史紀錄由 Morari 保存。刷新頁面會開始新的本地介面，既有紀錄仍在原平台。
- 文字對話會附上「請用客語回答」指示；實際回覆語言仍取決於平台模型。
- 語音僅設定客語，原平台未提供腔調欄位；不宣稱指定四縣或海陸。

## 檢查

`node --test tests/*.test.mjs` 驗證串流、API 限制、憑證更新、語音恢復及招呼播放。`npx tsc --noEmit` 檢查型別；`npm run build` 建置 Worker 與前端。

語音測試仍需實體麥克風，請開啟頁面、允許收音，說一句話，確認字幕、客語回覆及音量波紋。

## 部署

目前是 Vinext + Cloudflare Worker 架構，API 入口在 `worker/index.ts`，平台串接在 `lib/morari.ts`。`.openai/hosting.json` 記錄既有 Sites 部署識別，沒有帳密。

此版本尚未遷移為 Vercel 專案。部署到 Vercel 前，需調整建置方式及 API 路由、環境變數和串流執行時間；公開服務還需加入訪客授權、對話隔離與用量限制。

固定語音的腔調、語者及長度見 [音訊規格](public/audio/README.md)。
