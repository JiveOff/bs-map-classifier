'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBeatmap, findDatFilename } from '../src/parser.js';

// ── parseBeatmap — v2 ─────────────────────────────────────────────────────────

test('parseBeatmap v2: parses color notes', () => {
  const data = {
    _version: '2.0.0',
    _notes: [
      { _time: 1.0, _lineIndex: 0, _lineLayer: 1, _type: 0, _cutDirection: 1 },
      { _time: 2.0, _lineIndex: 3, _lineLayer: 2, _type: 1, _cutDirection: 0 },
    ],
    _obstacles: [],
    _sliders: [],
  };
  const { notes, bombs, obstacles, arcs } = parseBeatmap(data);
  assert.equal(notes.length, 2);
  assert.equal(bombs.length, 0);
  assert.equal(obstacles.length, 0);
  assert.equal(arcs.length, 0);

  assert.equal(notes[0].beat, 1.0);
  assert.equal(notes[0].x, 0);
  assert.equal(notes[0].y, 1);
  assert.equal(notes[0].color, 0);
  assert.equal(notes[0].direction, 1);

  assert.equal(notes[1].color, 1);
  assert.equal(notes[1].direction, 0);
});

test('parseBeatmap v2: parses bombs separately', () => {
  const data = {
    _version: '2.0.0',
    _notes: [
      { _time: 0.5, _lineIndex: 1, _lineLayer: 0, _type: 3, _cutDirection: 0 },
      { _time: 1.0, _lineIndex: 2, _lineLayer: 1, _type: 1, _cutDirection: 1 },
    ],
    _obstacles: [],
    _sliders: [],
  };
  const { notes, bombs } = parseBeatmap(data);
  assert.equal(notes.length, 1);
  assert.equal(bombs.length, 1);
  assert.equal(bombs[0].color, -1);
  assert.equal(bombs[0].direction, 8);
  assert.equal(bombs[0].beat, 0.5);
});

test('parseBeatmap v2: parses full-height obstacles (type 0)', () => {
  const data = {
    _version: '2.0.0',
    _notes: [],
    _obstacles: [
      { _time: 2.0, _lineIndex: 1, _type: 0, _width: 2, _duration: 1.5 },
    ],
    _sliders: [],
  };
  const { obstacles } = parseBeatmap(data);
  assert.equal(obstacles.length, 1);
  assert.equal(obstacles[0].y, 0);
  assert.equal(obstacles[0].w, 2);
  assert.equal(obstacles[0].duration, 1.5);
});

test('parseBeatmap v2: parses crouch obstacles (type 1)', () => {
  const data = {
    _version: '2.0.0',
    _notes: [],
    _obstacles: [
      { _time: 1.0, _lineIndex: 0, _type: 1, _width: 4, _duration: 2.0 },
    ],
    _sliders: [],
  };
  const { obstacles } = parseBeatmap(data);
  assert.equal(obstacles[0].y, 2);
});

test('parseBeatmap v2: sorts notes by beat', () => {
  const data = {
    _version: '2.0.0',
    _notes: [
      { _time: 3.0, _lineIndex: 0, _lineLayer: 0, _type: 0, _cutDirection: 0 },
      { _time: 1.0, _lineIndex: 1, _lineLayer: 0, _type: 1, _cutDirection: 0 },
      { _time: 2.0, _lineIndex: 2, _lineLayer: 0, _type: 0, _cutDirection: 0 },
    ],
    _obstacles: [],
    _sliders: [],
  };
  const { notes } = parseBeatmap(data);
  assert.deepEqual(notes.map(n => n.beat), [1.0, 2.0, 3.0]);
});

// ── parseBeatmap — v3 ─────────────────────────────────────────────────────────

test('parseBeatmap v3: parses colorNotes', () => {
  const data = {
    version: '3.0.0',
    colorNotes: [
      { b: 0.5, x: 1, y: 0, c: 0, d: 5 },
      { b: 1.0, x: 2, y: 1, c: 1, d: 4 },
    ],
    bombNotes: [],
    obstacles: [],
    sliders: [],
    burstSliders: [],
  };
  const { notes, bombs, obstacles } = parseBeatmap(data);
  assert.equal(notes.length, 2);
  assert.equal(bombs.length, 0);
  assert.equal(notes[0].beat, 0.5);
  assert.equal(notes[0].color, 0);
  assert.equal(notes[0].direction, 5);
  assert.equal(notes[1].color, 1);
});

test('parseBeatmap v3: parses bombNotes', () => {
  const data = {
    version: '3.0.0',
    colorNotes: [],
    bombNotes: [
      { b: 1.0, x: 0, y: 0 },
    ],
    obstacles: [],
    sliders: [],
    burstSliders: [],
  };
  const { bombs } = parseBeatmap(data);
  assert.equal(bombs.length, 1);
  assert.equal(bombs[0].color, -1);
  assert.equal(bombs[0].direction, 8);
});

test('parseBeatmap v3: parses obstacles', () => {
  const data = {
    version: '3.0.0',
    colorNotes: [],
    bombNotes: [],
    obstacles: [
      { b: 2.0, x: 0, y: 0, w: 2, h: 5, d: 1.0 },
    ],
    sliders: [],
    burstSliders: [],
  };
  const { obstacles } = parseBeatmap(data);
  assert.equal(obstacles.length, 1);
  assert.equal(obstacles[0].beat, 2.0);
  assert.equal(obstacles[0].w, 2);
  assert.equal(obstacles[0].duration, 1.0);
});

test('parseBeatmap v3: parses chains (burstSliders)', () => {
  const data = {
    version: '3.0.0',
    colorNotes: [],
    bombNotes: [],
    obstacles: [],
    sliders: [],
    burstSliders: [{ b: 1.0, x: 0, y: 0, c: 0 }],
  };
  const { chains } = parseBeatmap(data);
  assert.equal(chains.length, 1);
});

// ── parseBeatmap — v4 template ────────────────────────────────────────────────

test('parseBeatmap v4: colorNotes pointer objects are parsed by v3 branch with defaults', () => {
  // The v4 "template" branch (`colorNotesData`) is only reached when the v3 branch
  // produces zero notes. Since v3 always processes `colorNotes` (setting x/y/c/d to
  // defaults via `?? 0`), v4-format pointer objects {b, i} become notes with default
  // values. The v4 template branch is thus never activated when colorNotes is non-empty.
  const data = {
    version: '4.0.0',
    colorNotes: [{ b: 1.0, i: 0 }, { b: 2.0, i: 1 }],
    colorNotesData: [
      { x: 1, y: 0, c: 0, d: 1 },
      { x: 2, y: 1, c: 1, d: 0 },
    ],
    bombNotes: [],
    obstacles: [],
    sliders: [],
    burstSliders: [],
  };
  const { notes } = parseBeatmap(data);
  // v3 branch fires: 2 notes created with beat from b, but x/y/c/d default to 0/0/0/8
  assert.equal(notes.length, 2);
  assert.equal(notes[0].beat, 1.0);
  assert.equal(notes[1].beat, 2.0);
  // defaults from v3 parsing of pointer objects
  assert.equal(notes[0].x, 0);
  assert.equal(notes[0].color, 0);
  assert.equal(notes[0].direction, 8);
});

// ── parseBeatmap — edge cases ─────────────────────────────────────────────────

test('parseBeatmap: empty beatmap returns empty arrays', () => {
  const { notes, obstacles, arcs, chains, bombs } = parseBeatmap({});
  assert.equal(notes.length, 0);
  assert.equal(obstacles.length, 0);
  assert.equal(arcs.length, 0);
  assert.equal(chains.length, 0);
  assert.equal(bombs.length, 0);
});

test('parseBeatmap: missing fields default to zero', () => {
  const data = {
    _notes: [{ _time: undefined, _lineIndex: undefined, _lineLayer: undefined, _type: 0, _cutDirection: undefined }],
    _obstacles: [],
    _sliders: [],
  };
  const { notes } = parseBeatmap(data);
  assert.equal(notes[0].beat, 0);
  assert.equal(notes[0].x, 0);
  assert.equal(notes[0].y, 0);
  assert.equal(notes[0].direction, 8);
});

// ── findDatFilename ───────────────────────────────────────────────────────────

test('findDatFilename v2: finds correct filename', () => {
  const infoDat = {
    _difficultyBeatmapSets: [
      {
        _beatmapCharacteristicName: 'Standard',
        _difficultyBeatmaps: [
          { _difficulty: 'Expert',     _beatmapFilename: 'Expert.dat' },
          { _difficulty: 'ExpertPlus', _beatmapFilename: 'ExpertPlus.dat' },
        ],
      },
    ],
  };
  assert.equal(findDatFilename(infoDat, 'Standard', 'ExpertPlus'), 'ExpertPlus.dat');
  assert.equal(findDatFilename(infoDat, 'Standard', 'Expert'), 'Expert.dat');
});

test('findDatFilename v2: case-insensitive matching', () => {
  const infoDat = {
    _difficultyBeatmapSets: [
      {
        _beatmapCharacteristicName: 'STANDARD',
        _difficultyBeatmaps: [
          { _difficulty: 'EXPERTPLUS', _beatmapFilename: 'EP.dat' },
        ],
      },
    ],
  };
  assert.equal(findDatFilename(infoDat, 'standard', 'expertplus'), 'EP.dat');
});

test('findDatFilename v4: finds correct filename', () => {
  const infoDat = {
    difficultyBeatmaps: [
      { characteristic: 'Standard', difficulty: 'ExpertPlus', beatmapDataFilename: 'EP_data.dat' },
      { characteristic: 'Standard', difficulty: 'Hard',       beatmapDataFilename: 'Hard_data.dat' },
    ],
  };
  assert.equal(findDatFilename(infoDat, 'Standard', 'ExpertPlus'), 'EP_data.dat');
});

test('findDatFilename: falls back to pattern when not found', () => {
  const infoDat = {};
  assert.equal(findDatFilename(infoDat, 'Standard', 'ExpertPlus'), 'ExpertPlusStandard.dat');
});
