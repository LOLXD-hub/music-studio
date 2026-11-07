# Making it sound played

REALISM (making it sound played)
- Pick the right instrument and the right register. Check ranges (instruments {action:"info"}). A cello above C5 or a flute below C4 is not natural.
- Layers: realistic ensembles are many players. Use section presets (Violins (section), Brass section) and add a solo line over them.
- Articulation: art "stac" (short), "pizz", "trem" for strings; "mute" for guitar; "acc" accents. Mix them in a phrase.
- Dynamics follow phrase shape: compose {action:"perform"} adds expression curves (CC11), vibrato (CC1), pedal (CC64). Write crescendos into the notes' velocities too.
- Timing: never perfectly on the grid. compose {action:"humanize"} with timing 5-9 ms, drift 8-14 ms, velocity 5-8. Drums tighter, strings looser (10-18 ms). Lead lines may sit 5-10 ms behind the beat.
- Overlap legato notes (strings, winds, brass) so there are no gaps; separate repeated notes slightly.
- Chords are not struck at once: roll or strum them (compose perform does this for piano and guitar).
- Reverb belongs on a bus, not on every track: one hall for orchestral, one plate for drums and vocals-like leads, short room on drums. Pre-delay 15-30 ms keeps the front clear.
- For studio-grade recorded sounds, load SoundFonts or WAV samples into a sampler track (instruments {action:"sampler"}), or a VST3 when hosting is available.
