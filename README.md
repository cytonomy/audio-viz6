# audio-viz6

Audio-reactive flowfield visualizer in p5.js. Microphone input is analyzed
across 14 frequency ranges, each mapped to a hue on a rotating color wheel.

Live: https://cytonomy.github.io/audio-viz6/

## Controls

- Click anywhere — grant mic access, start the viz
- `F` or double-click — toggle true fullscreen (HUD hidden)
- `H` — toggle HUD
- `L` or right-click — toggle frequency legend

## How it works

Frequency ranges are arranged as angular sectors around screen center — a
rotating color wheel, not a linear L→R spectrum. Particles spawn mostly near
the center (radius biased with `r = random()^2`) and thin out toward the
perimeter. The whole wheel spins CCW, slowly. Active ranges wobble angularly
inside their sector.

A flowfield built from Perlin noise plus a tangential swirl moves each
particle. The swirl uses a quadratic radial ramp — near-stationary at the
core, fastest at the corners — so the canvas reads as rotating.

Only ranges that are at least 45% as loud as the peak band spawn particles,
and spawn counts scale with `pow(exceedance, 1.8)`. This keeps the dominant
hue clean instead of muddied by bleed bands.

Center particles render thicker (`strokeWeight` 4 → 1 with radius) so the
core reads as dense pigment and the perimeter as whip-thin trails.

## Files

- `index.html` — entry
- `sketch.js` — main loop, flowfield, spawn logic, UI
- `particle.js` — particle class (from the audio-viz3 lineage; `show()` is
  overridden in `sketch.js` to honor per-particle `strokeWeight`)
- `p5.js`, `p5.sound.min.js` — p5 runtime

## Lineage

This is the standalone release of what lived at `audio-viz3/v6/`. See
[cytonomy/audio-viz3](https://github.com/cytonomy/audio-viz3) for earlier
iterations.
