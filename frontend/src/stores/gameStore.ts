import { defineStore } from 'pinia';
import {
  GameMode,
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
    gameMode: 'PVE' as GameMode,

    // PVE 專屬設定
    stageId: 1 as 1 | 2 | 3,
    playerColor: 'red' as 'red' | 'black',
    playerLoadouts: [] as LoadoutItem[],

    // PVP 專屬設定
    activeLoadoutTab: 'red' as 'red' | 'black',
    redLoadouts: [] as LoadoutItem[],
    blackLoadouts: [] as LoadoutItem[],
    autoFlipOnTurn: false,
    manualFlipped: false,

    maxBudget: 10,
    selectedSquare: null as string | null, // e.g. "b0"

    // WebSocket 與遊戲局況
    ws: null as WebSocket | null,
    gameState: null as GameStatePayload | null,
    errorMessage: null as string | null,
    isAiThinking: false,
  }),

  getters: {
    spentBudget(state): number {
      const targetList =
        state.gameMode === 'PVE'
          ? state.playerLoadouts
          : state.activeLoadoutTab === 'red'
          ? state.redLoadouts
          : state.blackLoadouts;

      return targetList.reduce((sum, item) => {
        const upgrade = UPGRADES[item.upgradeId];
        return sum + (upgrade ? upgrade.cost : 0);
      }, 0);
    },

    redSpentBudget(state): number {
      return state.redLoadouts.reduce((sum, item) => {
        const upgrade = UPGRADES[item.upgradeId];
        return sum + (upgrade ? upgrade.cost : 0);
      }, 0);
    },

    blackSpentBudget(state): number {
      return state.blackLoadouts.reduce((sum, item) => {
        const upgrade = UPGRADES[item.upgradeId];
        return sum + (upgrade ? upgrade.cost : 0);
      }, 0);
    },

    remainingBudget(): number {
      return this.maxBudget - this.spentBudget;
    },

    isFlipped(state): boolean {
      if (state.gameMode === 'PVE') {
        return state.playerColor === 'black';
      }
      // PVP 模式
      if (state.autoFlipOnTurn && state.gameState) {
        return state.gameState.currentTurn === 'black';
      }
      return state.manualFlipped;
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
      this.gameMode = 'PVE';
      this.stageId = stageId;
      this.status = 'LOADOUT';
    },

    setPvpMode() {
      this.gameMode = 'PVP';
      this.activeLoadoutTab = 'red';
      this.status = 'LOADOUT';
    },

    setPlayerColor(color: 'red' | 'black') {
      this.playerColor = color;
      this.playerLoadouts = [];
    },

    setActiveLoadoutTab(tab: 'red' | 'black') {
      this.activeLoadoutTab = tab;
    },

    toggleManualFlip() {
      this.manualFlipped = !this.manualFlipped;
    },

    toggleAutoFlip() {
      this.autoFlipOnTurn = !this.autoFlipOnTurn;
    },

    toggleUpgrade(position: string, upgradeId: UpgradeId) {
      const targetList =
        this.gameMode === 'PVE'
          ? this.playerLoadouts
          : this.activeLoadoutTab === 'red'
          ? this.redLoadouts
          : this.blackLoadouts;

      const existingIndex = targetList.findIndex((l) => l.position === position);
      const upgrade = UPGRADES[upgradeId];
      if (!upgrade) return;

      if (existingIndex >= 0) {
        const existing = targetList[existingIndex];
        if (existing.upgradeId === upgradeId) {
          targetList.splice(existingIndex, 1);
        } else {
          const oldUpgrade = UPGRADES[existing.upgradeId];
          const diffCost = upgrade.cost - (oldUpgrade ? oldUpgrade.cost : 0);
          if (this.remainingBudget >= diffCost) {
            targetList[existingIndex].upgradeId = upgradeId;
          }
        }
      } else {
        if (this.remainingBudget >= upgrade.cost) {
          targetList.push({ position, upgradeId });
        }
      }
    },

    resetLoadouts() {
      if (this.gameMode === 'PVE') {
        this.playerLoadouts = [];
      } else if (this.activeLoadoutTab === 'red') {
        this.redLoadouts = [];
      } else {
        this.blackLoadouts = [];
      }
    },

    connectWs(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }

        // 自動判定開發環境 (Vite 5173) 與線上環境 (同連接埠 HTTPS/WSS)
        const isDev = window.location.port === '5173';
        const isHttps = window.location.protocol === 'https:';
        const wsProtocol = isHttps ? 'wss:' : 'ws:';
        const wsUrl = isDev
          ? `ws://${window.location.hostname}:8080`
          : `${wsProtocol}//${window.location.host}`;
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
              if (this.gameMode === 'PVE') {
                this.isAiThinking =
                  !data.payload.isGameOver &&
                  data.payload.currentTurn !== this.playerColor;
              } else {
                this.isAiThinking = false;
              }
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

        if (this.gameMode === 'PVE') {
          this.ws.send(
            JSON.stringify({
              action: 'START_GAME',
              payload: {
                gameMode: 'PVE',
                stageId: this.stageId,
                playerColor: this.playerColor,
                budget: this.maxBudget,
                loadouts: this.playerLoadouts,
              },
            })
          );
        } else {
          this.ws.send(
            JSON.stringify({
              action: 'START_GAME',
              payload: {
                gameMode: 'PVP',
                budget: this.maxBudget,
                redLoadouts: this.redLoadouts,
                blackLoadouts: this.blackLoadouts,
              },
            })
          );
        }
        this.status = 'PLAYING';
      } catch (err: any) {
        this.errorMessage = '無法啟動對局：' + err.message;
      }
    },

    selectSquare(square: string) {
      if (!this.gameState || this.gameState.isGameOver || this.isAiThinking)
        return;

      if (this.selectedSquare) {
        const legalMove = this.currentLegalMovesForSelected.find(
          (m) => m.to === square
        );
        if (legalMove) {
          this.makeMove(this.selectedSquare, square);
          return;
        }
      }

      const hasMovesFromThis = this.gameState.legalMoves.some(
        (m) => m.from === square
      );
      if (hasMovesFromThis) {
        this.selectedSquare = square;
      } else {
        this.selectedSquare = null;
      }
    },

    makeMove(from: string, to: string) {
      if (!this.ws || !this.gameState) return;
      if (this.gameMode === 'PVE') {
        this.isAiThinking = true;
      }
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
      this.redLoadouts = [];
      this.blackLoadouts = [];
      this.manualFlipped = false;
    },
  },
});
