<script setup lang="ts">
import { ref, computed } from 'vue';
import { unzipSync } from 'fflate';
import { useBeatSaverLookup, pairsFromInfoDat } from '../composables/useBeatSaver';
import DropZone from './DropZone.vue';
import DiffSelects from './DiffSelects.vue';
import type { DiffPair } from '../types';

type Tab = 'key' | 'zip' | 'dat'

const emit = defineEmits<{
  classifyKey: [key: string, char: string, diff: string]
  classifyZip: [buf: ArrayBuffer, char: string, diff: string, name: string]
  classifyDat: [buf: ArrayBuffer, bpm: number, name: string]
}>()

const props = defineProps<{
  ready:   boolean
  busy:    boolean
  status:  string
  isError: boolean
}>()

const tab  = ref<Tab>('key')
const tabs: { id: Tab; label: string }[] = [
  { id: 'key', label: 'Map Key' },
  { id: 'zip', label: 'Zip File' },
  { id: 'dat', label: '.dat File' },
]

// Key mode
const mapKey  = ref('')
const keyChar = ref('')
const keyDiff = ref('')
const { pairs: keyPairs, onKeyInput } = useBeatSaverLookup()

import { watch } from 'vue'
function onKeyChange(v: string) { mapKey.value = v; onKeyInput(v); }
watch(keyPairs, pairs => {
  if (pairs.length && !keyChar.value) keyChar.value = pairs[0].characteristic
})

// Zip mode
const zipBuf         = ref<ArrayBuffer | null>(null)
const zipPairs       = ref<DiffPair[]>([])
const zipChar        = ref('')
const zipDiff        = ref('')
const zipName        = ref('')

async function onZipFile(file: File) {
  zipName.value = file.name
  zipBuf.value  = await file.arrayBuffer()
  try {
    const files   = unzipSync(new Uint8Array(zipBuf.value))
    const get     = (n: string) => { const k = Object.keys(files).find(k => k.toLowerCase() === n.toLowerCase()); return k ? files[k] : null; }
    const infoRaw = get('Info.dat') ?? get('info.dat')
    if (infoRaw) zipPairs.value = pairsFromInfoDat(JSON.parse(new TextDecoder().decode(infoRaw)))
  } catch { /* ignore */ }
}

// Dat mode
const datBuf  = ref<ArrayBuffer | null>(null)
const datBpm  = ref<number | null>(null)
const datName = ref('')

async function onDatFile(file: File) {
  datName.value = file.name
  datBuf.value  = await file.arrayBuffer()
}

// Classify
async function classify() {
  if (tab.value === 'key') {
    if (!mapKey.value.trim()) return
    emit('classifyKey', mapKey.value.trim(), keyChar.value, keyDiff.value)
  } else if (tab.value === 'zip') {
    if (!zipBuf.value) return
    emit('classifyZip', zipBuf.value, zipChar.value, zipDiff.value, zipName.value)
  } else {
    if (!datBuf.value || !datBpm.value) return
    emit('classifyDat', datBuf.value, datBpm.value, datName.value)
  }
}

const canClassify = computed(() => {
  if (!props.ready || props.busy) return false
  if (tab.value === 'key') return !!mapKey.value.trim()
  if (tab.value === 'zip') return !!zipBuf.value && !!zipChar.value
  return !!datBuf.value && !!datBpm.value
})
</script>

<template>
  <div class="panel">
    <!-- Tabs -->
    <div class="tabs">
      <button
        v-for="t in tabs" :key="t.id"
        class="tab" :class="{ active: tab === t.id }"
        @click="tab = t.id"
      >{{ t.label }}</button>
    </div>

    <!-- Map Key mode -->
    <div v-if="tab === 'key'" class="mode">
      <div class="input-row">
        <input
          class="field mono-big"
          type="text"
          placeholder="map key (e.g. 2b120)"
          spellcheck="false"
          autocomplete="off"
          :value="mapKey"
          @input="onKeyChange(($event.target as HTMLInputElement).value)"
          @keydown.enter="classify"
        />
      </div>
      <DiffSelects
        :pairs="keyPairs"
        @change="(c, d) => { keyChar = c; keyDiff = d }"
      />
    </div>

    <!-- Zip File mode -->
    <div v-else-if="tab === 'zip'" class="mode">
      <DropZone accept=".zip" icon="📦" label="drop a map zip or click to browse" @file="onZipFile" />
      <DiffSelects
        :pairs="zipPairs"
        @change="(c, d) => { zipChar = c; zipDiff = d }"
      />
    </div>

    <!-- .dat File mode -->
    <div v-else class="mode">
      <DropZone accept=".dat" icon="🗂️" label="drop a difficulty .dat file or click to browse" @file="onDatFile" />
      <div class="input-row">
        <input
          class="field"
          type="number"
          placeholder="BPM (required)"
          min="1" max="999" step="0.01"
          @input="datBpm = parseFloat(($event.target as HTMLInputElement).value) || null"
          @keydown.enter="classify"
        />
      </div>
    </div>

    <button class="btn-classify" :disabled="!canClassify" @click="classify">Classify</button>
    <div class="status" :class="{ error: isError }">{{ status }}</div>
  </div>
</template>

<style scoped>
.tabs      { display: flex; gap: 2px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.tab       { background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); cursor: pointer; font-family: 'Share Tech Mono', monospace; font-size: 0.68rem; letter-spacing: 0.12em; padding: 8px 14px 10px; text-transform: uppercase; transition: color 0.15s, border-color 0.15s; margin-bottom: -1px; }
.tab:hover { color: var(--text); }
.tab.active{ color: #fff; border-bottom-color: #fff; }

.mode      { margin-bottom: 4px; }
.input-row { display: flex; gap: 10px; margin-bottom: 14px; }

.field.mono-big { font-family: 'Orbitron', sans-serif; font-size: 1rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }

.btn-classify { width: 100%; padding: 12px 24px; background: #fff; color: #000; border: none; border-radius: 3px; font-family: 'Orbitron', sans-serif; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; cursor: pointer; transition: opacity 0.15s, transform 0.1s; margin-top: 4px; }
.btn-classify:hover   { opacity: 0.88; }
.btn-classify:active  { transform: scale(0.98); }
.btn-classify:disabled{ opacity: 0.35; cursor: not-allowed; }

.status       { font-size: 0.72rem; letter-spacing: 0.08em; color: var(--muted); min-height: 18px; transition: color 0.2s; margin-top: 14px; }
.status.error { color: #f87171; }
</style>
