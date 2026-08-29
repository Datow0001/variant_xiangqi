import { defineStore } from 'pinia';
import {
  GameStatePayload,
  LoadoutItem,
  Move,
  ServerEvent,
  UpgradeId,
  UPGRADES,
} from '../../../shared/types';

export type GameStatus = 'STAGE_SELECT' | 'LOADOUT' | 'PLAYING';

export const useGameStore = defineStore('game', {
  state: () => ({
    status: 'STAGE_SELECT' as GameStatus,
    stageId: 1 as 1 | 2 | 3,
    playerColor: 'red' as 'red' | 'black',
    maxBudget: 10,
    playerLoadouts: [] as LoadoutItem[],
    selectedSquare: null as string | null, // e.g. "b0"

    // WebSocket 與遊戲局況
    ws: null as WebSocket | null,
    gameState: null as GameStatePayload | null,
    errorMessage: null as string | null,
    isAiThinking: false,
  }),

  getters: {
    spentBudget(state): number {
      return state.playerLoadouts.reduce((sum, item) => {
        const upgrade = UPGRADES[item.upgradeId];
        return sum + (upgrade ? upgrade.cost : 0);
      }, 0);
    },

    remainingBudget(): number {
      return this.maxBudget - this.spentBudget;
    },

    isFlipped(state): boolean {
      return state.playerColor === 'black';
    },

    currentLegalMovesForSelected(state): Move[] {
      if (!state.selectedSquare || !state.gameState) return [];
      return state.gameState.legalMoves.filter(
        (m) => m.from === state.selectedSquare
      );
    },
  },

  actions: {
    setStage(stageId: 1 | 2 | 3) {
      this.stageId = stageId;
      this.status = 'LOADOUT';
    },

    setPlayerColor(color: 'red' | 'black') {
      this.playerColor = color;
      this.playerLoadouts = []; // 切換顏色清空原有位置配置
    },

    toggleUpgrade(position: string, upgradeId: UpgradeId) {
      const existingIndex = this.playerLoadouts.findIndex((l) => l.position === position);
      const upgrade = UPGRADES[upgradeId];
      if (!upgrade) return;

      if (existingIndex >= 0) {
        const existing = this.playerLoadouts[existingIndex];
        if (existing.upgradeId === upgradeId) {
          // 取消升級
          this.playerLoadouts.splice(existingIndex, 1);
        } else {
          // 更換升級
          const oldUpgrade = UPGRADES[existing.upgradeId];
          const diffCost = upgrade.cost - (oldUpgrade ? oldUpgrade.cost : 0);
          if (this.remainingBudget >= diffCost) {
            this.playerLoadouts[existingIndex].upgradeId = upgradeId;
          }
        }
      } else {
        // 新增升級
        if (this.remainingBudget >= upgrade.cost) {
          this.playerLoadouts.push({ position, upgradeId });
        }
      }
    },

    resetLoadouts() {
      this.playerLoadouts = [];
    },

    connectWs(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }

        const wsUrl = `ws://${window.location.hostname}:8080`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('✅ WebSocket 已連線');
          this.ws = ws;
          resolve();
        };

        ws.onmessage = (event) => {
          try {
            const data: ServerEvent = JSON.parse(event.data);
            if (data.event === 'GAME_STATE') {
              this.gameState = data.payload;
              this.isAiThinking =
                !data.payload.isGameOver &&
                data.payload.currentTurn !== this.playerColor;
              this.selectedSquare = null;
            } else if (data.event === 'ERROR') {
              this.errorMessage = data.payload.message;
              setTimeout(() => (this.errorMessage = null), 4000);
            }
          } catch (e) {
            console.error('解析 WS 封包失敗', e);
          }
        };

        ws.onerror = (err) => {
          console.error('WebSocket 連線錯誤', err);
          this.errorMessage = '伺服器連線失敗，請確認後端是否已啟動';
          reject(err);
        };

        ws.onclose = () => {
          console.log('WebSocket 連線已關閉');
          this.ws = null;
        };
      });
    },

    async startGame() {
      try {
        await this.connectWs();
        if (!this.ws) return;

        this.ws.send(
          JSON.stringify({
            action: 'START_GAME',
            payload: {
              stageId: this.stageId,
              playerColor: this.playerColor,
              budget: this.maxBudget,
              loadouts: this.playerLoadouts,
            },
          })
        );
        this.status = 'PLAYING';
      } catch (err: any) {
        this.errorMessage = '無法啟動對局：' + err.message;
      }
    },

    selectSquare(square: string) {
      if (!this.gameState || this.gameState.isGameOver || this.isAiThinking) return;

      // 如果已經點擊了某個棋子，且當前點擊的格子是其合法目標點，則觸發走步
      if (this.selectedSquare) {
        const legalMove = this.currentLegalMovesForSelected.find((m) => m.to === square);
        if (legalMove) {
          this.makeMove(this.selectedSquare, square);
          return;
        }
      }

      // 檢查點擊的格子是否有當前玩家可走棋子
      const hasMovesFromThis = this.gameState.legalMoves.some((m) => m.from === square);
      if (hasMovesFromThis) {
        this.selectedSquare = square;
      } else {
        this.selectedSquare = null;
      }
    },

    makeMove(from: string, to: string) {
      if (!this.ws || !this.gameState) return;
      this.isAiThinking = true;
      this.ws.send(
        JSON.stringify({
          action: 'MAKE_MOVE',
          payload: {
            gameId: this.gameState.gameId,
            from,
            to,
          },
        })
      );
      this.selectedSquare = null;
    },

    resign() {
      if (!this.ws || !this.gameState) return;
      this.ws.send(
        JSON.stringify({
          action: 'RESIGN',
          payload: {
            gameId: this.gameState.gameId,
          },
        })
      );
    },

    returnToStageSelect() {
      this.status = 'STAGE_SELECT';
      this.gameState = null;
      this.selectedSquare = null;
      this.playerLoadouts = [];
    },
  },
});
