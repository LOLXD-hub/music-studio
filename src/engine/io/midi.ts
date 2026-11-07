// Standard MIDI File reader and writer.

import { PPQ } from '../project.ts';
import type { Project, MidiClip } from '../project.ts';

export interface MidiNote {
  t: number;
  d: number;
  p: number;
  v: number;
}

export interface MidiTrackData {
  name: string;
  channel: number;
  program: number;
  notes: MidiNote[];
  cc: { cc: number; t: number; v: number }[];
  bend: { t: number; v: number }[];
}

export interface MidiFileData {
  ppq: number;
  tempo: { t: number; bpm: number }[];
  sig: { t: number; num: number; den: number }[];
  keySig?: { sharps: number; minor: boolean };
  tracks: MidiTrackData[];
  /** All ticks are converted to project ticks (960 per quarter). */
  scaled: true;
}

function vlq(dv: DataView, pos: { p: number }): number {
  let v = 0;
  for (let i = 0; i < 4; i++) {
    const b = dv.getUint8(pos.p++);
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return v;
}

export function parseMidi(bytes: Uint8Array): MidiFileData {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'MThd') throw new Error('Not a MIDI file');
  const nTracks = dv.getUint16(10);
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  const scale = PPQ / division;
  const out: MidiFileData = { ppq: PPQ, tempo: [], sig: [], tracks: [], scaled: true };
  let pos = 14;
  for (let tr = 0; tr < nTracks && pos < bytes.length; tr++) {
    if (tag(pos) !== 'MTrk') break;
    const len = dv.getUint32(pos + 4);
    const end = pos + 8 + len;
    const cursor = { p: pos + 8 };
    let t = 0;
    let running = 0;
    const open = new Map<string, { t: number; v: number }>();
    const byCh = new Map<number, MidiTrackData>();
    let name = '';
    const get = (ch: number): MidiTrackData => {
      let m = byCh.get(ch);
      if (!m) {
        m = { name: name || `Track ${out.tracks.length + 1}`, channel: ch, program: 0, notes: [], cc: [], bend: [] };
        byCh.set(ch, m);
      }
      return m;
    };
    while (cursor.p < end) {
      t += vlq(dv, cursor);
      let status = dv.getUint8(cursor.p);
      if (status < 0x80) status = running;
      else {
        cursor.p++;
        if (status < 0xf0) running = status;
      }
      const tt = t * scale;
      if (status === 0xff) {
        const type = dv.getUint8(cursor.p++);
        const l = vlq(dv, cursor);
        const d0 = cursor.p;
        if (type === 0x51 && l === 3) out.tempo.push({ t: tt, bpm: 60000000 / ((dv.getUint8(d0) << 16) | (dv.getUint8(d0 + 1) << 8) | dv.getUint8(d0 + 2)) });
        else if (type === 0x58 && l >= 2) out.sig.push({ t: tt, num: dv.getUint8(d0), den: 1 << dv.getUint8(d0 + 1) });
        else if (type === 0x59 && l === 2) out.keySig = { sharps: dv.getInt8(d0), minor: dv.getUint8(d0 + 1) === 1 };
        else if (type === 0x03 || type === 0x04) {
          name = new TextDecoder().decode(bytes.subarray(d0, d0 + l));
          for (const m of byCh.values()) if (m.name.startsWith('Track ')) m.name = name;
        }
        cursor.p = d0 + l;
        if (type === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        const l = vlq(dv, cursor);
        cursor.p += l;
      } else {
        const hi = status & 0xf0;
        const ch = status & 15;
        if (hi === 0x90 || hi === 0x80) {
          const p = dv.getUint8(cursor.p++);
          const v = dv.getUint8(cursor.p++);
          const k = `${ch}:${p}`;
          if (hi === 0x90 && v > 0) {
            open.set(k, { t: tt, v });
          } else {
            const o = open.get(k);
            if (o) {
              get(ch).notes.push({ t: o.t, d: Math.max(1, tt - o.t), p, v: o.v });
              open.delete(k);
            }
          }
        } else if (hi === 0xb0) {
          const c = dv.getUint8(cursor.p++);
          const v = dv.getUint8(cursor.p++);
          get(ch).cc.push({ cc: c, t: tt, v });
        } else if (hi === 0xc0) get(ch).program = dv.getUint8(cursor.p++);
        else if (hi === 0xe0) {
          const lo = dv.getUint8(cursor.p++);
          const hi2 = dv.getUint8(cursor.p++);
          get(ch).bend.push({ t: tt, v: (((hi2 << 7) | lo) - 8192) / 8192 });
        } else if (hi === 0xa0 || hi === 0xd0) cursor.p += hi === 0xa0 ? 2 : 1;
        else cursor.p += 2;
      }
    }
    for (const m of byCh.values()) if (m.notes.length || m.cc.length) {
      m.notes.sort((a, b) => a.t - b.t);
      out.tracks.push(m);
    }
    pos = end;
  }
  return out;
}

// ------------------------------------------------------------------ writer

function pushVlq(a: number[], v: number): void {
  const bytes = [v & 0x7f];
  while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
  a.push(...bytes);
}

const GM_PROGRAM: Record<string, number> = {
  'piano': 0, 'organ': 16, 'fm/FM electric piano': 4, 'fm': 4, 'mallet/Marimba': 12, 'mallet/Vibraphone': 11, 'mallet/Glockenspiel': 9, 'mallet/Celesta': 8,
  'mallet/Tubular bells': 14, 'mallet': 12, 'plucked/Nylon guitar': 24, 'plucked/Acoustic guitar (steel)': 25, 'plucked/Electric guitar (clean)': 27,
  'plucked/Electric guitar (crunch)': 29, 'plucked/Finger bass': 33, 'plucked/Picked bass': 34, 'plucked/Harp': 46, 'plucked': 25,
  'wind_string/Violin (solo)': 40, 'wind_string/Viola (solo)': 41, 'wind_string/Cello (solo)': 42, 'wind_string/Double bass (solo)': 43,
  'wind_string/Violins (section)': 48, 'wind_string/String ensemble': 48, 'wind_string/Trumpet': 56, 'wind_string/French horn': 60, 'wind_string/Trombone': 57,
  'wind_string/Tuba': 58, 'wind_string/Brass section': 61, 'wind_string/Flute': 73, 'wind_string/Clarinet': 71, 'wind_string/Oboe': 68, 'wind_string/Alto sax': 65,
  'wind_string/Bassoon': 70, 'wind_string/Choir (ahh)': 52, 'wind_string/Soprano (solo)': 54, 'wind_string/Warm analog pad': 89, 'wind_string': 48,
  'subsynth/Supersaw lead': 80, 'subsynth': 81, 'subsynth/Sub bass': 38,
};

/** Standard MIDI file (format 1) from a project. Drum tracks use channel 10. */
export function writeMidi(p: Project): Uint8Array {
  const tracks: number[][] = [];
  const meta: number[] = [];
  const evts: { t: number; bytes: number[] }[] = [];
  evts.push({ t: 0, bytes: [0xff, 0x03, p.name.length, ...new TextEncoder().encode(p.name)] });
  for (const tp of p.tempo) {
    const us = Math.round(60000000 / tp.bpm);
    evts.push({ t: tp.t, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
  }
  for (const s of p.sig) evts.push({ t: s.t, bytes: [0xff, 0x58, 4, s.num, Math.log2(s.den), 24, 8] });
  const pushTrack = (list: { t: number; bytes: number[] }[]): number[] => {
    list.sort((a, b) => a.t - b.t || (a.bytes[0] === 0xff ? -1 : 0) - (b.bytes[0] === 0xff ? -1 : 0));
    const out: number[] = [];
    let last = 0;
    for (const e of list) {
      pushVlq(out, Math.max(0, Math.round(e.t - last)));
      out.push(...e.bytes);
      last = Math.round(e.t);
    }
    pushVlq(out, 0);
    out.push(0xff, 0x2f, 0);
    return out;
  };
  tracks.push(pushTrack(evts));
  void meta;
  let ch = 0;
  for (const tr of p.tracks) {
    if (tr.kind !== 'instrument') continue;
    const isDrum = tr.instrument?.type === 'drums';
    let channel = isDrum ? 9 : ch;
    if (!isDrum) {
      if (ch === 9) ch++;
      channel = ch;
      ch = Math.min(15, ch + 1);
    }
    const e: { t: number; bytes: number[] }[] = [];
    const nm = new TextEncoder().encode(tr.name);
    e.push({ t: 0, bytes: [0xff, 0x03, nm.length, ...nm] });
    const key = tr.instrument ? `${tr.instrument.type}/${tr.instrument.preset ?? ''}` : '';
    const prog = isDrum ? 0 : GM_PROGRAM[key] ?? GM_PROGRAM[tr.instrument?.type ?? ''] ?? 0;
    e.push({ t: 0, bytes: [0xc0 | channel, prog] });
    for (const c of tr.clips) {
      if (c.kind !== 'midi') continue;
      const clip = c as MidiClip;
      for (const n of clip.notes) {
        const on = Math.round(clip.start + n.t);
        e.push({ t: on, bytes: [0x90 | channel, n.p, Math.max(1, Math.min(127, Math.round(n.v)))] });
        e.push({ t: Math.max(on + 1, Math.round(clip.start + n.t + n.d)), bytes: [0x80 | channel, n.p, 0] });
      }
      for (const lane of clip.cc) {
        for (const pt of lane.pts) {
          const t = Math.round(clip.start + pt.t);
          if (lane.cc === 128) {
            const v = Math.round(8192 + pt.v * 8191);
            e.push({ t, bytes: [0xe0 | channel, v & 127, (v >> 7) & 127] });
          } else e.push({ t, bytes: [0xb0 | channel, lane.cc, Math.max(0, Math.min(127, Math.round(pt.v)))] });
        }
      }
    }
    tracks.push(pushTrack(e));
  }
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
  const out: number[] = [...head];
  for (const t of tracks) {
    out.push(0x4d, 0x54, 0x72, 0x6b, (t.length >>> 24) & 255, (t.length >>> 16) & 255, (t.length >>> 8) & 255, t.length & 255, ...t);
  }
  return new Uint8Array(out);
}
