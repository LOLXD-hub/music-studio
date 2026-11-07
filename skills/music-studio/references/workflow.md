# Workflow

WORKFLOW (follow this order, listen after every stage)
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
11. Export: render {action:"mixdown", path, format}.
