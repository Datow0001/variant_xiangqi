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

export type GameMode = 'PVE' | 'PVP';

// -----------------------------------------------------------------------------
// WebSocket 請求與回應封包
// -----------------------------------------------------------------------------

export interface StartGamePayload {
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
}

export type ClientAction =
  | { action: 'START_GAME'; payload: StartGamePayload }
  | { action: 'MAKE_MOVE'; payload: MovePayload }
  | { action: 'RESIGN'; payload: { gameId: string } }
  | { action: 'RECONNECT'; payload: { gameId: string } };

export interface GameStatePayload {
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
  gameOverReason: 'CHECKMATE' | 'STALEMATE' | 'RESIGN' | 'REPETITION' | null;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export type ServerEvent =
  | { event: 'GAME_STATE'; payload: GameStatePayload }
  | { event: 'ERROR'; payload: ErrorPayload };
