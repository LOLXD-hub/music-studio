// "Glass Garden": a wistful neo-classical piece in A minor. Felt piano opens alone, strings and a solo violin
// carry the theme, a horn and flute lift it into the climax (the only place drums play), then it falls back
// to the piano and ends on a Picardy chord. 32 bars at 72 bpm with a slowing last bar.
import { open, finish } from './_lib.mjs';
import { build } from './glass-garden.build.mjs';

const { studio, call, name } = open('glass-garden');
await build(call);
await finish({ studio, call, name }, { lufs: -16 });
process.exit(0);
