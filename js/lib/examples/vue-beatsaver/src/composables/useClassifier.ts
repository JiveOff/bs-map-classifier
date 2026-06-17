import { ref, onMounted } from 'vue';
import { unzipSync } from 'fflate';
import { parseBeatmap, extractPatternsAndClassifyMap } from 'bs-map-classifier';
import type { Classifier, MapAnalysisResult } from 'bs-map-classifier';
import { findDatInfo } from 'bs-map-classifier/parser';
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';
import { fetchBSInfo, pairsFromInfoDat, RANK } from './useBeatSaver';
import type { DiffPair } from '../types';

const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);

function getZipEntry(files: Record<string, Uint8Array>, name: string): Uint8Array | null {
  const key = Object.keys(files).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? files[key] : null;
}

function extractFromZip(buf: ArrayBuffer, char: string, diff: string) {
  const files   = unzipSync(new Uint8Array(buf));
  const infoRaw = getZipEntry(files, 'Info.dat') ?? getZipEntry(files, 'info.dat');
  if (!infoRaw) throw new Error('Info.dat not found in zip');

  const infoDat                    = JSON.parse(decode(infoRaw)) as Record<string, unknown>;
  const bpm                        = infoDat._beatsPerMinute as number | null;
  const { filename, njs, njsOffset } = findDatInfo(infoDat, char, diff);
  const datRaw                     = getZipEntry(files, filename);
  if (!datRaw) throw new Error(`"${filename}" not found in zip — check characteristic/difficulty`);

  return { datJson: JSON.parse(decode(datRaw)) as object, infoDat, bpm, njs, njsOffset };
}

export interface ClassifyPayload {
  meta:   string
  result: MapAnalysisResult
}

export function useClassifier() {
  const clf         = ref<Classifier | null>(null);
  const ready       = ref(false);
  const busy        = ref(false);
  const loading     = ref(false);
  const loadingText = ref('INITIALISING MODEL');
  const status      = ref('');
  const isError     = ref(false);
  const payload     = ref<ClassifyPayload | null>(null);

  onMounted(async () => {
    try {
      clf.value   = await loadEmbeddedClassifier();
      ready.value = true;
    } catch (e: unknown) {
      status.value  = `Failed to load model: ${(e as Error).message}`;
      isError.value = true;
    }
  });

  async function run(task: () => Promise<ClassifyPayload>) {
    if (!clf.value || busy.value) return;
    busy.value    = true;
    loading.value = true;
    payload.value = null;
    status.value  = '';
    isError.value = false;

    try {
      payload.value = await task();
    } catch (e: unknown) {
      status.value  = (e as Error).message;
      isError.value = true;
    } finally {
      busy.value    = false;
      loading.value = false;
    }
  }

  async function classifyFromKey(key: string, pairs: DiffPair[], char: string, diff: string) {
    await run(async () => {
      loadingText.value = 'FETCHING MAP';
      const info    = await fetchBSInfo(key.toLowerCase());
      const version = info.versions.at(-1)!;

      const chosen = version.diffs.find((d: DiffPair) => d.characteristic === char && d.difficulty === diff)
                  ?? [...version.diffs].sort((a: DiffPair, b: DiffPair) => (RANK[b.difficulty] ?? 0) - (RANK[a.difficulty] ?? 0))[0];

      loadingText.value = 'DOWNLOADING ZIP';
      const buf = await fetch(`https://cdn.beatsaver.com/${version.hash}.zip`)
        .then(r => { if (!r.ok) throw new Error(`CDN ${r.status}`); return r.arrayBuffer(); });

      loadingText.value = 'CLASSIFYING';
      const { datJson, njs, njsOffset } = extractFromZip(buf, chosen.characteristic, chosen.difficulty);
      const result = await extractPatternsAndClassifyMap(
        parseBeatmap(datJson), info.metadata.bpm, clf.value!, {}, njs, njsOffset,
      );

      const meta = `<strong>${info.metadata.songName}</strong> — ${info.metadata.songAuthorName}<br>` +
        `mapped by ${info.metadata.levelAuthorName} · ${chosen.characteristic} / ${chosen.difficulty} · ${info.metadata.bpm} BPM`;
      return { meta, result };
    });
  }

  async function classifyFromZip(buf: ArrayBuffer, char: string, diff: string, fileName: string) {
    await run(async () => {
      loadingText.value = 'CLASSIFYING';
      const { datJson, infoDat, bpm, njs, njsOffset } = extractFromZip(buf, char, diff);
      const result = await extractPatternsAndClassifyMap(
        parseBeatmap(datJson), bpm ?? 120, clf.value!, {}, njs, njsOffset,
      );
      const songName = (infoDat._songName as string | undefined) ?? fileName.replace('.zip', '');
      const meta     = `<strong>${songName}</strong> · ${char} / ${diff}${bpm ? ` · ${bpm} BPM` : ''}`;
      return { meta, result };
    });
  }

  async function classifyFromDat(datBuf: ArrayBuffer, bpm: number, fileName: string) {
    await run(async () => {
      loadingText.value = 'CLASSIFYING';
      const datJson = JSON.parse(decode(new Uint8Array(datBuf))) as object;
      const result  = await extractPatternsAndClassifyMap(parseBeatmap(datJson), bpm, clf.value!);
      return { meta: `<strong>${fileName}</strong> · ${bpm} BPM`, result };
    });
  }

  return {
    ready, busy, loading, loadingText, status, isError, payload,
    classifyFromKey, classifyFromZip, classifyFromDat,
  };
}
