import * as ort from 'onnxruntime-web';
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

ort.env.wasm.numThreads = 1;

createApp(App).mount('#app');
