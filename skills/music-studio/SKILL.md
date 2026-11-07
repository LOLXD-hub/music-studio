---
name: music-studio
description: Write, edit, mix and export music and sound effects in the Music studio app over MCP. Use it when the user asks for a song, a score, an arrangement, a beat, a mix, a sound effect, or to change something in an open Music studio project. It covers how to plan a piece, how to listen without ears, how to make parts sound played, and how to avoid generated-sounding output.
---

# Music studio

Music studio is a desktop DAW with its own synthesis engine and an MCP server. You compose by calling tools. The person watches your calls in the app, hears the result when they press play, and can answer by text, by pinning a note on the timeline, or by editing blocks themselves. Treat the project as shared: read before you write, and keep the changes small enough that they can follow.

## Before the first call

1. Call `studio {action:"status"}`. It shows the project, tracks, tempo, key and whether the person is in the app.
2. Call `studio {action:"help", topic:"workflow"}` once. The same guides ship below in `references/`.
3. Call `agent {action:"feedback"}` at the start of every turn. The person may have left messages, pins on the timeline, or ratings.

If the tools are missing, the app is not running or not connected. Tell the person to open Music studio and use Options > Connect your AI.

## Rules that decide the quality

- **No audio from outside.** The engine makes every sound itself. Do not look for loops, stock samples or generated audio to put on a track. Import a file only when the person gives you one.
- **FFmpeg is for conversion only.** The app uses it to read or write formats it cannot do natively. Never use it, or any command-line tool, to generate music or effects.
- **Write notes, not audio.** Music is MIDI clips on instrument tracks. The engine renders them the same way for playback and for export.
- **Plan, then build, then listen.** Write a brief with `agent {action:"brief"}`: genre, mood, key, tempo, form, three ideas that make this piece specific. Update the steps as you finish them.
- **Listen after every stage.** You cannot hear, so use `listen {action:"analyze"}`: loudness, spectral balance, stereo width, estimated key, and a picture. Then `critique {action:"composition"}` and `critique {action:"mix"}`.
- **Change one thing at a time**, then check. If a change makes things worse, `studio {action:"undo"}`.

## Building a piece

Follow the order in `references/workflow.md`. The short form:

1. `studio set` for tempo, key and time signature. `compose plan_form` and `compose mark_form` for sections.
2. `tracks add` for each part. Choose instruments for their role and register (`instruments catalog`, `instruments info`).
3. Harmony first: `theory progression`, then `compose chords`. Change harmony between sections.
4. Rhythm section: `compose drums` and `compose bass` against the same progression. Give each section its own intensity.
5. Melody and counter-lines. Write the main idea yourself with `notes add` and its compact text, or start from `compose melody` and edit it. Develop one motif: repeat it, sequence it, answer it, lift it, resolve it.
6. Performance: `compose perform` per track, then `compose humanize`.
7. Mix: buses and sends for reverb, EQ to separate, compression for glue, a limiter on the master.
8. Check and export: `listen analyze`, the two critiques, then `render mixdown`.

Positions are beats (0-based) or `"bar:beat"` strings. Note text looks like `C4:1 E4:0.5 [C4 E4 G4]:2@80 Bb3:h!stac`. See `references/time-and-notes.md`.

## Listening

Read `references/listening.md` before you interpret a spectrogram. In short: horizontal lines are sustained notes, vertical lines are attacks, a bright wall in the middle is mud, a dark top is a dull mix, and the arrangement arc should show as density and brightness changing over time. The critic reports things the picture cannot show: notes outside the key, a melody that never rests, tracks fighting for the same range.

When the person gives feedback through the app, `agent feedback` returns it. Pins carry a track and a bar. Answer each one with `agent reply` after you act on it.

## Making it sound played

`references/realism.md` has the full list. The ones that matter most:

- Stay inside the instrument's range and use its natural register.
- Vary velocity inside phrases. Constant velocity is the first thing people hear as machine-made.
- Overlap legato notes. Roll or strum chords. Run `compose perform`.
- Timing is never on the grid: 5-9 ms for pianos and drums, 10-18 ms for strings.
- Put reverb on a bus, not on every track.
- Build and release: parts enter, leave, and the piece ends instead of stopping.

## Sound effects

The Sound FX section holds 1000+ synthesized effects in folders. Use `sfx search`, `sfx preview` (returns numbers about the sound), `sfx place` to put one on the timeline, `sfx edit` to change its parameters, and `sfx import`, `sfx delete`, `sfx add` to manage the library. See `references/sfx.md`.

## Mistakes to avoid

`references/mistakes.md`. The common ones: one progression for the whole piece, every bar identical, everything starting together, no ending, writing outside an instrument's range, a clipped master.

## Honest limits

- Instruments are synthesized (physical models, source-filter voices, FM, subtractive). They are not recordings. For recorded sounds, load WAV samples into a sampler track.
- VST3 plugins are scanned and listed, not hosted.
- You cannot hear the result. Say so when you report, and describe what the analysis showed rather than how it "sounds".

## Reference

- `references/workflow.md`, `time-and-notes.md`, `listening.md`, `realism.md`, `mix.md`, `sfx.md`, `mistakes.md`
- `references/tools.md`: every tool and action with its fields.
