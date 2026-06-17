import { ref } from 'vue';
import type { BSMapInfo, DiffPair } from '../types';

export const RANK: Record<string, number> = {
  ExpertPlus: 5, Expert: 4, Hard: 3, Normal: 2, Easy: 1,
};
export const DIFF_LABEL: Record<string, string> = {
  ExpertPlus: 'Expert+', Expert: 'Expert', Hard: 'Hard', Normal: 'Normal', Easy: 'Easy',
};
export const CHAR_LABEL: Record<string, string> = {
  Standard: 'Standard', OneSaber: 'One Saber', NoArrows: 'No Arrows',
  '90Degree': '90°', '360Degree': '360°', Lightshow: 'Lightshow', Lawless: 'Lawless',
};

const cache: Record<string, BSMapInfo> = {};

export async function fetchBSInfo(key: string): Promise<BSMapInfo> {
  if (!cache[key]) {
    const r = await fetch(`https://beatsaver.com/api/maps/id/${key}`);
    if (!r.ok) throw new Error(`map "${key}" not found`);
    cache[key] = await r.json() as BSMapInfo;
  }
  return cache[key];
}

export function pairsFromInfoDat(infoDat: Record<string, unknown>): DiffPair[] {
  const pairs: DiffPair[] = [];
  for (const set of (infoDat._difficultyBeatmapSets as any[]) ?? []) {
    const char = set._beatmapCharacteristicName as string;
    for (const bm of (set._difficultyBeatmaps as any[]) ?? [])
      pairs.push({ characteristic: char, difficulty: bm._difficulty as string });
  }
  for (const bm of (infoDat.difficultyBeatmaps as any[]) ?? [])
    pairs.push({ characteristic: (bm.characteristic as string) ?? 'Standard', difficulty: bm.difficulty as string });
  return pairs;
}

export function useBeatSaverLookup() {
  const pairs = ref<DiffPair[]>([]);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function onKeyInput(key: string) {
    if (timer) clearTimeout(timer);
    if (!key.trim()) { pairs.value = []; return; }
    timer = setTimeout(async () => {
      try {
        const info = await fetchBSInfo(key.trim().toLowerCase());
        pairs.value = (info.versions as BSMapInfo['versions']).at(-1)!.diffs;
      } catch { /* leave as-is */ }
    }, 400);
  }

  return { pairs, onKeyInput };
}
