// Guide text served by `studio {action:"help"}`. The same material ships as the agent skill in skills/music-studio.

export const GUIDE: Record<string, string> = {
  workflow: `WORKFLOW (follow this order, listen after every stage)
1. Brief. Decide genre, mood, tempo, key, form and the three or four ideas that make the piece specific. Record them with agent {action:"brief"}.
2. Set up: studio {action:"set", tempo, key, sig}. Plan sections with compose {action:"plan_form"} and mark them with compose {action:"mark_form"}.
3. Tracks: tracks {action:"add", name, instrument, preset}. Pick instruments for what they do (see instruments {action:"catalog"}).
4. Harmony first. theory {action:"progression"} proposes options; compose {action:"chords"} voices them. Vary harmony between sections (verse vs chorus vs bridge).
5. Rhythm section: compose {action:"drums"} and compose {action:"bass"} follow the same progression. Give every section its own drum intensity.
6. Melody and counter-lines: write them yourself with notes {action:"add", text:"..."} or start from compose {action:"melody"} and edit.
7. Vary. No part should repeat an identical bar more than 2-4 times. Add pickups, fills, drop-outs, a bridge.
8. Performance: compose {action:"perform"} per instrument (pedal, legato, expression, strums) then compose {action:"humanize"}.
9. Mix: buses and sends (tracks add kind:"bus", effects add type:"reverb"), EQ to separate, compressors for glue, a limiter on master.
10. Listen: listen {action:"analyze"} for numbers and a spectrogram. critique {action:"composition"} and critique {action:"mix"}. Fix what they report.
11. Export: render {action:"mixdown", path, format}.`,

  time: `TIME AND UNITS
- Positions are in beats (quarter notes) from the start, 0-based: 0 is the very beginning, 4 is the start of bar 2 in 4/4.
- Strings: "5:1" = bar 5, beat 1 (1-based). "5" = bar 5. "5:2.5" = bar 5, beat 2.5.
- Lengths: beats (number) or "2 bars", "1/4", "1/8".
- Note text (notes add, text field): "C4:1 E4:0.5 G4:0.5 r:1 [C4 E4 G4]:2@80 Bb3:h!stac"
  pitch[:duration][@velocity][!articulation]; duration is beats or w h q e s (q. = dotted quarter); r = rest; [..] = chord; trailing ~ ties.
- Notes written with an "at" are shifted by that position, so write a section once and place it anywhere.
- Velocity 1-127. 40-60 soft, 70-85 normal, 90-105 loud, 110+ accents.`,

  listen: `HOW TO LISTEN
You cannot hear audio, so listen with numbers and pictures: listen {action:"analyze"} renders the project (or a range) and returns
loudness (LUFS, true peak, dynamic range), spectral balance by band, stereo width and correlation, estimated key and tempo, issues, and a picture.
The picture: top strip = waveform (light core is RMS, red = clipping). Below = spectrogram: x is time with bar lines and bar numbers, y is
frequency on a log scale (labelled 100, 1k, 10k). Brightness is level. Read it like this:
- Horizontal lines are sustained notes; their spacing shows the harmonics. A bass at 50-100 Hz shows as a bright band near the bottom.
- Vertical lines are attacks: kick/snare/hats and plucks. Regular spacing = groove; a column that is missing = a gap or a rest.
- A smear above everything is reverb or noise. A solid wall of orange across the middle is mud.
- A dark top (above 8k) means a dull mix; thin bright speckles up there are hats and air.
- Compare sections: the arrangement arc should be visible as brightness and density changing over time.
For one instrument, use tracks:[name] to solo it in the render. For the human, transport {action:"play"} plays in the app; they can answer through feedback.`,

  realism: `REALISM (making it sound played)
- Pick the right instrument and the right register. Check ranges (instruments {action:"info"}). A cello above C5 or a flute below C4 is not natural.
- Layers: realistic ensembles are many players. Use section presets (Violins (section), Brass section) and add a solo line over them.
- Articulation: art "stac" (short), "pizz", "trem" for strings; "mute" for guitar; "acc" accents. Mix them in a phrase.
- Dynamics follow phrase shape: compose {action:"perform"} adds expression curves (CC11), vibrato (CC1), pedal (CC64). Write crescendos into the notes' velocities too.
- Timing: never perfectly on the grid. compose {action:"humanize"} with timing 5-9 ms, drift 8-14 ms, velocity 5-8. Drums tighter, strings looser (10-18 ms). Lead lines may sit 5-10 ms behind the beat.
- Overlap legato notes (strings, winds, brass) so there are no gaps; separate repeated notes slightly.
- Chords are not struck at once: roll or strum them (compose perform does this for piano and guitar).
- Reverb belongs on a bus, not on every track: one hall for orchestral, one plate for drums and vocals-like leads, short room on drums. Pre-delay 15-30 ms keeps the front clear.
- For studio-grade recorded sounds, load SoundFonts or WAV samples into a sampler track (instruments {action:"sampler"}), or a VST3 when hosting is available.`,

  mix: `MIX BASICS
- Faders: start with drums and bass around -6 dB, chords/pads -9 to -12, lead -6 to -8, then ride by ear and by listen {action:"analyze"}.
- Make room: high-pass everything except kick/bass (utility on 80-120 Hz), cut 250-400 Hz mud on pads and guitars, carve the lead around 2-4 kHz.
- Sidechain: compressor on a pad or bass with sidechain: <kick track id>, ratio 4-8, attack 1-5 ms, release 120-200 ms for a pump.
- Glue: gentle compressor on drums (ratio 3-4, 3 dB reduction) and on the master (ratio 2, 1-2 dB).
- Finish: limiter on master, ceiling -1 dB. Target roughly -14 to -10 LUFS integrated for streaming.
- Mono check: keep bass and kick central; widen pads and strings with chorus or a widener (it keeps bass mono below 120 Hz).`,

  sfx: `SOUND EFFECTS
The library holds 1000+ synthesized effects in categories and folders. sfx {action:"search", query:"laser", category:"Sci-Fi"} finds them;
sfx preview plays one in the app and returns its numbers; sfx place puts it on the timeline (audio track named SFX) at a position.
sfx edit changes its synthesis parameters (family parameters like pitch, length) and an edit chain (gain, fades, reverse, pitch, filters, reverb);
sfx import adds your own file, sfx delete removes a user sound or hides a built-in (sfx restore brings it back), sfx add makes a new one from a family.`,

  mistakes: `COMMON MISTAKES THAT MAKE MUSIC SOUND GENERATED
- One progression for the whole piece. Change harmony at the bridge and vary the last chord of repeats.
- Every bar identical. Vary rhythm and fill every 4 or 8 bars.
- All instruments start together and never leave. Build and release.
- Constant velocity. Real players phrase.
- Melody on chord roots only, or constant stepwise noodling. Use a motif and develop it: repeat, sequence, invert, resolve.
- Everything the same loudness and the same width. Create foreground and background.
- No ending. Slow down, thin out, resolve to the tonic or hold a final chord.
- Writing outside an instrument's range.
- Leaving the master clipped: always check listen analyze for clipping and true peak.`,
};
