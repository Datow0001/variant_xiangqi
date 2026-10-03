import { ClientAction, LoadoutItem, StartGamePayload, UPGRADES } from '../../shared/types';
import { isValidUci, uciToPos } from '../../shared/coordinates';
import { DEFAULT_XIANGQI_FEN, fenToBoard } from '../../shared/fen';
import { GameError } from './errors';
import { getChallenge } from './challenges';

function invalid(message: string): never { throw new GameError('INVALID_PAYLOAD', message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('請求格式錯誤');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || !value.length || value.length > max) invalid(`${label}格式錯誤`);
  return value;
}
export function validateLoadouts(value: unknown, color: 'red' | 'black', budget = 10, fen = DEFAULT_XIANGQI_FEN): LoadoutItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 11) invalid('升級清單格式錯誤');
  const board = fenToBoard(fen);
  const used = new Set<string>();
  const originals = { TIAN_MA: 'n', FEI_XIANG: 'b', PO_JI_PAO: 'c', TU_JI_BING: 'p' };
  let cost = 0;
  const items = value.map(raw => {
    const item = object(raw);
    const position = string(item.position, '位置', 2);
    const id = string(item.upgradeId, '升級');
    if (!isValidUci(position) || !Object.hasOwn(UPGRADES, id)) invalid('未知的升級或座標');
    if (used.has(position)) invalid('同一棋子不可重複升級');
    used.add(position);
    const upgradeId = id as LoadoutItem['upgradeId'];
    const { col, row } = uciToPos(position);
    const expected = color === 'red' ? originals[upgradeId].toUpperCase() : originals[upgradeId];
    if (board[9 - row][col] !== expected) invalid('升級位置必須是己方對應棋子');
    cost += UPGRADES[upgradeId].cost;
    return { position, upgradeId };
  });
  if (cost > budget) throw new GameError('BUDGET_EXCEEDED', `升級總費用不可超過 ${budget} 點`);
  return items;
}

export function normalizeStart(value: unknown): StartGamePayload {
  const data = object(value);
  const mode = data.gameMode ?? 'PVE';
  if (mode !== 'PVE' && mode !== 'PVP' && mode !== 'CHALLENGE') invalid('不支援的對戰模式');
  if (data.initialFen !== undefined) invalid('公開介面不接受自訂盤面');
  if (mode === 'CHALLENGE') {
    const challengeId = string(data.challengeId, '挑戰編號');
    const definition = getChallenge(challengeId);
    if (!definition) invalid('挑戰不存在');
    if (data.stageId !== undefined || data.redLoadouts !== undefined || data.blackLoadouts !== undefined ||
        (data.budget !== undefined && data.budget !== definition.budget) ||
        (data.playerColor !== undefined && data.playerColor !== definition.playerColor) ||
        Object.keys(data).some(key => !['gameMode', 'challengeId', 'loadouts', 'budget', 'playerColor'].includes(key))) invalid('挑戰設定由伺服器決定');
    const loadouts = validateLoadouts(data.loadouts, definition.playerColor, definition.budget, definition.initialFen);
    if (loadouts.some(item => !definition.allowedUpgrades.some(allowed => allowed.position === item.position && allowed.upgradeId === item.upgradeId))) invalid('此關卡不允許這項升級');
    return { gameMode: mode, challengeId, playerColor: definition.playerColor, budget: definition.budget, loadouts };
  }
  if (data.budget !== undefined && data.budget !== 10) invalid('標準對局預算固定為 10 點');
  if (mode === 'PVP') {
    if (data.loadouts !== undefined || data.stageId !== undefined || data.playerColor !== undefined) invalid('雙人模式設定不相容');
    return { gameMode: mode, budget: 10, redLoadouts: validateLoadouts(data.redLoadouts, 'red'), blackLoadouts: validateLoadouts(data.blackLoadouts, 'black') };
  }
  const stage = data.stageId ?? 1;
  const color = data.playerColor ?? 'red';
  if (stage !== 1 && stage !== 2 && stage !== 3) invalid('關卡不存在');
  if (color !== 'red' && color !== 'black') invalid('陣營錯誤');
  if (data.redLoadouts !== undefined || data.blackLoadouts !== undefined) invalid('單人模式設定不相容');
  return { gameMode: mode, budget: 10, stageId: stage, playerColor: color, loadouts: validateLoadouts(data.loadouts, color) };
}

export function parseAction(value: unknown): ClientAction {
  const msg = object(value);
  const requestId = string(msg.requestId, '請求編號', 80);
  const payload = object(msg.payload);
  switch (msg.action) {
    case 'LIST_CHALLENGES': return { requestId, action: msg.action, payload: {} };
    case 'REQUEST_HINT': {
      if (payload.level !== 'DIRECTION' && payload.level !== 'MOVE') invalid('提示層級錯誤');
      if (!Number.isSafeInteger(payload.expectedVersion) || (payload.expectedVersion as number) < 0) invalid('盤面版本錯誤');
      return { requestId, action: msg.action, payload: { gameId: string(payload.gameId, '對局編號'), level: payload.level, expectedVersion: payload.expectedVersion as number } };
    }
    case 'START_GAME': return { requestId, action: msg.action, payload: normalizeStart(payload) };
    case 'MAKE_MOVE': {
      const gameId = string(payload.gameId, '對局編號');
      if (typeof payload.from !== 'string' || !isValidUci(payload.from) || typeof payload.to !== 'string' || !isValidUci(payload.to)) invalid('走步座標錯誤');
      if (!Number.isSafeInteger(payload.expectedVersion) || (payload.expectedVersion as number) < 0) invalid('盤面版本錯誤');
      return { requestId, action: msg.action, payload: { gameId, from: payload.from, to: payload.to, expectedVersion: payload.expectedVersion as number } };
    }
    case 'RESIGN': case 'LEAVE_GAME': return { requestId, action: msg.action, payload: { gameId: string(payload.gameId, '對局編號') } };
    case 'RECONNECT': return { requestId, action: msg.action, payload: { gameId: string(payload.gameId, '對局編號'), resumeToken: string(payload.resumeToken, '恢復憑證') } };
    default: throw new GameError('INVALID_ACTION', '未知的請求類型');
  }
}
