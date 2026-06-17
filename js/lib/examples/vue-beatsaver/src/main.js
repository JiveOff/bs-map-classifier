import * as ort from 'onnxruntime-web';
import { createApp } from 'vue';
import App from './App.vue';

ort.env.wasm.numThreads = 1;

createApp(App).mount('#app');
