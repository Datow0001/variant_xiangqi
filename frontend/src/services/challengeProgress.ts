import type { ChallengeSummary, LoadoutItem } from '../../../shared/types';
import { UPGRADES } from '../../../shared/types';

// Retain the old key so first-release progress migrates in place.
export const PROGRESS_KEY = 'variant-xiangqi-challenge-progress-v1';
export interface Achievement { contentVersion: number; bestStars: number; completed: true }
export interface SavedLoadout { contentVersion: number; loadouts: LoadoutItem[]; updatedAt: number }
export interface ChallengeProgress {
  schemaVersion: 2; resetAt: number; records: Record<string, Achievement>;
  lastChallengeId: string | null; selectionUpdatedAt: number; preferences: Record<string, SavedLoadout>;
}
export const emptyProgress = (): ChallengeProgress => ({ schemaVersion: 2, resetAt: 0, records: {}, lastChallengeId: null, selectionUpdatedAt: 0, preferences: {} });
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id);
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function decodeProgress(raw: string): ChallengeProgress {
  if (raw.length > 100000) throw new Error('進度檔案過大');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('進度檔案不是有效 JSON'); }
  if (!object(data) || ![1, 2].includes(data.schemaVersion as number) || !object(data.records)) throw new Error('不支援的進度格式或版本');
  const result = emptyProgress();
  if (data.schemaVersion === 2) {
    if (!natural(data.resetAt) || !natural(data.selectionUpdatedAt) || !object(data.preferences)) throw new Error('進度設定格式錯誤');
    result.resetAt = data.resetAt; result.selectionUpdatedAt = data.selectionUpdatedAt;
  }
  if (validId(data.lastChallengeId)) result.lastChallengeId = data.lastChallengeId;
  for (const [id, value] of Object.entries(data.records).slice(0, 256)) {
    if (!validId(id) || !object(value) || value.completed !== true || !natural(value.contentVersion) || value.contentVersion < 1 || !Number.isInteger(value.bestStars) || (value.bestStars as number) < 1 || (value.bestStars as number) > 3) continue;
    result.records[id] = { contentVersion: value.contentVersion, bestStars: value.bestStars as number, completed: true };
  }
  if (data.schemaVersion === 2) for (const [id, value] of Object.entries(data.preferences as Record<string, unknown>).slice(0, 256)) {
    if (!validId(id) || !object(value) || !natural(value.contentVersion) || value.contentVersion < 1 || !natural(value.updatedAt) || !Array.isArray(value.loadouts) || value.loadouts.length > 11) continue;
    const loadouts: LoadoutItem[] = [];
    let valid = true;
    for (const item of value.loadouts) {
      if (!object(item) || typeof item.position !== 'string' || !/^[a-i][0-9]$/.test(item.position) || typeof item.upgradeId !== 'string' || !Object.prototype.hasOwnProperty.call(UPGRADES, item.upgradeId) || loadouts.some(existing => existing.position === item.position)) { valid = false; break; }
      loadouts.push({ position: item.position, upgradeId: item.upgradeId as LoadoutItem['upgradeId'] });
    }
    if (valid) result.preferences[id] = { contentVersion: value.contentVersion, updatedAt: value.updatedAt, loadouts };
  }
  return result;
}
export function parseProgress(raw: string | null): ChallengeProgress {
  try { return raw ? decodeProgress(raw) : emptyProgress(); } catch { return emptyProgress(); }
}
export function validLoadouts(definition: ChallengeSummary, items: LoadoutItem[]): LoadoutItem[] {
  const accepted: LoadoutItem[] = []; let spent = 0;
  for (const item of items) {
    if (!definition.allowedUpgrades.some(allowed => allowed.position === item.position && allowed.upgradeId === item.upgradeId) || accepted.some(existing => existing.position === item.position)) continue;
    const cost = UPGRADES[item.upgradeId].cost;
    if (spent + cost > definition.budget) continue;
    accepted.push({ ...item }); spent += cost;
  }
  return accepted;
}
export function reconcileProgress(progress: ChallengeProgress, catalogue: ChallengeSummary[]): ChallengeProgress {
  const result = emptyProgress(); result.resetAt = progress.resetAt; result.selectionUpdatedAt = progress.selectionUpdatedAt;
  for (const definition of catalogue) {
    const existing = progress.records[definition.id];
    if (existing?.contentVersion === definition.contentVersion) result.records[definition.id] = { ...existing };
    const preference = progress.preferences[definition.id];
    if (preference?.contentVersion === definition.contentVersion) result.preferences[definition.id] = { ...preference, loadouts: validLoadouts(definition, preference.loadouts) };
  }
  result.lastChallengeId = catalogue.some(item => item.id === progress.lastChallengeId) ? progress.lastChallengeId : null;
  return result;
}
export function recordAchievement(progress: ChallengeProgress, definition: ChallengeSummary, stars: number): void {
  if (!Number.isInteger(stars) || stars < 1 || stars > 3) return;
  const previous = progress.records[definition.id];
  progress.records[definition.id] = { completed: true, contentVersion: definition.contentVersion,
    bestStars: previous?.contentVersion === definition.contentVersion ? Math.max(previous.bestStars, stars) : stars };
}
export function rememberSelection(progress: ChallengeProgress, definition: ChallengeSummary, loadouts: LoadoutItem[], now = Date.now()): void {
  const existing = progress.preferences[definition.id];
  const valid = validLoadouts(definition, loadouts);
  if (progress.lastChallengeId === definition.id && existing?.contentVersion === definition.contentVersion && JSON.stringify(existing.loadouts) === JSON.stringify(valid)) return;
  const stamp = Math.max(now, progress.selectionUpdatedAt + 1, progress.resetAt + 1, (existing?.updatedAt ?? 0) + 1);
  progress.lastChallengeId = definition.id; progress.selectionUpdatedAt = stamp;
  progress.preferences[definition.id] = { contentVersion: definition.contentVersion, loadouts: valid, updatedAt: stamp };
}
export function mergeProgress(a: ChallengeProgress, b: ChallengeProgress): ChallengeProgress {
  if (a.resetAt !== b.resetAt) return clone(a.resetAt > b.resetAt ? a : b);
  const result = emptyProgress(); result.resetAt = a.resetAt;
  for (const id of [...new Set([...Object.keys(a.records), ...Object.keys(b.records)])].sort()) {
    const left = a.records[id], right = b.records[id];
    result.records[id] = !left ? { ...right } : !right ? { ...left } : left.contentVersion !== right.contentVersion ? { ...(left.contentVersion > right.contentVersion ? left : right) }
      : { ...left, bestStars: Math.max(left.bestStars, right.bestStars) };
  }
  for (const id of [...new Set([...Object.keys(a.preferences), ...Object.keys(b.preferences)])].sort()) {
    const left = a.preferences[id], right = b.preferences[id];
    const winner = !left ? right : !right ? left : left.contentVersion !== right.contentVersion ? left.contentVersion > right.contentVersion ? left : right
      : left.updatedAt !== right.updatedAt ? left.updatedAt > right.updatedAt ? left : right : JSON.stringify(left) > JSON.stringify(right) ? left : right;
    result.preferences[id] = clone(winner);
  }
  const selection = a.selectionUpdatedAt !== b.selectionUpdatedAt ? a.selectionUpdatedAt > b.selectionUpdatedAt ? a : b : (a.lastChallengeId ?? '') > (b.lastChallengeId ?? '') ? a : b;
  result.lastChallengeId = selection.lastChallengeId; result.selectionUpdatedAt = selection.selectionUpdatedAt;
  return result;
}
export function resetProgress(progress: ChallengeProgress, now = Date.now()): ChallengeProgress {
  const reset = emptyProgress(); reset.resetAt = Math.max(now, progress.resetAt + 1, progress.selectionUpdatedAt + 1); return reset;
}
export function importProgress(raw: string, current: ChallengeProgress, catalogue: ChallengeSummary[]): ChallengeProgress {
  const imported = reconcileProgress(decodeProgress(raw), catalogue);
  if (Object.keys(imported.records).length === 0 && Object.keys(imported.preferences).length === 0) throw new Error('檔案沒有可合併的相容成績或配點');
  // An imported backup must never reset local results or override the current selection.
  imported.resetAt = current.resetAt; imported.lastChallengeId = current.lastChallengeId; imported.selectionUpdatedAt = current.selectionUpdatedAt;
  for (const [id, preference] of Object.entries(imported.preferences)) {
    preference.updatedAt = 0;
    if (current.preferences[id]?.contentVersion === preference.contentVersion) imported.preferences[id] = current.preferences[id];
  }
  return mergeProgress(current, imported);
}
export function exportProgress(progress: ChallengeProgress): string {
  // Explicit allowlist: no session id, resume token, board or network credentials.
  return JSON.stringify({ schemaVersion: 2, resetAt: 0, records: progress.records, lastChallengeId: progress.lastChallengeId,
    selectionUpdatedAt: progress.selectionUpdatedAt, preferences: progress.preferences }, null, 2);
}
