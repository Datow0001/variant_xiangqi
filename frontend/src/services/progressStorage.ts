import { ChallengeProgress, mergeProgress, parseProgress, PROGRESS_KEY, reconcileProgress } from './challengeProgress';
import type { ChallengeSummary } from '../../../shared/types';
export interface ProgressStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type ProgressLock = (work: () => Promise<ChallengeProgress>) => Promise<ChallengeProgress>;

export async function persistProgress(snapshot: ChallengeProgress, storage: ProgressStorage, catalogue?: ChallengeSummary[], lock?: ProgressLock): Promise<ChallengeProgress> {
  const work = async () => {
    const raw = storage.getItem(PROGRESS_KEY);
    let merged = mergeProgress(parseProgress(raw), snapshot);
    if (catalogue?.length) merged = reconcileProgress(merged, catalogue);
    // Normalize property order as well as values, so an unchanged score does
    // not cause another write merely because it was decoded from storage.
    merged = parseProgress(JSON.stringify(merged));
    const serialized = JSON.stringify(merged);
    if (raw !== serialized) storage.setItem(PROGRESS_KEY, serialized);
    return merged;
  };
  return lock ? lock(work) : work();
}
