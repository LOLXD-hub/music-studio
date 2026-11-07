// Song forms and energy plans. An arrangement is mostly decided by what plays when: this gives the shape.

export interface Section {
  name: string;
  bars: number;
  /** 0..1 overall intensity of the section. */
  energy: number;
  /** Role names that play in this section. */
  layers: string[];
  note: string;
  startBar?: number;
}

type Raw = [name: string, bars: number, energy: number, note: string];

interface FormDef {
  description: string;
  sections: Raw[];
}

export const FORMS: Record<string, FormDef> = {
  'pop-song': {
    description: 'Intro, verse, pre-chorus, chorus, second verse, chorus, bridge, final chorus, outro. Energy steps up into every chorus.',
    sections: [
      ['Intro', 4, 0.25, 'Establish the key and the hook in a thin texture.'],
      ['Verse 1', 8, 0.45, 'Story, lower register, sparse drums.'],
      ['Pre-chorus', 4, 0.65, 'Rising harmony or bass line, add drum fills, build tension.'],
      ['Chorus 1', 8, 0.9, 'Full band, hook melody, widest stereo.'],
      ['Verse 2', 8, 0.55, 'Same chords as verse 1 with a new counter-line or fuller groove.'],
      ['Pre-chorus 2', 4, 0.7, 'Same build, one more layer.'],
      ['Chorus 2', 8, 0.95, 'Chorus again with an added harmony or higher octave.'],
      ['Bridge', 8, 0.5, 'New harmony, pull back, then rebuild.'],
      ['Final chorus', 8, 1.0, 'Biggest moment: everything plays, modulate up a tone if you like.'],
      ['Outro', 4, 0.25, 'Strip back to the hook, end on the tonic.'],
    ],
  },
  'cinematic-build': {
    description: 'Slow-burn film cue: quiet opening that grows over six sections to a single climax, then resolves.',
    sections: [
      ['Opening', 8, 0.15, 'Pad and a single solo instrument. Silence is part of the music.'],
      ['Theme', 8, 0.3, 'First statement of the main theme.'],
      ['Development', 8, 0.5, 'Add low strings, rhythmic pulse, theme moves to a new register.'],
      ['Rise', 8, 0.75, 'Percussion enters, brass and high strings double the theme.'],
      ['Climax', 8, 1.0, 'Full orchestra, theme in the highest register, big drums.'],
      ['Resolution', 8, 0.3, 'Everything falls away except piano or solo strings, ending on the tonic.'],
    ],
  },
  'lofi-loop': {
    description: 'Loop-based chill beat: A and B sections with a short breakdown. Subtle changes keep a 4-chord loop alive.',
    sections: [
      ['Intro', 4, 0.2, 'Keys and vinyl texture only.'],
      ['A', 8, 0.5, 'Drums enter, bass plays root notes.'],
      ['B', 8, 0.6, 'Add a lead or a melodic counter-line; change the bass pattern.'],
      ['Breakdown', 4, 0.25, 'Drop drums and bass, filter the keys.'],
      ['A return', 8, 0.55, 'Back to A with a small variation.'],
      ['Outro', 4, 0.2, 'Fade the rhythm section, keys ring out.'],
    ],
  },
  'edm-drop': {
    description: 'Intro, build, drop, breakdown, build, second drop, outro. The contrast between breakdown and drop is the whole point.',
    sections: [
      ['Intro', 16, 0.3, 'Kick and hats for DJ mixing, a filtered pad.'],
      ['Build 1', 8, 0.65, 'Riser, snare roll, filter opening, drop the bass.'],
      ['Drop 1', 16, 1.0, 'Bass and lead enter together, full drums.'],
      ['Breakdown', 8, 0.3, 'Chords and melody only, no kick.'],
      ['Build 2', 8, 0.7, 'Reintroduce the kick, higher riser.'],
      ['Drop 2', 16, 1.0, 'Variation of drop 1 with an extra layer.'],
      ['Outro', 8, 0.3, 'Drums only again for mixing out.'],
    ],
  },
  'aaba-jazz': {
    description: '32-bar AABA standard form: two statements, a contrasting bridge, and a final statement.',
    sections: [
      ['A1', 8, 0.5, 'Head melody.'],
      ['A2', 8, 0.55, 'Repeat with small variation.'],
      ['B (bridge)', 8, 0.6, 'Modulates to a new key area, melody moves higher.'],
      ['A3', 8, 0.5, 'Final head, end with a tag.'],
    ],
  },
  'ambient-arc': {
    description: 'Slowly evolving texture with one swell. No beat required.',
    sections: [
      ['Emergence', 8, 0.15, 'A single sustained tone grows out of silence.'],
      ['Bloom', 16, 0.45, 'Layers enter every four bars, harmony slowly shifts.'],
      ['Peak', 8, 0.7, 'Widest and densest point; melodic fragment appears.'],
      ['Fade', 16, 0.2, 'Layers leave in reverse order.'],
    ],
  },
  ternary: {
    description: 'A-B-A with a varied return. Classical and chamber structure.',
    sections: [
      ['A', 8, 0.45, 'Main theme in the home key.'],
      ['B', 8, 0.65, 'Contrasting theme in a related key.'],
      ["A'", 8, 0.55, 'Theme returns with a richer accompaniment and a firm close.'],
    ],
  },
  'blues-12': {
    description: 'Twelve-bar blues repeated with rising intensity.',
    sections: [
      ['Chorus 1', 12, 0.45, 'Head or vocal line, light comping.'],
      ['Chorus 2', 12, 0.6, 'Solo instrument takes over.'],
      ['Chorus 3', 12, 0.8, 'Full band, call-and-response.'],
      ['Chorus 4', 12, 0.5, 'Head again, ends on a turnaround.'],
    ],
  },
  'minimal-evolve': {
    description: 'One pattern that grows and mutates: minimal and post-rock style.',
    sections: [
      ['Seed', 8, 0.2, 'One instrument, the core pattern.'],
      ['Grow', 8, 0.4, 'Second instrument, same pattern displaced by a beat.'],
      ['Swell', 8, 0.65, 'Third layer and rhythm, dynamics rise.'],
      ['Turn', 8, 0.85, 'Harmony shifts, pattern inverts.'],
      ['Return', 8, 0.35, 'Back to the seed with all the added material remembered.'],
    ],
  },
};

export const FORM_NAMES = Object.keys(FORMS);

const ROLE_ORDER: [string, number][] = [
  ['pad', 0.0], ['chords', 0.2], ['bass', 0.3], ['drums', 0.4], ['melody', 0.35], ['arp', 0.55], ['counter', 0.72], ['fx', 0.85],
];

export function planForm(name: string, roles: string[] = ROLE_ORDER.map((r) => r[0])): Section[] {
  const def = FORMS[name];
  if (!def) throw new Error(`Unknown form "${name}". Known: ${FORM_NAMES.join(', ')}.`);
  let bar = 1;
  return def.sections.map(([n, bars, energy, note]) => {
    const layers = ROLE_ORDER.filter(([role, th]) => roles.includes(role) && energy >= th).map(([role]) => role);
    // breakdown-style sections lose the rhythm section
    const lower = n.toLowerCase();
    const filtered = /breakdown|opening|emergence|fade|intro|resolution|outro/.test(lower) && energy < 0.35 ? layers.filter((l) => l !== 'drums' || /intro|outro/.test(lower) && name !== 'edm-drop') : layers;
    const s: Section = { name: n, bars, energy, layers: filtered, note, startBar: bar };
    bar += bars;
    return s;
  });
}
