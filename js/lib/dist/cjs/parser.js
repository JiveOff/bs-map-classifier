"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var parser_exports = {};
__export(parser_exports, {
  findDatFilename: () => findDatFilename,
  parseBeatmap: () => parseBeatmap
});
module.exports = __toCommonJS(parser_exports);
function parseBeatmap(data) {
  const notes = [], obstacles = [], bombs = [], arcs = [], chains = [];
  const isV2 = "_notes" in data || (data._version || "").startsWith("2");
  if (isV2) {
    for (const n of data._notes || []) {
      const ntype = parseInt(n._type ?? 0);
      if (ntype === 3) {
        bombs.push({
          beat: parseFloat(n._time ?? 0),
          x: parseInt(n._lineIndex ?? 0),
          y: parseInt(n._lineLayer ?? 0),
          color: -1,
          direction: 8
        });
        continue;
      }
      notes.push({
        beat: parseFloat(n._time ?? 0),
        x: parseInt(n._lineIndex ?? 0),
        y: parseInt(n._lineLayer ?? 0),
        color: ntype,
        direction: parseInt(n._cutDirection ?? 8)
      });
    }
    for (const o of data._obstacles || []) {
      const t = parseInt(o._type ?? 0);
      obstacles.push({
        beat: parseFloat(o._time ?? 0),
        x: parseInt(o._lineIndex ?? 0),
        y: t === 0 ? 0 : 2,
        w: parseInt(o._width ?? 1),
        h: t === 0 ? 5 : 3,
        duration: parseFloat(o._duration ?? 0)
      });
    }
    for (const a of data._sliders || []) arcs.push(a);
  } else {
    for (const n of data.colorNotes || []) {
      notes.push({
        beat: parseFloat(n.b ?? 0),
        x: parseInt(n.x ?? 0),
        y: parseInt(n.y ?? 0),
        color: parseInt(n.c ?? 0),
        direction: parseInt(n.d ?? 8)
      });
    }
    if (!notes.length && data.colorNotesData) {
      for (const ev of data.colorNotes || []) {
        const nd = (data.colorNotesData || [])[parseInt(ev.i ?? 0)];
        if (!nd) continue;
        notes.push({
          beat: parseFloat(ev.b ?? 0),
          x: parseInt(nd.x ?? 0),
          y: parseInt(nd.y ?? 0),
          color: parseInt(nd.c ?? 0),
          direction: parseInt(nd.d ?? 8)
        });
      }
    }
    for (const n of data.bombNotes || []) {
      bombs.push({
        beat: parseFloat(n.b ?? 0),
        x: parseInt(n.x ?? 0),
        y: parseInt(n.y ?? 0),
        color: -1,
        direction: 8
      });
    }
    for (const o of data.obstacles || []) {
      obstacles.push({
        beat: parseFloat(o.b ?? 0),
        x: parseInt(o.x ?? 0),
        y: parseInt(o.y ?? 0),
        w: parseInt(o.w ?? 1),
        h: parseInt(o.h ?? 5),
        duration: parseFloat(o.d ?? 0)
      });
    }
    if (!obstacles.length && data.obstaclesData) {
      for (const ev of data.obstacles || []) {
        const od = (data.obstaclesData || [])[parseInt(ev.i ?? 0)];
        if (!od) continue;
        obstacles.push({
          beat: parseFloat(ev.b ?? 0),
          x: parseInt(od.x ?? 0),
          y: parseInt(od.y ?? 0),
          w: parseInt(od.w ?? 1),
          h: parseInt(od.h ?? 5),
          duration: parseFloat(od.d ?? 0)
        });
      }
    }
    for (const a of data.sliders || []) arcs.push(a);
    for (const c of data.burstSliders || data.chains || []) chains.push(c);
  }
  notes.sort((a, b) => a.beat - b.beat);
  return { notes, obstacles, arcs, chains, bombs };
}
function findDatFilename(infoDat, characteristic, difficulty) {
  const cLow = characteristic.toLowerCase();
  const dLow = difficulty.toLowerCase();
  for (const s of infoDat._difficultyBeatmapSets || []) {
    if ((s._beatmapCharacteristicName || "").toLowerCase() !== cLow) continue;
    for (const d of s._difficultyBeatmaps || []) {
      if ((d._difficulty || "").toLowerCase() === dLow) return d._beatmapFilename;
    }
  }
  for (const d of infoDat.difficultyBeatmaps || []) {
    if ((d.characteristic || "").toLowerCase() === cLow && (d.difficulty || "").toLowerCase() === dLow) return d.beatmapDataFilename;
  }
  return `${difficulty}${characteristic}.dat`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  findDatFilename,
  parseBeatmap
});
