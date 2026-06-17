import { ref, onMounted } from 'vue';
import { unzipSync } from 'fflate';
import { parseBeatmap, extractPatternsAndClassifyMap } from 'bs-map-classifier';
import { findDatInfo } from 'bs-map-classifier/parser';
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';

export function useClassifier() {
  const ready  = ref(false);
  const busy   = ref(false);
  const status = ref('Loading model…');
  const result = ref(null);

  let clf = null;

  onMounted(async () => {
    try {
      clf = await loadEmbeddedClassifier();
      ready.value  = true;
      status.value = 'Model ready.';
    } catch (e) {
      status.value = `Failed to load model: ${e.message}`;
    }
  });

  async function classify(mapKey, difficulty) {
    if (!clf || busy.value) return;
    busy.value   = true;
    result.value = null;

    try {
      status.value = `Fetching map ${mapKey}…`;

      const info    = await fetch(`https://beatsaver.com/api/maps/id/${mapKey}`)
        .then(r => { if (!r.ok) throw new Error(`BeatSaver ${r.status}`); return r.json(); });
      const version = info.versions.at(-1);

      status.value = `Downloading "${info.metadata.songName}"…`;

      const zipBuf = await fetch(`https://cdn.beatsaver.com/${version.hash}.zip`)
        .then(r => { if (!r.ok) throw new Error(`CDN ${r.status}`); return r.arrayBuffer(); });
      const zip    = unzipSync(new Uint8Array(zipBuf));

      const getEntry = name => {
        const key = Object.keys(zip).find(k => k.toLowerCase() === name.toLowerCase());
        return key ? zip[key] : null;
      };

      const infoDat = JSON.parse(new TextDecoder().decode(getEntry('Info.dat') ?? getEntry('info.dat')));
      const { filename, njs, njsOffset } = findDatInfo(infoDat, 'Standard', difficulty);
      const datFile = JSON.parse(new TextDecoder().decode(getEntry(filename)));

      status.value = 'Classifying…';

      const { classification, features, patterns } = await extractPatternsAndClassifyMap(
        { ...parseBeatmap(datFile), njs, njsOffset }, info.metadata.bpm, clf,
      );

      result.value = {
        song: `"${info.metadata.songName}" by ${info.metadata.songAuthorName}`,
        difficulty,
        classification,
        features,
        patternCount: patterns.length,
      };
      status.value = 'Done.';
    } catch (e) {
      status.value = `Error: ${e.message}`;
      console.error(e);
    } finally {
      busy.value = false;
    }
  }

  return { ready, busy, status, result, classify };
}
