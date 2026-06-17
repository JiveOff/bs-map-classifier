import { classifyFromNotes } from 'bs-map-classifier';
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';

const classifier = await loadEmbeddedClassifier();

// beat: time in beats | x: lane 0–3 | y: layer 0–2
// color: 0=left 1=right | direction: 0=Up 1=Down … 8=dot
const notes = [
  { beat: 0.00, x: 1, y: 1, color: 0, direction: 1 },
  { beat: 0.25, x: 2, y: 1, color: 1, direction: 0 },
  { beat: 0.50, x: 0, y: 1, color: 0, direction: 1 },
  { beat: 0.75, x: 3, y: 1, color: 1, direction: 0 },
  { beat: 1.00, x: 1, y: 1, color: 0, direction: 1 },
  { beat: 1.25, x: 2, y: 1, color: 1, direction: 0 },
  { beat: 1.50, x: 0, y: 1, color: 0, direction: 1 },
  { beat: 1.75, x: 3, y: 1, color: 1, direction: 0 },
];

const result = await classifyFromNotes(notes, [], [], [], 180, [], classifier);

console.log(`Category:   ${result.category}`);
console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
console.log('');
for (const [cls, p] of Object.entries(result.probabilities).sort((a, b) => b[1] - a[1])) {
  const bar = '█'.repeat(Math.round(p * 20)).padEnd(20, '░');
  console.log(`  ${cls.padEnd(10)} ${bar} ${(p * 100).toFixed(1)}%`);
}
