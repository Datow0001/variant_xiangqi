export type UpgradeId = 'TIAN_MA' | 'FEI_XIANG' | 'PO_JI_PAO' | 'TU_JI_BING';

export interface UpgradeInfo {
  id: UpgradeId;
  name: string;
  originalPieceName: string;
  cost: number;
  symbolRed: string; // e.g. 'U'
  symbolBlack: string; // e.g. 'u'
  description: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeInfo> = {
  TIAN_MA: {
    id: 'TIAN_MA',
    name: '天馬',
    originalPieceName: '馬',
    cost: 3,
    symbolRed: 'U',
    symbolBlack: 'u',
    description: '西洋棋騎士走法，無拐馬腳（蹩腳）限制，具備完整跳躍機動性。',
  },
  FEI_XIANG: {
    id: 'FEI_XIANG',
    name: '飛象',
    originalPieceName: '相/象',
    cost: 2,
    symbolRed: 'F',
    symbolBlack: 'f',
    description: '打破楚河漢界限制，田字跳躍可直接渡河深入敵陣進攻。',
  },
  PO_JI_PAO: {
    id: 'PO_JI_PAO',
    name: '霰彈砲',
    originalPieceName: '砲/炮',
    cost: 3,
    symbolRed: 'M',
    symbolBlack: 'm',
    description: '平時走車，遠程隔一子跳吃；敵軍貼身時解鎖近戰直接開火（相鄰一格可直接吃子）。',
  },
  TU_JI_BING: {
    id: 'TU_JI_BING',
    name: '突擊兵',
    originalPieceName: '兵/卒',
    cost: 1,
    symbolRed: 'S',
    symbolBlack: 's',
    description: '未過河前即解鎖左右平移能力，大幅提升開局推進彈性。',
  },
};

export interface LoadoutItem {
  position: string; // e.g. 'b0'
  upgradeId: UpgradeId;
}

export interface Move {
  from: string; // e.g. 'b0'
  to: string;   // e.g. 'c2'
}

export type GameMode = 'PVE' | 'PVP' | 'CHALLENGE';

export interface ChallengeSummary {
  chapter: 1 | 2 | 3 | 4 | 5;
  difficulty: '入門' | '進階' | '綜合' | '挑戰' | '高手';
  themes: string[];
  learningPoint: string;
  contentVersion: number;
  id: string;
  name: string;
  description: string;
  order: number;
  playerColor: 'red' | 'black';
  goalText: string;
  maxPlayerMoves: number;
  budget: number;
  allowedUpgrades: LoadoutItem[];
  nextChallengeId: string | null;
}
export type ChallengeOutcome = 'ACTIVE' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';
export type ChallengeReason = 'CHECKMATE' | 'TARGET_CAPTURED' | 'MOVE_LIMIT' | 'PLAYER_DEFEATED' | 'OBJECTIVE_NOT_MET' | 'RESIGN' | 'INTERRUPTED';
export interface ChallengeHint {
  level: 'DIRECTION' | 'MOVE';
  text: string;
  move: Move | null;
  version: number;
}
export interface ChallengeState {
  definition: ChallengeSummary;
  outcome: ChallengeOutcome;
  reason: ChallengeReason | null;
  playerMoves: number;
  remainingMoves: number;
  targetSquare: string | null;
  directionHintUses: number;
  moveHintUses: number;
  hints: ChallengeHint[];
  stars: number;
  explanation: string | null;
  failureExplanation: string | null;
}

// -----------------------------------------------------------------------------
// WebSocket 請求與回應封包
// -----------------------------------------------------------------------------

export interface StartGamePayload {
  challengeId?: string;
  gameMode?: GameMode; // 預設 'PVE'
  stageId?: 1 | 2 | 3; // PVE 模式必填
  playerColor?: 'red' | 'black'; // PVE 模式玩家陣營
  budget?: number; // 預設 10
  loadouts?: LoadoutItem[]; // PVE 模式使用
  redLoadouts?: LoadoutItem[]; // PVP 模式紅方使用
  blackLoadouts?: LoadoutItem[]; // PVP 模式黑方使用
}

export interface MovePayload {
  gameId: string;
  from: string;
  to: string;
  expectedVersion: number;
}

export type SessionStatus = 'INITIALIZING' | 'READY' | 'PROCESSING' | 'AI_THINKING' | 'FINISHED' | 'FAULTED';

export type ClientAction = ({ requestId: string } & (
  | { action: 'START_GAME'; payload: StartGamePayload }
  | { action: 'MAKE_MOVE'; payload: MovePayload }
  | { action: 'RESIGN'; payload: { gameId: string } }
  | { action: 'RECONNECT'; payload: { gameId: string; resumeToken: string } }
  | { action: 'LIST_CHALLENGES'; payload: Record<string, never> }
  | { action: 'REQUEST_HINT'; payload: { gameId: string; level: 'DIRECTION' | 'MOVE'; expectedVersion: number } }
  | { action: 'LEAVE_GAME'; payload: { gameId: string } }));

export interface GameStatePayload {
  challenge: ChallengeState | null;
  version: number;
  status: SessionStatus;
  playerColor?: 'red' | 'black';
  redLoadouts: LoadoutItem[];
  blackLoadouts: LoadoutItem[];
  gameId: string;
  gameMode: GameMode;
  stageId?: number;
  fen: string;
  currentTurn: 'red' | 'black';
  lastMove: Move | null;
  legalMoves: Move[];
  aiLoadouts: LoadoutItem[];
  isCheck: boolean;
  isGameOver: boolean;
  winner: 'red' | 'black' | 'draw' | null;
  gameOverReason: 'CHECKMATE' | 'STALEMATE' | 'RESIGN' | 'REPETITION' | 'CHALLENGE_COMPLETE' | 'MOVE_LIMIT' | null;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export type ServerEvent =
  | { event: 'CHALLENGE_LIST'; payload: ChallengeSummary[]; requestId: string }
  | { event: 'CHALLENGE_HINT'; payload: { gameId: string; hint: ChallengeHint; available: boolean; state: GameStatePayload }; requestId: string }
  | { event: 'GAME_STATE'; payload: GameStatePayload; requestId?: string }
  | { event: 'GAME_STARTED'; payload: { state: GameStatePayload; resumeToken: string }; requestId: string }
  | { event: 'GAME_LEFT'; payload: { gameId: string }; requestId: string }
  | { event: 'ERROR'; payload: ErrorPayload; requestId?: string };
