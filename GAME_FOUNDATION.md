# 第一階段：遊戲基礎

## 執行與驗證

需求：Node.js 18+，npm，Fairy-Stockfish Largeboard。測試前端傳輸層使用 Node.js 內建 WebSocket，因此完整測試需 Node.js 22+；目前驗證環境為 Node.js 24。

```powershell
npm run install:all
npm run typecheck:backend
npm test
npm run build:frontend
npm run start
```

`npm test` 包含輸入驗證、FEN、對局、引擎故障、正式伺服器 WebSocket 及前端 GameSocket 傳輸測試。真實引擎測試會啟動專案 engine/ 內的程序；網路測試僅監聽 127.0.0.1 隨機連接埠。`npm run test:engine` 保留既有引擎 smoke test；`npm run test:client` 現在使用正式伺服器的整合測試。

建置後造訪 http://localhost:8080。開發時在兩個終端執行 `npm run dev:backend` 與 `npm run dev:frontend`。

後端由 tsx 執行 TypeScript；tsconfig 的 Bundler 解析模式配合目前無副檔名的匯入，`typecheck` 不產生檔案。

## 公開協定

所有請求須有唯一 `requestId`（1–80 字元）。標準預算由後端固定為 10 點，`budget` 可省略，若傳入須為 10。PVE 預設 stageId=1、playerColor=red、loadouts=[]；PVP 的 redLoadouts 與 blackLoadouts 分別驗證。每個升級必須指向己方對應的原始棋子，且不可重複。

```json
{"requestId":"start-1","action":"START_GAME","payload":{"gameMode":"PVE","stageId":1,"playerColor":"red","loadouts":[]}}
```

開局成功回傳 `GAME_STARTED`：`payload.state` 是完整對局，`payload.resumeToken` 是恢復憑證。前端收到成功回覆才切換棋盤；憑證僅存於同分頁 sessionStorage，不寫入網址或伺服器紀錄。

```json
{"requestId":"move-1","action":"MAKE_MOVE","payload":{"gameId":"...","from":"b0","to":"c2","expectedVersion":0}}
{"requestId":"resume-1","action":"RECONNECT","payload":{"gameId":"...","resumeToken":"..."}}
{"requestId":"resign-1","action":"RESIGN","payload":{"gameId":"..."}}
{"requestId":"leave-1","action":"LEAVE_GAME","payload":{"gameId":"..."}}
```

走步、認輸和離局只允許目前綁定的 socket。重連驗證恢復憑證後接手對局並關閉舊 socket；旧連線關閉不能移除已接手對局。PVP 仍是單一連線控制紅黑雙方的同機模式。

`GAME_STATE` 新增 `version`、`status`、`playerColor`、`redLoadouts`、`blackLoadouts`。版本每次實際走步或認輸遞增，狀態為 INITIALIZING / READY / PROCESSING / AI_THINKING / FINISHED / FAULTED。PROCESSING 表示正在更新走步後狀態，重連至此狀態時不能走棋，且不提供過時合法步。玩家走步確認、更新合法步後推送 AI_THINKING；AI 完成後回覆 READY。前端合法步仍完全來自引擎。

伺服器以 requestId 防止重送，並拒絕同一編號搭配不同內容。每條連線與每局各保留最近 256 筆請求；跨重連的走步重送也受保護。超出保留範圍時，expectedVersion 仍可阻止舊走步再次執行。前端不盲目重送走步，遇到模糊的超時改為重連取得完整盤面。

操作成功回覆包含 requestId。離局回覆 GAME_LEFT；錯誤回覆 ERROR，包含 code、message，能識別請求時也包含 requestId。常見錯誤：INVALID_PAYLOAD、BUDGET_EXCEEDED、ILLEGAL_MOVE、STALE_STATE、SESSION_BUSY、SESSION_FORBIDDEN、SESSION_EXPIRED、REQUEST_CONFLICT、SERVER_BUSY、ENGINE_UNAVAILABLE、ENGINE_TIMEOUT。錯誤不對玩家暴露檔案路徑或內部例外。

每條連線每分鐘最多 120 則訊息、最多 16 個待處理請求；單一封包最多 16 KiB。每 30 秒 ping/pong 偵測失效連線。

## 指定盤面：後端內部使用

```ts
const session = new GameSession(
  { gameMode: 'PVE', playerColor: 'black' },
  {
    initialFen: '4k4/9/9/9/4p4/9/9/9/9/4K4 b - - 0 1',
    movetimeMs: 300,
  },
);
await session.init();
```

指定盤面須已包含升級棋子，不能同時提供 loadout。公開 START_GAME 不接受 initialFen。初始化從 FEN 讀取行棋方，先檢查終局，必要時才讓 AI 先走。

檢查涵蓋盤面尺寸、符號、欄位、帥將數量與九宮位置、將帥對面及傳統象不過河等基本限制；不保證歷史可達性，也不代替關卡作者審核。短局目標、提示、評分與關卡 UI 留待第二階段。

走步更新 FEN 的半步與完整回合計數，對局保留 initialFen 與 history。尚未實作正式長將／長捉與完整重複局面判定；模擬器的簡易判和規則不直接用於正式對局。

## 生命週期與設定

| 環境變數 | 預設 | 用途 |
|---|---:|---|
| PORT | 8080 | HTTP 與 WebSocket 共用埠 |
| HOST | 0.0.0.0 | 監聽位址 |
| ENGINE_PATH | 依作業系統選 engine/ 下檔案 | 引擎路徑 |
| VARIANT_PATH | variants.ini | 變體設定路徑 |
| ENGINE_HASH_MB | 16 | 每局引擎 Hash，1–256 MiB |
| ENGINE_THREADS | 1 | 每局引擎搜尋執行緒，1–4 |
| MAX_ENGINES | 16 | 同時存活的對局引擎上限 |
| MAX_SESSIONS | 128 | 含結果快照的對局數量上限 |
| RECONNECT_MS | 120000 | 斷線後保留時間 |
| RESULT_MS | 120000 | 終局／故障快照保留時間 |
| IDLE_MS | 900000 | 無遊戲操作的閒置上限 |

前端可在 Vite 環境設定 VITE_WS_URL。開發預設同主機 8080；正式版依目前網址選擇 ws/wss。前端自動恢復最長嘗試 120 秒，伺服器保留时间若另行調整須一起確認產品體驗。

同一 socket 再開局會清理舊局；離局立即清理；終局與故障立即釋放引擎，暫存結果。初始化期間斷線會立即清理未交付憑證的對局。短暫斷線時已開始的 AI 搜尋可完成，恢復後取最新快照。引擎超時會 stop 並銷毀，避免遲到輸出污染後续查詢；故障狀態不判玩家負。

HTTP `/healthz` 僅表示服務程序可回應，不保證引擎可用。SIGINT／SIGTERM 會清理所有對局與 socket。

對局存在單一程序記憶體，伺服器重啟或跨執行個體不能恢復。本階段尚未部署，未驗證雲端多實例；後續部署需處理連線路由、共用保存或明確限制單實例。引擎維持伺服器端，不下發至瀏覽器。

## 瀏覽器驗證

已確認 PVE 10 點配點、開局等待、走棋時禁用棋盤、AI 回應、重新整理恢復棋子與盤面、認輸、再次開局、返回首頁及離局後重新整理不再恢復舊局。亦確認 PVP 紅黑各自配點、輪流行棋，以及重新整理恢復雙方配置。瀏覽器過程未見 console 警告或錯誤。自動斷線恢復與請求超時另由真實 WebSocket 的前端傳輸測試驗證。
