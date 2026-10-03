# GCP 測試版部署與發布

## 已有服務與基準版本

以下資訊來自 2026-10-03 提供的 Console 截圖／YAML，尚未透過本機 CLI 重新查詢雲端。

| 項目 | 值 |
|---|---|
| 專案 ID／編號 | `gen-lang-client-0656791737`／`908362333422` |
| 服務／區域 | `variant-xiangqi`／`asia-east1` |
| 主要網址 | `https://variant-xiangqi-908362333422.asia-east1.run.app` |
| 相容舊網址 | `https://variant-xiangqi-qrsxycdmxa-de.a.run.app` |
| 原線上修訂版本 | `variant-xiangqi-00004-69k` |
| 原線上 commit | `79f71e1114bb44199b007c13a45b042cf2f69d32` |
| 前四階段本機基準 | `e031e19`；新管線本身需再提交，部署時用完整新 commit |
| 建置觸發條件 | `e0c2384b-5505-4232-9655-0b878a591a51`，global，GitHub `Datow0001/variant_xiangqi`，推送 `^main$` |
| Artifact Registry | `asia-east1-docker.pkg.dev/gen-lang-client-0656791737/cloud-run-source-deploy/variant_xiangqi/variant-xiangqi` |
| 原資源／流量 | 1 CPU、512 MiB、並行 80、服務及修訂版本最大 20、100% 跟隨 LATEST |

原觸發條件使用內嵌設定，自動建置並立即部署。沒有人工建置核准。新增檔案不會自行改變 Console 設定；首次推送前必須完成下節切換。

## 首次切換順序

1. 先完成本機測試，提交此次 Dockerfile、腳本、文件及 `cloudbuild.yaml`，暫不 push。
2. Console → Cloud Build → 觸發條件 → 編輯既有條件，將設定改為「Cloud Build 設定檔 → 儲存區」，路徑填 `cloudbuild.yaml`。保留儲存庫、分支、替代變數及原建置服務帳戶，儲存。新 `_PREVIEW_*` 變數有檔案預設值；若 Console 另有同名值，以 Console 覆寫值為準。
3. 確認設定已改成儲存庫檔案後才 push。舊內嵌流程不應再執行。若本機無法修改 Console，由使用者完成步驟 2；不要先推送碰運氣。
4. 觀察 Cloud Build，依序確認 ValidateContext、BuildAndVerifyLinux、Push、DeployPreview、SmokePreview 全部成功。
5. 保存建置記錄中的完整 commit、修訂版本、測試網址、原流量配置及驗收結果。`.deployment/preview.json` 是 Cloud Build 工作區的產物，預設不會自動下載到本機；可從最後一步記錄取得同樣的資訊。資料沒有恢復憑證。
6. 依 `PLAYER_TESTING.md` 完成實機驗收後，再執行發布。服務主網址在這之前仍指向原版本。

首次切換若檔案路徑錯誤，建置應失敗並保留原版本；先修正觸發條件，不要改回會立即發布的舊內嵌流程。

## 新管線與容器

`cloudbuild.yaml` 使用既有服務，只有帶唯一 tag 的預覽部署。修訂版本名為 `variant-xiangqi-preview-短SHA-建置ID前8碼`。`--no-traffic` 會將原本跟隨 LATEST 的流量固定到部署前版本；不會自動發布之後的修訂版本。驗證腳本會比較部署前後的具體修訂版本流量，若不同便失敗。[gcloud 官方參考](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update)

Dockerfile 使用 Node 24、Debian bookworm、Linux amd64；前後端都用 `npm ci --include=dev`。後端目前透過 tsx 執行 TypeScript，因此保留 tsx 與所需開發相依套件，尚未改成後端 JS 編譯產物。

引擎固定官方 `fairy_sf_14` 的 `fairy-stockfish-largeboard_x86-64`，由官方資產下載後以 `deployment/engine.sha256` 比對。本次實際下載計算的 SHA-256 為 `41b8b4d539adfd9924929ee4a948d1a37dd1e9beaa535a811cb5e7fee9e4cb99`，檔案 2,527,680 bytes。這是固定資產完整性核對，不是上游簽章驗證。更新引擎時重新取得校驗值並驗證全部關卡。

預設 Docker runtime target 必須先完成 Linux 型別檢查、前端建置、完整測試及全部 20 關策略驗證。最終 runtime 以非 root 的 node 使用者執行，建置時再啟動短暫伺服器，檢查健康版本、前端 JS、WebSocket、提示、重連、將殺、天馬升級及 PVE AI。任一步失敗便無法完成映像與部署。Node 基底以 LTS／作業系統標籤指定，尚未鎖定映像 digest；實際建置映像 digest 應隨發布記錄保留。

正式對外 `/api/health` 回傳 status 與 APP_VERSION，沒有憑證或環境設定；它只證明 HTTP 程序存活。引擎功能必須由驗收腳本確認。預覽驗收會使用少量真實引擎，結束後送出 LEAVE_GAME；若中途失聯，資源由既有逾時機制清理。

健康檢查避免使用 `/healthz`：Cloud Run 保留部分以 `z` 結尾的路徑，可能在請求進入容器之前回傳 Google 前端的 404。首次建構 `1bbc144f-6840-4031-a60f-474fa117c028` 已通過 Linux 建構與預覽部署，但因此在外部健康檢查失敗；改用 `/api/health` 後必須重新完成外部驗收。參考 [Cloud Run 保留路徑](https://docs.cloud.google.com/run/docs/known-issues#reserved-url-paths)。

## 測試版資源與限制

| 設定 | 初始值 | 用途 |
|---|---|---|
| CPU／記憶體 | 1 CPU／1 GiB | 初始測試配置，尚未量測雲端需求 |
| 並行 HTTP／WebSocket | 8 | 不是可同時遊玩的保證人數 |
| 新修訂版本最大／最小實例 | 1／0 | 降低跨實例重連問題，不維持付費常駐 |
| Session affinity | 開啟 | 盡力維持路由，驗收仍需實際重連 |
| MAX_ENGINES／MAX_SESSIONS | 4／32 | 拒絕超過容量的對局，包含初始化期間 |
| ENGINE_THREADS／HASH | 1／16 MB | 每個引擎限制，並非完整程序記憶體 |
| request／reconnect／idle | 3600 秒／120 秒／900 秒 | 對局仍受生命週期限制 |

以上是初始設定而非容量證明。新預覽只修改新修訂版本的最大實例設定，沿用的服務層最大值仍是 20；沒有在自動建置中縮減正在服務舊版本的全服務上限。發布至明確新修訂版本後，正常流量依該修訂版本上限運作。

Cloud Run 的 affinity 與最大實例設定都不能提供永久棋局保證；實例替換、短暫超出上限、舊 WebSocket、冷啟動及部署切換都要納入測試。[WebSocket 說明](https://docs.cloud.google.com/run/docs/triggering/websockets)、[最大實例限制](https://docs.cloud.google.com/run/docs/configuring/max-instances-limits)。Cloud Run 執行個體與 Cloud Build／Registry 有各自費用；標籤網址不等於私密環境，繼承原服務的公開存取設定。預覽會累積 tags／revisions，需要定期人工整理不再使用的版本，保留發布與回復目標。

本機成績按 origin 保存：預覽網址、主網址、相容舊網址彼此不共用 localStorage。試玩主網址請固定同一入口，必要時使用備份移轉。

## 本機與預覽驗收指令

```powershell
npm test
npm run test:deployment
npm run typecheck:backend
npm run build:frontend
npm run smoke:deployment -- --self-host --expect-version development
npm run smoke:deployment -- --self-host --expect-version development --clients 4
```

已安裝 Docker 的環境另執行（本次工作電腦未安裝 Docker）：

```bash
docker build --platform=linux/amd64 --build-arg BUILD_COMMIT=development -t variant-xiangqi:local .
docker run --rm -p 8080:8080 variant-xiangqi:local
```

在另一終端針對正在執行的容器測試：

```bash
npm run smoke:deployment -- --url http://127.0.0.1:8080/ --expect-version development
```

雲端測試：

```bash
npm ci --include=dev --prefix backend
npm run smoke:deployment -- --url https://測試標籤網址/ --expect-version 完整40字元SHA
npm run smoke:deployment -- --url https://測試標籤網址/ --expect-version 完整40字元SHA --clients 2
npm run smoke:deployment -- --url https://測試標籤網址/ --expect-version 完整40字元SHA --clients 4
npm run smoke:deployment -- --url https://測試標籤網址/ --expect-version 完整40字元SHA --clients 8
```

容量腳本只做一次並行開局與玩家／AI 回合，輸出 accepted、busy、走步延遲 p95，最後清理。busy 是預期容量拒絕，不自動視為錯誤；需要依預期上限判讀，不可將 exit 0 等同八人都能遊玩。它不是長時間壓力測試。配合 Console CPU、記憶體、錯誤與實例數觀察至少 10 分鐘混合操作，再決定是否增加容量。

## 手動發布與回復

需已安裝並登入 gcloud，操作者有 Cloud Run 查詢及更新流量權限。Cloud Build 建置帳戶沿用既有部署授權，不額外擴權。若出現 IAM 錯誤，依失敗操作授予最小必要權限，勿直接增加 Owner。

先產生計畫，這些指令預設不呼叫 gcloud：

```bash
npm run release:plan -- publish --revision 新的完整修訂版本名稱 --commit 完整40字元SHA
npm run release:plan -- rollback --revision variant-xiangqi-00004-69k
```

驗收並核對計畫後，加入 `--execute` 才執行：

```bash
npm run release:plan -- publish --revision 新的完整修訂版本名稱 --commit 完整40字元SHA --execute
npm run release:plan -- rollback --revision variant-xiangqi-00004-69k --execute
```

發布會查詢 Ready、比對 commit 標籤、重新測試該修訂版本的 tagged URL、檢查驗收期間流量沒有被別人修改，再記錄原流量至 `.deployment/`，切換到明確修訂版本 100%，最後重新查詢確認。回復也檢查 Ready／保存原流量；舊版沒有新協定與版本端點，所以不執行新版 smoke，回復後立即人工測試舊版首頁與對局。日後回復目標應使用當次發布記錄，不永遠假設 00004 是上一版。

不要用 `--to-latest` 發布，避免下一次建置又自動接收正式流量。即使發布時重新 smoke，人工實機和玩家驗收仍不可省略。切流量不會搬移記憶體棋局；既有連線與重新連線可能中斷，選低流量時段並告知試玩者。成績備份不包含活躍棋局。

若使用 Cloud Shell，先從儲存庫取得已提交的新腳本；別在服務端安裝不明腳本。本機 Windows 的 release 工具會透過 `gcloud.cmd` 執行，尚未在本機已安裝 gcloud 的環境驗證；Cloud Shell／Linux 是首次發布建議環境。

## 本次驗證狀態

- Windows／Node 24：47 項遊戲測試、3 項部署設定／發布規則測試、型別檢查、前端建置、self-host 真實引擎驗收通過。
- 本機 4 對局探測：4 accepted、0 busy，一回合 p95 約 306 ms；這不是 Cloud Run 的容量結果。
- 本機超額探測：8 個開局中 4 accepted、4 busy，一回合 p95 約 304 ms，容量拒絕正常。
- 官方 Linux 引擎已下載並取得 SHA-256，沒有在 Windows 執行該 Linux 二進位。
- 本機沒有 Docker／gcloud：Linux 映像建置、Cloud Build 執行、tagged URL、發布／回復與雲端承載仍待驗證。自動流程已設關卡，不將未執行的項目標成通過。
- 未修改 Console、未 push、未部署或切換流量。此次檔案尚待另行 commit。
