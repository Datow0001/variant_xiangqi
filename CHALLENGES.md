# 第二階段：短局挑戰系統

第二階段先提供三個示範關卡，第三階段已擴充為 12 關、3 章，加入本機最佳成績與進度。完整內容與驗證方式見 [FIRST_CHALLENGES.md](./FIRST_CHALLENGES.md)。完整對局的 PVE／PVP 仍保留。首頁「短局挑戰」進入選關；第三關可在開始前升級 c3 的馬。執行方式沿用 GAME_FOUNDATION.md：`npm run build:frontend` 後 `npm run start`，開啟 http://localhost:8080。

## 已實作規則

- CHECKMATE：在玩家步數上限內將死對手。困斃不算完成將殺目標。
- CAPTURE：吃掉初始盤面指定的敵方棋子；追蹤原始棋子，目標移動時座標同步移動。任何合法解法都可通關。
- 僅成功執行的玩家走步消耗步數，AI 出步不計。最後一步先判定目標／將殺，再判定步數耗盡；用完步數仍未完成時直接結算，不再讓 AI 行棋。
- 被擊敗、步數耗盡、認輸及未達成目標的終局為 FAILED；引擎錯誤為 INTERRUPTED。連線暫時中斷可恢復；超過保留期限後顯示中斷，不計失敗。
- 通關星級：無提示 3 星、僅方向提示 2 星、使用走步提示 1 星。失敗與中斷為 0 星；結算只執行一次。
- 結果顯示原因與通關解說，支援原配置重試、重新配點／選關、成功後前往下一關。

## 關卡資料與擴充

後端 `backend/src/challenges.ts` 是唯一關卡目錄。每筆 ChallengeDefinition 包含：

| 欄位 | 用途 |
| --- | --- |
| id、order、name、description | 穩定識別與選關顯示 |
| chapter、difficulty、themes、learningPoint、contentVersion | 章節、難度、主題、學習重點與進度相容版本 |
| initialFen、playerColor、movetimeMs | 伺服器指定盤面、玩家陣營及 AI 思考時間 |
| goal、goalText、maxPlayerMoves | CHECKMATE 或 CAPTURE（targetSquare），目標說明與玩家步數上限 |
| budget、allowedUpgrades | 本關預算與可升級的原始位置／類型 |
| directionHint、hintBranches | 方向提示與各盤面的已編寫走步提示 |
| completionExplanation、nextChallengeId | 通關解說與下一關連結 |
| commonMistake、referenceLoadouts、preferredMoves | 失敗提醒、驗證用配置與優先檢查的解題走步（後兩者只在後端） |

模組載入時檢查 FEN、目標敵方棋子、允許升級、編號／排序唯一及下一關存在。FEN 驗證只確認格式與基本位置，並非歷史可達性證明。加入相同目標類型的新關卡只需新增資料；新增目標類型則需擴充 ChallengeRuntime／GameSession 判定。

提示索引採 FEN 前兩欄（棋子配置與輪到哪方），忽略計數器；有升級的盤面必須用升級後 FEN 建索引。走步提示只在目前引擎合法走步中選取；沒有對應盤面或合法提示時回傳說明，不消耗提示次數、不降低星級。它是有限的作者編寫提示，不是任意局面的解題器；新增關卡須用實際引擎驗證盤面、目標解法和提示，不能僅依 FEN 結構檢查判定可解。

## WebSocket 協定增量

所有請求沿用 requestId，及第一階段的恢復憑證與擁有者驗證。

```json
{ "requestId": "list-1", "action": "LIST_CHALLENGES", "payload": {} }
{ "requestId": "start-1", "action": "START_GAME", "payload": { "gameMode": "CHALLENGE", "challengeId": "knight-loadout", "loadouts": [{ "position": "c3", "upgradeId": "TIAN_MA" }] } }
{ "requestId": "hint-1", "action": "REQUEST_HINT", "payload": { "gameId": "...", "level": "DIRECTION", "expectedVersion": 0 } }
```

LIST_CHALLENGES 回傳 CHALLENGE_LIST 公開摘要，不含初始盤面、提示答案及判定定義。START_GAME 使用伺服器資料，拒絕未知關卡、任意盤面／目標／步數／額外欄位、預算／陣營覆寫及不允許的升級。REQUEST_HINT 限玩家 READY 回合並檢查版本，回傳 CHALLENGE_HINT `{ gameId, hint, available, state }`。同一 requestId 的提示結果會快取，跨連線重送不會重複計費；前端斷線以完整狀態恢復，不自動重送操作。

GameState 新增 `challenge`；標準對局為 null。挑戰狀態包含公開定義、outcome／reason、玩家步數、剩餘步數、目標座標、提示使用次數、近期提示（最多 20 筆）、stars 與成功解說。棋盤版本仍代表走步／認輸；提示次數透過完整快照同步，不另增加棋盤版本。

## 驗證與範圍

`npm test` 涵蓋實際引擎完成三關、多解捕獲、未升級的蹩馬腳、最後一步成功、步數耗盡、AI 不計步、目標移動、困斃／玩家敗北、提示合法性與星級、認輸／中斷、socket 重複提示／恢復／結果保留／重試。`npm run typecheck:backend` 與 `npm run build:frontend` 驗證型別和建置。

第三階段已提供完整第一輯與本機星級／進度保存；未包含帳號、雲端進度、排行榜、每日挑戰或公開部署。進行中的對局仍保留於伺服器記憶體，受第一階段的重新連線與結果保留期限限制；伺服器重啟後無法恢復對局，但此瀏覽器的最佳成績仍保留。
