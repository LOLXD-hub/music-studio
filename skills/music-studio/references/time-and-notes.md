# Time and note text

- Positions are in beats (quarter notes) from the start, 0-based: 0 is the very beginning, 4 is the start of bar 2 in 4/4.
- Strings: "5:1" = bar 5, beat 1 (1-based). "5" = bar 5. "5:2.5" = bar 5, beat 2.5.
- Lengths: beats (number) or "2 bars", "1/4", "1/8".
- Note text (notes add, text field): "C4:1 E4:0.5 G4:0.5 r:1 [C4 E4 G4]:2@80 Bb3:h!stac"
  pitch[:duration][@velocity][!articulation]; duration is beats or w h q e s (q. = dotted quarter); r = rest; [..] = chord; trailing ~ ties.
- Notes written with an "at" are shifted by that position, so write a section once and place it anywhere.
- Velocity 1-127. 40-60 soft, 70-85 normal, 90-105 loud, 110+ accents.
