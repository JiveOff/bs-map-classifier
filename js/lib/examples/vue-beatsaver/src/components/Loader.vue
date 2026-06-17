<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<template>
  <div class="loader">
    <div class="spinner" />
    <div class="loader-text">{{ text }}</div>
  </div>
</template>

<style scoped>
.loader      { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 32px 0; }
.spinner     { width: 48px; height: 48px; border: 2px solid var(--border); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
.loader-text { font-size: 0.7rem; letter-spacing: 0.15em; color: var(--muted); animation: pulse 1.4s ease-in-out infinite; }
</style>
