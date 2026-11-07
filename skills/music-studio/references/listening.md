# How to listen

You cannot hear audio, so listen with numbers and pictures: listen {action:"analyze"} renders the project (or a range) and returns
loudness (LUFS, true peak, dynamic range), spectral balance by band, stereo width and correlation, estimated key and tempo, issues, and a picture.
The picture: top strip = waveform (light core is RMS, red = clipping). Below = spectrogram: x is time with bar lines and bar numbers, y is
frequency on a log scale (labelled 100, 1k, 10k). Brightness is level. Read it like this:
- Horizontal lines are sustained notes; their spacing shows the harmonics. A bass at 50-100 Hz shows as a bright band near the bottom.
- Vertical lines are attacks: kick/snare/hats and plucks. Regular spacing = groove; a column that is missing = a gap or a rest.
- A smear above everything is reverb or noise. A solid wall of orange across the middle is mud.
- A dark top (above 8k) means a dull mix; thin bright speckles up there are hats and air.
- Compare sections: the arrangement arc should be visible as brightness and density changing over time.
For one instrument, use tracks:[name] to solo it in the render. For the human, transport {action:"play"} plays in the app; they can answer through feedback.
