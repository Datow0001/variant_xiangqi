import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, parseProgress, reconcileProgress, recordAchievement } from '../../../frontend/src/services/challengeProgress';
import { CHALLENGES, publicChallenge } from '../challenges';
import { decodeProgress, exportProgress, importProgress, mergeProgress, rememberSelection, resetProgress } from '../../../frontend/src/services/challengeProgress';
import { persistProgress } from '../../../frontend/src/services/progressStorage';

const catalogue = CHALLENGES.map(publicChallenge);

test('feature redesign invalidates only the five revised levels and retains the other fifteen', () => {
  const changed = new Set([13, 14, 18, 19, 20]);
  const progress = emptyProgress();
  for (const definition of catalogue) {
    const previous = { ...definition, contentVersion: definition.contentVersion - (changed.has(definition.order) ? 1 : 0) };
    recordAchievement(progress, previous, 3);
    rememberSelection(progress, previous, [], 100);
  }
  const current = reconcileProgress(progress, catalogue);
  assert.equal(Object.keys(current.records).length, 15);
  for (const definition of catalogue) {
    assert.equal(!!current.records[definition.id], !changed.has(definition.order), definition.id);
    assert.equal(!!current.preferences[definition.id], !changed.has(definition.order), definition.id);
  }
});

test('quality revisions discard only changed-level scores and obsolete loadout coordinates', () => {
  const previous = catalogue.map(def => ({ ...def }));
  const changed = new Set(['rook-mate', 'elephant-cross', 'screen-team', 'budget-choice', 'which-knight', 'build-a-screen', 'elephant-interlock']);
  const progress = emptyProgress();
  for (const def of previous) {
    if (changed.has(def.id)) def.contentVersion--;
    recordAchievement(progress, def, 3);
    rememberSelection(progress, def, [], 100);
  }
  progress.preferences['build-a-screen'].loadouts = [{ position: 'b2', upgradeId: 'TU_JI_BING' }];
  const current = reconcileProgress(progress, catalogue);
  for (const def of catalogue) {
    assert.equal(!!current.records[def.id], !changed.has(def.id), def.id);
    assert.equal(!!current.preferences[def.id], !changed.has(def.id), def.id);
  }
  assert.equal(Object.keys(current.records).length, 13);
});

test('v1 migration keeps achievements; backups exclude session credentials and validate compatible content', () => {
  const definition = catalogue[0];
  const migrated = decodeProgress(JSON.stringify({ schemaVersion: 1, records: { [definition.id]: { completed: true, contentVersion: definition.contentVersion, bestStars: 2 } }, lastChallengeId: definition.id }));
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.records[definition.id].bestStars, 2);
  assert.deepEqual(migrated.preferences, {});
  const extended = { ...migrated, resumeToken: 'secret', gameId: 'session', board: 'private' };
  const backup = exportProgress(extended);
  assert.doesNotMatch(backup, /secret|session|private|resumeToken|gameId|board/);
  assert.throws(() => importProgress('{', migrated, catalogue), /JSON/);
  assert.throws(() => importProgress(JSON.stringify({ schemaVersion: 9, records: {} }), migrated, catalogue), /版本/);
  assert.throws(() => importProgress(exportProgress(emptyProgress()), migrated, catalogue), /相容/);
  assert.throws(() => importProgress(backup, migrated, []), /相容/);
});

test('cross-tab merges retain best scores, newest preferences and current content; reset defeats stale writes', () => {
  const a = emptyProgress(), b = emptyProgress(); const definition = catalogue[0];
  recordAchievement(a, definition, 3); recordAchievement(b, definition, 1);
  rememberSelection(a, definition, [], 10); rememberSelection(b, catalogue[2], catalogue[2].allowedUpgrades.slice(0, 1), 20);
  const merged = mergeProgress(a, b);
  assert.deepEqual(merged, mergeProgress(b, a)); assert.equal(merged.records[definition.id].bestStars, 3);
  assert.equal(merged.lastChallengeId, catalogue[2].id);
  assert.deepEqual(mergeProgress(merged, merged), merged);
  const newVersion = emptyProgress(); recordAchievement(newVersion, { ...definition, contentVersion: definition.contentVersion + 1 }, 1);
  assert.equal(mergeProgress(merged, newVersion).records[definition.id].bestStars, 1);
  const reset = resetProgress(merged, 30);
  assert.deepEqual(mergeProgress(merged, reset), reset); assert.deepEqual(mergeProgress(reset, merged), reset);
});

test('selection restores only allowed upgrades within budget and unchanged selections do not update timestamps', () => {
  const definition = catalogue[8], progress = emptyProgress();
  rememberSelection(progress, definition, definition.allowedUpgrades, 100);
  const preference = progress.preferences[definition.id];
  assert.equal(preference.loadouts.length, 1);
  rememberSelection(progress, definition, preference.loadouts, 200);
  assert.equal(progress.selectionUpdatedAt, 100);
  preference.loadouts.push({ position: 'a9', upgradeId: 'KNIGHT' } as never);
  const reconciled = reconcileProgress(progress, catalogue);
  assert.equal(reconciled.preferences[definition.id].loadouts.length, 1);
});

test('backup merges cannot erase scores, change selection or override local loadouts with future timestamps', () => {
  const current = emptyProgress(), backup = emptyProgress();
  recordAchievement(current, catalogue[0], 3); rememberSelection(current, catalogue[2], [], 100);
  recordAchievement(backup, catalogue[0], 1); recordAchievement(backup, catalogue[1], 2);
  rememberSelection(backup, catalogue[2], catalogue[2].allowedUpgrades.slice(0, 1), 9999999999999);
  const merged = importProgress(exportProgress(backup), current, catalogue);
  assert.equal(merged.records[catalogue[0].id].bestStars, 3); assert.equal(merged.records[catalogue[1].id].bestStars, 2);
  assert.equal(merged.lastChallengeId, current.lastChallengeId); assert.deepEqual(merged.preferences, current.preferences);
});

test('storage merges queued competing writes, skips unchanged writes and exposes unavailable storage', async () => {
  let raw: string | null = null, writes = 0, lockCalls = 0;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; writes++; } };
  let queue: Promise<unknown> = Promise.resolve();
  const lock = (work: () => Promise<ReturnType<typeof emptyProgress>>) => { lockCalls++; const next = queue.then(work); queue = next; return next; };
  const first = emptyProgress(), second = emptyProgress();
  recordAchievement(first, catalogue[0], 3); recordAchievement(second, catalogue[1], 2);
  await Promise.all([persistProgress(first, storage, catalogue, lock), persistProgress(second, storage, catalogue, lock)]);
  assert.equal(Object.keys(parseProgress(raw).records).length, 2); assert.equal(lockCalls, 2);
  const before = writes; await persistProgress(parseProgress(raw), storage, catalogue, lock); assert.equal(writes, before);
  await assert.rejects(persistProgress(first, { getItem: () => { throw new Error('blocked'); }, setItem: () => {} }), /blocked/);
  await assert.rejects(persistProgress(first, { getItem: () => null, setItem: () => { throw new Error('quota'); } }), /quota/);
});

test('local progress survives serialization and lower scores never replace the best result', () => {
  const progress = emptyProgress(); const definition = publicChallenge(CHALLENGES[0]);
  recordAchievement(progress, definition, 3); recordAchievement(progress, definition, 1);
  progress.lastChallengeId = definition.id;
  assert.equal(progress.records[definition.id].bestStars, 3);
  assert.deepEqual(parseProgress(JSON.stringify(progress)), progress);
  recordAchievement(progress, definition, 0); assert.equal(progress.records[definition.id].bestStars, 3);
});

test('adding advanced chapters preserves all tutorial achievements and can save new results', () => {
  const tutorial = catalogue.filter(item => item.chapter <= 3);
  const progress = emptyProgress();
  for (const definition of tutorial) recordAchievement(progress, definition, 3);
  progress.lastChallengeId = tutorial[11].id;
  const restored = importProgress(exportProgress(progress), emptyProgress(), catalogue);
  assert.equal(Object.keys(restored.records).length, 12);
  for (const definition of tutorial) assert.equal(restored.records[definition.id].bestStars, 3);
  const advanced = catalogue.find(item => item.id === 'four-move-siege')!;
  assert.equal(restored.records[advanced.id], undefined);
  recordAchievement(restored, advanced, 2);
  assert.equal(parseProgress(exportProgress(restored)).records[advanced.id].bestStars, 2);
  assert.equal(Object.keys(restored.records).length, 13);
});
test('content changes and removed levels invalidate incompatible achievements and last-played ids', () => {
  const progress = emptyProgress(); const definition = publicChallenge(CHALLENGES[0]);
  recordAchievement(progress, definition, 3); progress.lastChallengeId = definition.id;
  const upgraded = { ...definition, contentVersion: definition.contentVersion + 1 };
  assert.deepEqual(reconcileProgress(progress, [upgraded]).records, {});
  recordAchievement(progress, upgraded, 1); assert.equal(progress.records[definition.id].bestStars, 1);
  assert.equal(reconcileProgress(progress, []).lastChallengeId, null);
});
test('corrupt storage, unknown schemas and malformed stars are ignored', () => {
  for (const raw of [null, '{', 'null', JSON.stringify({ schemaVersion: 9, records: {} }), JSON.stringify({ schemaVersion: 1, records: [] })]) assert.deepEqual(parseProgress(raw), emptyProgress());
  const parsed = parseProgress(JSON.stringify({ schemaVersion: 1, records: { good: { contentVersion: 1, bestStars: 2, completed: true }, bad: { contentVersion: 1, bestStars: 99, completed: true } }, lastChallengeId: 'good' }));
  assert.equal(parsed.records.good.bestStars, 2); assert.equal(parsed.records.bad, undefined);
});
