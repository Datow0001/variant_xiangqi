import { defineStore } from 'pinia';
import {
  GameMode,
  ChallengeSummary,
  ChallengeHint,
  GameStatePayload,
  LoadoutItem,
  Move,
  ServerEvent,
  UpgradeId,
  UPGRADES,
} from '../../../shared/types';
import { ConnectionStatus, GameSocket, SocketError } from '../services/websocket';
import { emptyProgress, parseProgress, PROGRESS_KEY, reconcileProgress, recordAchievement, rememberSelection, mergeProgress, resetProgress, validLoadouts } from '../services/challengeProgress';
import { persistProgress, ProgressLock } from '../services/progressStorage';

let socket: GameSocket | null = null;
let flowVersion = 0;
let progressQueue: Promise<unknown> = Promise.resolve();
const settledGameIds = new Set<string>();
const RESUME_KEY = 'variant-xiangqi-session-v1';
function localStorageSafeRead(): string | null { try { return localStorage.getItem(PROGRESS_KEY); } catch { return null; } }
function saveResume(value: { gameId: string; resumeToken: string } | null): void {
  try { if (value) sessionStorage.setItem(RESUME_KEY, JSON.stringify(value)); else sessionStorage.removeItem(RESUME_KEY); } catch { /* Private browsing may deny storage. */ }
}

export type GameStatus = 'STAGE_SELECT' | 'LOADOUT' | 'CHALLENGE_SELECT' | 'PLAYING';

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
    resume: null as { gameId: string; resumeToken: string } | null,
    connectionStatus: 'DISCONNECTED' as ConnectionStatus,
    isStarting: false,
    isMovePending: false,
    gameState: null as GameStatePayload | null,
    errorMessage: null as string | null,
    isAiThinking: false,
    challenges: [] as ChallengeSummary[],
    selectedChallengeId: 'rook-mate',
    isHintPending: false,
    latestHint: null as ChallengeHint | null,
    challengeProgress: emptyProgress(),
    progressStorageAvailable: true,
    progressMessage: null as string | null,
    progressRevisionNotice: false,
    isRecovering: false,
    isResignPending: false,
    pendingConfirmation: null as 'LEAVE' | 'RESIGN' | 'RESET_PROGRESS' | null,
    confirmationGameId: null as string | null,
    resumeStorageAvailable: true,
    isForeground: true,
  }),

  getters: {
    completedChallenges(state): number { return state.challenges.filter(item => state.challengeProgress.records[item.id]?.contentVersion === item.contentVersion).length; },
    totalStars(state): number { return state.challenges.reduce((sum, item) => {
      const record = state.challengeProgress.records[item.id]; return sum + (record?.contentVersion === item.contentVersion ? record.bestStars : 0);
    }, 0); },
    selectedChallenge(state): ChallengeSummary | undefined { return state.challenges.find(item => item.id === state.selectedChallengeId) ?? state.gameState?.challenge?.definition; },
    canMove(state): boolean {
      return state.isForeground && !state.pendingConfirmation && state.connectionStatus === 'CONNECTED' && !state.isMovePending && !state.isStarting && !state.isRecovering && !state.isHintPending && !state.isResignPending && state.gameState?.status === 'READY';
    },
    spentBudget(state): number {
      const targetList =
        state.gameMode !== 'PVP'
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
      if (state.gameMode !== 'PVP') {
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
    saveProgress(): Promise<void> {
      const snapshot = JSON.parse(JSON.stringify(this.challengeProgress));
      const catalogue = this.challenges.length ? [...this.challenges] : undefined;
      const task = async () => {
        try {
          const lock: ProgressLock | undefined = typeof navigator !== 'undefined' && navigator.locks
            ? async work => await navigator.locks.request('variant-xiangqi-progress', work) : undefined;
          const saved = await persistProgress(snapshot, localStorage, catalogue, lock);
          this.challengeProgress = mergeProgress(this.challengeProgress, saved); this.progressStorageAvailable = true;
        } catch { this.progressStorageAvailable = false; }
      };
      const result = progressQueue.then(task, task); progressQueue = result; return result;
    },
    mergeStoredProgress(raw: string | null) {
      const merged = mergeProgress(this.challengeProgress, parseProgress(raw));
      this.challengeProgress = this.challenges.length ? reconcileProgress(merged, this.challenges) : merged;
      void this.saveProgress();
    },
    rememberChallenge() {
      if (this.gameMode !== 'CHALLENGE' || !this.selectedChallenge) return;
      rememberSelection(this.challengeProgress, this.selectedChallenge, this.playerLoadouts); void this.saveProgress();
    },
    requestConfirmation(action: 'LEAVE' | 'RESIGN' | 'RESET_PROGRESS') {
      if (this.pendingConfirmation || this.isResignPending) return;
      if (action === 'LEAVE' && !this.isStarting && (!this.gameState || ['FINISHED', 'FAULTED'].includes(this.gameState.status))) { this.returnToStageSelect(); return; }
      this.pendingConfirmation = action; this.confirmationGameId = this.gameState?.gameId ?? null;
    },
    async confirmAction() {
      const action = this.pendingConfirmation; const id = this.confirmationGameId;
      this.pendingConfirmation = null; this.confirmationGameId = null;
      if (action === 'RESET_PROGRESS') {
        this.challengeProgress = resetProgress(mergeProgress(this.challengeProgress, parseProgress(localStorageSafeRead())));
        this.progressMessage = '本機進度已重設'; await this.saveProgress(); return;
      }
      if (action === 'LEAVE') { this.returnToStageSelect(); return; }
      if (id !== (this.gameState?.gameId ?? null)) return;
      if (action === 'RESIGN') await this.resign();
    },
    bestStars(definition: ChallengeSummary): number {
      const record = this.challengeProgress.records[definition.id];
      return record?.contentVersion === definition.contentVersion ? record.bestStars : 0;
    },
    async continueChallenges() {
      if (this.resume && this.gameState && !['FINISHED', 'FAULTED'].includes(this.gameState.status)) { await this.recoverForeground(); return; }
      await this.showChallenges(this.challengeProgress.lastChallengeId ?? undefined);
    },
    async showChallenges(id?: string) {
      this.returnToStageSelect();
      this.gameMode = 'CHALLENGE'; this.status = 'CHALLENGE_SELECT'; this.maxBudget = 0;
      if (id) this.selectedChallengeId = id;
      const flow = flowVersion;
      try {
        await this.connectWs();
        if (flow !== flowVersion) return;
        await socket!.request({ action: 'LIST_CHALLENGES', payload: {} });
        if (flow === flowVersion) this.selectChallenge(this.selectedChallengeId);
      } catch (error) { if (flow === flowVersion) this.errorMessage = error instanceof Error ? error.message : '無法取得挑戰'; }
    },
    selectChallenge(id: string) {
      const definition = this.challenges.find(item => item.id === id);
      if (!definition || this.isStarting) return;
      this.selectedChallengeId = id; this.maxBudget = definition.budget;
      const preference = this.challengeProgress.preferences[id];
      this.playerColor = definition.playerColor;
      this.playerLoadouts = preference?.contentVersion === definition.contentVersion ? validLoadouts(definition, preference.loadouts) : [];
      this.latestHint = null; this.rememberChallenge();
    },
    async requestHint(level: 'DIRECTION' | 'MOVE') {
      if (!this.canMove || this.isHintPending || !this.gameState?.challenge || !socket) return;
      const requesting = socket;
      this.isHintPending = true; this.errorMessage = null;
      try { await requesting.request({ action: 'REQUEST_HINT', payload: { gameId: this.gameState.gameId, level, expectedVersion: this.gameState.version } }); }
      catch (error) { if (socket === requesting) this.errorMessage = error instanceof Error ? error.message : '提示取得失敗'; }
      finally { if (socket === requesting) this.isHintPending = false; }
    },
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
        this.gameMode !== 'PVP'
          ? this.playerLoadouts
          : this.activeLoadoutTab === 'red'
          ? this.redLoadouts
          : this.blackLoadouts;

      const existingIndex = targetList.findIndex((l) => l.position === position);
      const upgrade = UPGRADES[upgradeId];
      if (!upgrade) return;
      if (this.gameMode === 'CHALLENGE' && !this.selectedChallenge?.allowedUpgrades.some(item => item.position === position && item.upgradeId === upgradeId)) return;

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
      this.rememberChallenge();
    },

    resetLoadouts() {
      if (this.gameMode !== 'PVP') {
        this.playerLoadouts = [];
      } else if (this.activeLoadoutTab === 'red') {
        this.redLoadouts = [];
      } else {
        this.blackLoadouts = [];
      }
      this.rememberChallenge();
    },

    connectWs(): Promise<void> {
      if (!socket) {
        const created: GameSocket = new GameSocket({
          onEvent: event => { if (socket === created) this.receiveEvent(event); },
          onStatus: status => { if (socket === created) this.connectionStatus = status; },
          onReconnected: () => { if (socket === created) void this.restoreGame(); },
          shouldReconnect: () => socket === created && !!this.resume,
          onRecoveryExpired: () => {
            if (socket !== created) return;
            this.clearResume();
            this.markInterrupted();
            this.errorMessage = '無法恢復連線，請重新開局';
          },
        });
        socket = created;
      }
      return socket.connect();
    },

    clearResume() { this.resume = null; saveResume(null); },
    markInterrupted() {
      if (!this.gameState || this.gameState.status === 'FINISHED') return;
      this.gameState.status = 'FAULTED'; this.isAiThinking = false;
      if (this.gameState.challenge?.outcome === 'ACTIVE') {
        this.gameState.challenge.outcome = 'INTERRUPTED'; this.gameState.challenge.reason = 'INTERRUPTED';
      }
    },

    receiveEvent(event: ServerEvent) {
      if (event.event === 'CHALLENGE_LIST') {
        this.challenges = event.payload.sort((a, b) => a.order - b.order);
        const compatible = reconcileProgress(this.challengeProgress, this.challenges);
        if (Object.keys(this.challengeProgress.records).some(id => !compatible.records[id])) this.progressRevisionNotice = true;
        this.challengeProgress = compatible; void this.saveProgress();
        if (!this.challenges.some(item => item.id === this.selectedChallengeId)) this.selectedChallengeId = this.challenges[0]?.id ?? '';
      } else if (event.event === 'CHALLENGE_HINT') {
        if (event.payload.gameId !== this.resume?.gameId) return;
        this.receiveState(event.payload.state);
        if (event.payload.hint.version === this.gameState?.version) this.latestHint = event.payload.hint;
      } else if (event.event === 'GAME_STARTED') {
        this.latestHint = null;
        this.resume = { gameId: event.payload.state.gameId, resumeToken: event.payload.resumeToken };
        try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(this.resume)); this.resumeStorageAvailable = true; } catch { this.resumeStorageAvailable = false; }
        this.receiveState(event.payload.state);
      } else if (event.event === 'GAME_STATE') {
        if (event.payload.gameId === this.resume?.gameId) this.receiveState(event.payload);
      } else if (event.event === 'ERROR') {
        this.errorMessage = event.payload.message;
        if (['SESSION_EXPIRED', 'SESSION_REPLACED', 'SESSION_FORBIDDEN'].includes(event.payload.code)) {
          this.clearResume(); socket?.stop();
          this.markInterrupted();
          this.isAiThinking = false;
        }
      }
    },

    receiveState(state: GameStatePayload) {
      if (this.gameState?.gameId === state.gameId && state.version < this.gameState.version) return;
      this.gameState = state;
      this.gameMode = state.gameMode;
      this.stageId = (state.stageId ?? 1) as 1 | 2 | 3;
      this.playerColor = state.playerColor ?? 'red';
      this.redLoadouts = state.redLoadouts;
      this.blackLoadouts = state.blackLoadouts;
      this.playerLoadouts = this.playerColor === 'red' ? state.redLoadouts : state.blackLoadouts;
      if (state.challenge) {
        this.selectedChallengeId = state.challenge.definition.id;
        this.maxBudget = state.challenge.definition.budget;
        const hints = state.challenge.hints.filter(hint => hint.version === state.version);
        this.latestHint = hints[hints.length - 1] ?? (this.latestHint?.version === state.version ? this.latestHint : null);
        const before = JSON.stringify(this.challengeProgress);
        if (this.challengeProgress.lastChallengeId !== state.challenge.definition.id || !this.challengeProgress.preferences[state.challenge.definition.id]) rememberSelection(this.challengeProgress, state.challenge.definition, this.playerLoadouts);
        if (state.challenge.outcome === 'SUCCEEDED' && !settledGameIds.has(state.gameId)) {
          settledGameIds.add(state.gameId); recordAchievement(this.challengeProgress, state.challenge.definition, state.challenge.stars);
          if (settledGameIds.size > 256) settledGameIds.delete(settledGameIds.values().next().value!);
        }
        if (before !== JSON.stringify(this.challengeProgress)) void this.saveProgress();
      }
      this.isAiThinking = state.status === 'AI_THINKING';
      this.selectedSquare = null;
      this.status = 'PLAYING';
    },

    async initialize() {
      try { this.challengeProgress = parseProgress(localStorage.getItem(PROGRESS_KEY)); }
      catch { this.progressStorageAvailable = false; }
      try {
        const raw = sessionStorage.getItem(RESUME_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.gameId !== 'string' || typeof saved.resumeToken !== 'string') { saveResume(null); return; }
        this.resume = { gameId: saved.gameId, resumeToken: saved.resumeToken };
        await this.connectWs();
        await this.restoreGame();
      } catch (error) { this.errorMessage = error instanceof Error ? error.message : '無法恢復對局'; }
    },

    async restoreGame() {
      if (!this.resume || !socket || this.isRecovering) return;
      const restoring = socket;
      const gameId = this.resume.gameId;
      this.isRecovering = true; this.selectedSquare = null;
      try {
        await restoring.request({ action: 'RECONNECT', payload: this.resume });
        if (socket === restoring && this.resume?.gameId === gameId) { restoring.recovered(); this.errorMessage = null; }
      } catch (error) { if (socket === restoring) this.errorMessage = error instanceof Error ? error.message : '無法恢復對局'; }
      finally { if (socket === restoring) this.isRecovering = false; }
    },
    async recoverForeground() {
      if (!this.resume || this.isStarting || this.isRecovering) return;
      this.isRecovering = true; this.selectedSquare = null;
      const flow = flowVersion;
      try {
        if (!socket) await this.connectWs();
        else await socket.refreshConnection();
      } catch (error) { if (flow === flowVersion) this.errorMessage = error instanceof Error ? error.message : '無法恢復連線'; }
      finally { if (flow === flowVersion) this.isRecovering = false; }
      if (flow === flowVersion) await this.restoreGame();
    },

    async startGame() {
      if (this.isStarting) return;
      const flow = ++flowVersion;
      this.isStarting = true;
      this.rememberChallenge();
      this.errorMessage = null;
      try {
        await this.connectWs();
        if (flow !== flowVersion) return;
        await socket!.request({
          action: 'START_GAME',
          payload: this.gameMode === 'CHALLENGE'
            ? { gameMode: 'CHALLENGE', challengeId: this.selectedChallengeId, loadouts: this.playerLoadouts }
            : this.gameMode === 'PVE'
            ? { gameMode: 'PVE', stageId: this.stageId, playerColor: this.playerColor, budget: 10, loadouts: this.playerLoadouts }
            : { gameMode: 'PVP', budget: 10, redLoadouts: this.redLoadouts, blackLoadouts: this.blackLoadouts },
        });
      } catch (error) {
        if (flow !== flowVersion) return;
        this.errorMessage = error instanceof Error ? error.message : '無法啟動對局';
        // Input rejection leaves the previous game intact; server failures may have replaced it.
        if (!(error instanceof SocketError) || !['INVALID_PAYLOAD', 'BUDGET_EXCEEDED', 'SESSION_BUSY'].includes(error.code)) {
          this.clearResume(); this.gameState = null; this.status = this.gameMode === 'CHALLENGE' ? 'CHALLENGE_SELECT' : 'LOADOUT';
        }
      } finally { if (flow === flowVersion) this.isStarting = false; }
    },
    selectSquare(square: string) {
      if (!this.canMove || !this.gameState || this.gameState.isGameOver)
        return;
      if (this.selectedSquare === square) { this.selectedSquare = null; return; }

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

    async makeMove(from: string, to: string) {
      if (!this.canMove || !this.gameState || !socket) return;
      const moving = socket;
      this.errorMessage = null;
      this.isMovePending = true;
      this.selectedSquare = null;
      try {
        await moving.request({ action: 'MAKE_MOVE', payload: { gameId: this.gameState.gameId, from, to, expectedVersion: this.gameState.version } });
      } catch (error) { if (socket === moving) this.errorMessage = error instanceof Error ? error.message : '走步失敗'; }
      finally { if (socket === moving) this.isMovePending = false; }
    },

    async resign() {
      if (!socket || !this.gameState || this.gameState.isGameOver || this.connectionStatus !== 'CONNECTED' || this.isResignPending) return;
      const resigning = socket; this.isResignPending = true;
      try { await socket.request({ action: 'RESIGN', payload: { gameId: this.gameState.gameId } }); }
      catch (error) { this.errorMessage = error instanceof Error ? error.message : '認輸失敗'; }
      finally { if (socket === resigning) this.isResignPending = false; }
    },
    returnToStageSelect() {
      flowVersion++;
      const gameId = this.resume?.gameId;
      const leaving = socket;
      socket = null;
      this.clearResume();
      if (gameId && this.connectionStatus === 'CONNECTED') {
        void leaving?.request({ action: 'LEAVE_GAME', payload: { gameId } }).catch(() => {}).finally(() => leaving.stop());
      } else leaving?.stop();
      this.connectionStatus = 'DISCONNECTED';
      this.isStarting = false;
      this.isAiThinking = false;
      this.isMovePending = false;
      this.isRecovering = false; this.isResignPending = false; this.pendingConfirmation = null;
      this.status = 'STAGE_SELECT';
      this.gameMode = 'PVE'; this.maxBudget = 10; this.isHintPending = false; this.latestHint = null; this.errorMessage = null;
      this.gameState = null;
      this.selectedSquare = null;
      this.playerLoadouts = [];
      this.redLoadouts = [];
      this.blackLoadouts = [];
      this.manualFlipped = false;
    },
  },
});
