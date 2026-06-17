<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  accept:  string
  icon:    string
  label:   string
}>();

const emit = defineEmits<{
  file: [file: File]
}>();

const dragging  = ref(false);
const fileName  = ref('');

function handle(file: File) {
  fileName.value = file.name;
  emit('file', file);
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  const f = e.dataTransfer?.files[0];
  if (f) handle(f);
}

function onChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) handle(f);
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ drag: dragging, 'has-file': !!fileName }"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <input type="file" :accept="props.accept" @change="onChange" />
    <div class="drop-icon">{{ props.icon }}</div>
    <div class="drop-label">
      {{ props.label }}
      <strong v-if="fileName">{{ fileName }}</strong>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  border: 1px dashed var(--border);
  border-radius: 3px;
  padding: 28px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  margin-bottom: 14px;
  position: relative;
}
.dropzone:hover, .dropzone.drag { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.03); }
.dropzone.has-file              { border-style: solid; border-color: rgba(255,255,255,0.2); }
.dropzone input[type=file]      { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
.drop-icon                      { font-size: 1.4rem; margin-bottom: 8px; opacity: 0.4; }
.drop-label                     { font-size: 0.72rem; letter-spacing: 0.1em; color: var(--muted); }
.drop-label strong              { color: var(--text); display: block; margin-top: 4px; font-size: 0.8rem; letter-spacing: 0.06em; }
</style>
