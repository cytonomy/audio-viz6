// Audio Reactive Flowfield — v6
// Changes vs v3:
//  - Rebalanced palette: only 1 pure red, warm bass shifts toward amber/ochre/gold;
//    mids and highs get more hue territory so the overall visual is less red-dominant
//  - Comingled spawns: ALL frequency ranges exceeding threshold can spawn particles
//    each frame (weighted by how far over threshold they are) rather than just "most
//    dominant only". Bass is intentionally dampened so it doesn't swamp the canvas.
//  - Loose spatial clustering: particles gravitate toward a frequency-linked cluster
//    but with much wider variance (60% of width) so colors blend and overlap.
//  - Bass alpha dampening: low-freq particles render with reduced opacity so the warm
//    colors don't dominate visually even when bass energy is high.

let flowfield;
let particles = [];
let audioContext;
let analyser;
let dataArray;
let audioInitialized = false;
let fallbackMode = false;
let audioLevel = 0;

// Rebalanced palette — 14 ranges, hue-even across full spectrum.
// Key differences from v3:
//  - Sub Bass: deep crimson/magenta (340°) instead of dark red — cooler warm
//  - Only Deep Bass is true red (355°)
//  - Bass family shifts to orange/amber/gold (20-50°) instead of all red
//  - Mids get more territory (55-170°, golden→green→teal)
//  - Highs span 190-290° (cyan→blue→indigo→violet)
// weight: multiplier on particle count (bass dampened, highs boosted)
// alpha:  multiplier on particle opacity (bass dim, highs bright)
const frequencyRanges = [
  { name: "Sub Bass",   min:    20, max:    40, hue: 340, sat: 75, lit: 50, threshold: 0.12, group: "bass", weight: 0.45, alpha: 0.65 },
  { name: "Deep Bass",  min:    40, max:    80, hue: 355, sat: 80, lit: 55, threshold: 0.11, group: "bass", weight: 0.50, alpha: 0.70 },
  { name: "Bass",       min:    80, max:   160, hue:  18, sat: 85, lit: 58, threshold: 0.18, group: "bass", weight: 0.60, alpha: 0.75 },
  { name: "Upper Bass", min:   160, max:   300, hue:  32, sat: 90, lit: 60, threshold: 0.18, group: "bass", weight: 0.65, alpha: 0.80 },

  { name: "Low Mids",   min:   300, max:   500, hue:  48, sat: 90, lit: 58, threshold: 0.22, group: "mid",  weight: 0.75, alpha: 0.75 },
  { name: "Mid-Low",    min:   500, max:   800, hue:  65, sat: 90, lit: 58, threshold: 0.22, group: "mid",  weight: 0.85, alpha: 0.80 },
  { name: "Mid",        min:   800, max:  1200, hue:  95, sat: 85, lit: 55, threshold: 0.22, group: "mid",  weight: 1.00, alpha: 0.85 },
  { name: "Mid-High",   min:  1200, max:  2000, hue: 135, sat: 80, lit: 55, threshold: 0.20, group: "mid",  weight: 1.10, alpha: 0.90 },
  { name: "High Mids",  min:  2000, max:  3000, hue: 165, sat: 80, lit: 55, threshold: 0.16, group: "mid",  weight: 1.15, alpha: 0.90 },

  { name: "Low Treble", min:  3000, max:  4000, hue: 190, sat: 90, lit: 58, threshold: 0.10, group: "high", weight: 1.25, alpha: 1.00 },
  { name: "Mid Treble", min:  4000, max:  6000, hue: 215, sat: 90, lit: 60, threshold: 0.09, group: "high", weight: 1.20, alpha: 0.95 },
  { name: "Presence",   min:  6000, max:  8000, hue: 240, sat: 85, lit: 62, threshold: 0.08, group: "high", weight: 1.05, alpha: 0.85 },
  // Purple bands (Brilliance/Air) used to dominate: very low thresholds + max
  // weight + full alpha → they fired constantly on background hiss/noise.
  // Bumped thresholds, halved weight bonus, dropped alpha, and shifted Air
  // toward pink/magenta (320°) so the top of the spectrum reads as variety
  // rather than a single purple wash.
  { name: "Brilliance", min:  8000, max: 12000, hue: 265, sat: 80, lit: 65, threshold: 0.08, group: "high", weight: 0.95, alpha: 0.75 },
  { name: "Air",        min: 12000, max: 20000, hue: 320, sat: 85, lit: 70, threshold: 0.08, group: "high", weight: 0.90, alpha: 0.70 }
];

let showFrequencyLegend = true;
let uiVisible = true;
let swirlPhase = 0;      // drifts the swirl center slightly so it doesn't feel mechanical
let globalRotation = 0;  // rotates the angular arrangement of freq zones around the canvas

// Per-group energy averages (computed in analyzeAudio). Used by rotation,
// swirl, and spawn logic so each frequency family drives a distinct visual:
//   bass  → swirl-strength pulses (the whole canvas sweeps wider on a kick)
//   mid   → steady rotation rate
//   high  → quick rotation kicks + a small angular jitter on rotation
let bassLevel = 0;
let midLevel = 0;
let highLevel = 0;
let peakEnergy = 0;

// Beat-pulse envelope: smoothed peak-hold on bassLevel, used to gently
// modulate stroke weight on every live particle so the whole canvas
// breathes with the beat. Skipping true BPM extraction — the envelope
// alone reads as "to the beat" and never mis-locks.
let pulseEnvelope = 0;

// Convert the HSL palette to RGB once at load time so particle rendering
// (which uses the default RGB color mode) works without push/pop gymnastics.
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}
for (const r of frequencyRanges) {
  const [rr, gg, bb] = hslToRgb(r.hue, r.sat, r.lit);
  r.rgb = [rr, gg, bb];
}

// v6: override Particle.show to honor a per-particle strokeWeight field.
// Leaves v3's Particle class untouched at source — just swaps the method on
// the prototype when this script runs. Falls back to strokeWeight=1 if the
// particle wasn't assigned one (so any v3-origin particles would still work).
Particle.prototype.show = function () {
  stroke(red(this.color), green(this.color), blue(this.color), this.lifespan);
  // Apply the global beat pulse to every live particle's stroke (not just
  // newly-spawned ones) so the whole field thickens together on the beat.
  // 0.30 multiplier puts the swing at ~30% on peaks — clearly felt as a
  // bounce. Above ~0.40 starts crossing into strobe territory.
  strokeWeight((this.strokeWeight || 1) * (1 + pulseEnvelope * 0.30));
  line(this.pos.x, this.pos.y, this.prevPos.x, this.prevPos.y);
  this.updatePrev();
};

function setup() {
  createCanvas(windowWidth, windowHeight);
  background(0);

  flowfield = {
    scale: 40,
    cols: floor(width / 20),
    rows: floor(height / 20),
    field: [],
    zoff: 0
  };
  for (let i = 0; i < flowfield.cols * flowfield.rows; i++) {
    flowfield.field[i] = createVector(0, 0);
  }

  textAlign(CENTER);
  fill(255);
  text("Click anywhere to start audio input", width/2, height/2);
}

function draw() {
  // Fade background for the trail effect.
  // Alpha must stay ≥ ~30 — below that, 8-bit canvas rounding causes faint
  // pixels to never decay to pure black, leaving a permanent haze on the canvas.
  noStroke();
  fill(0, 0, 0, 34);
  rect(0, 0, width, height);

  // Audio analysis must run before rotation/swirl so they can read the
  // freshly-computed per-group energy levels (bass/mid/high).
  if (audioInitialized || fallbackMode) {
    analyzeAudio();
  }

  // Global rotation: each frequency family contributes differently so the
  // canvas response feels distinct per sound type rather than one blended
  // audioLevel curve.
  //   - mids carry steady sustained rotation
  //   - highs add zippy kicks (treble = visible spin acceleration)
  //   - bass mildly drags rotation down (heavy low end feels weightier)
  // Bumped base rate for a more visible spin even in silence.
  const highKick = highLevel * 0.024 * (1 + 0.4 * sin(frameCount * 0.18));
  globalRotation += 0.014
                  + midLevel * 0.016
                  + highKick
                  - bassLevel * 0.004;

  updateFlowField();

  if (audioInitialized || fallbackMode) {
    spawnParticlesComingled();
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].follow(flowfield);
    particles[i].update();
    particles[i].edges();
    particles[i].show();

    if (particles[i].isDead()) {
      particles.splice(i, 1);
    }
  }

  if (uiVisible) {
    displayAudioLevelIndicator();
    if (showFrequencyLegend) {
      displayFrequencyLegend();
    }
  }

  if (!audioInitialized && !fallbackMode) {
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(18);
    text('Click anywhere to start audio input', width/2, height/2);
    textSize(12);
    fill(180);
    text('v6 — swirl + distinct zones · F: fullscreen · H: toggle HUD', width/2, height/2 + 30);
  }
}

function updateFlowField() {
  // Whole-animation rotation, centered on the screen (with a very slight drift
  // so it doesn't feel mechanical). Rotation speed grows with distance from
  // center — calm core, faster perimeter, like a vinyl spinning.
  swirlPhase += 0.002;
  const cx = width / 2 + cos(swirlPhase) * width * 0.03;
  const cy = height / 2 + sin(swirlPhase * 0.7) * height * 0.03;

  // Swirl strength: bass dominates here so kick drums / sub-bass produce a
  // clearly-felt "sweep wider" pulse, while mid/high audio adds a smaller
  // generic boost. The quadratic radial ramp below keeps the center calm
  // and the edges sweep dramatically.
  const swirlBase = 1.5;
  const swirlBoost = bassLevel * 1.1 + audioLevel * 0.25;
  const swirlStrength = swirlBase + swirlBoost;

  // Normalize radius against the distance from center to the farthest corner.
  const maxRadius = Math.hypot(width, height) / 2;

  let yoff = 0;
  for (let y = 0; y < flowfield.rows; y++) {
    let xoff = 0;
    for (let x = 0; x < flowfield.cols; x++) {
      const index = x + y * flowfield.cols;

      // Base Perlin-noise vector (same as v3)
      const angle = noise(xoff, yoff, flowfield.zoff) * TWO_PI * 2;
      const v = p5.Vector.fromAngle(angle);
      v.setMag(0.5);

      // Swirl: tangent direction around (cx, cy). Strength grows with radius
      // (quadratic ramp) — near-stationary center, fastest rotation at edges.
      const cellX = x * flowfield.scale + flowfield.scale / 2;
      const cellY = y * flowfield.scale + flowfield.scale / 2;
      const dx = cellX - cx;
      const dy = cellY - cy;
      const r = Math.hypot(dx, dy);
      const rNorm = Math.min(r / maxRadius, 1);          // 0 at center, 1 at corners
      const radialMult = 0.05 + 2.4 * rNorm * rNorm;     // steeper quadratic ramp
      const tangent = createVector(-dy, dx);             // perpendicular → CCW swirl
      if (tangent.magSq() > 0) {
        tangent.normalize();
        tangent.mult(swirlStrength * radialMult);
        v.add(tangent);
      }

      flowfield.field[index] = v;
      xoff += 0.1;
    }
    yoff += 0.1;
  }
  flowfield.zoff += 0.01;
}

function analyzeAudio() {
  if (audioInitialized && analyser && dataArray) {
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    audioLevel = sum / (dataArray.length * 255);
    audioLevel = pow(audioLevel, 0.7);
  } else if (fallbackMode) {
    audioLevel = 0.3 + 0.3 * sin(frameCount * 0.05);
    if (random(1) < 0.05) audioLevel = random(0.2, 0.8);
  }

  // Per-band + per-group rollup. Stored on the range objects so the spawn
  // pass can reuse them, plus aggregated into bass/mid/high group levels
  // that drive rotation and swirl.
  let bassSum = 0, midSum = 0, highSum = 0;
  let bassN = 0, midN = 0, highN = 0;
  peakEnergy = 0;
  for (const range of frequencyRanges) {
    const energy = getBandEnergy(range.min, range.max);
    range.currentEnergy = energy;
    range.relativeEnergy = 4 * energy / range.threshold;
    range.isActive = energy > range.threshold;
    if (range.isActive && energy > peakEnergy) peakEnergy = energy;
    if (range.group === "bass") { bassSum += energy; bassN++; }
    else if (range.group === "mid") { midSum += energy; midN++; }
    else if (range.group === "high") { highSum += energy; highN++; }
  }
  bassLevel = bassN ? bassSum / bassN : 0;
  midLevel = midN ? midSum / midN : 0;
  highLevel = highN ? highSum / highN : 0;

  // Peak-hold envelope on bassLevel: rises instantly to a new bass peak,
  // then decays exponentially. At 60fps a 0.92 decay halves the envelope
  // in ~8 frames (~130ms) — feels like a heartbeat, not a flicker.
  pulseEnvelope = Math.max(pulseEnvelope * 0.92, bassLevel);
}

// v6: Multiple ranges can spawn simultaneously (comingling), but spawn counts
// are power-weighted so only TRULY dominant ranges fire lots of particles.
// This prevents bleed bands (e.g. when bass is active, upper-bass/low-mids
// often show moderate energy too) from muddying the color.
function spawnParticlesComingled() {
  // Per-range energies + peakEnergy are now computed in analyzeAudio() so
  // rotation/swirl can read them too. Just iterate and spawn here.
  for (let i = 0; i < frequencyRanges.length; i++) {
    const range = frequencyRanges[i];
    if (!range.isActive) continue;

    const energy = range.currentEnergy;

    // Peak-relative gate: skip ranges that are far below the loudest range.
    // Tightened from 0.45 → 0.58 — only ranges within ~half the dominant
    // range's intensity spawn at all. Makes the dominant note's color pop
    // instead of blending with neighboring bleed bands into a haze.
    if (peakEnergy > 0 && energy / peakEnergy < 0.58) continue;

    // Normalized exceedance (0 at threshold, ~1 when very loud). Power curve
    // makes mid-energy bands spawn very little; only loud bands spawn a lot.
    const headroom = Math.max(0.001, 1 - range.threshold);
    const exceedNorm = Math.max(0, (energy - range.threshold)) / headroom;
    const exceedPower = Math.pow(exceedNorm, 1.8);

    // Spawn-rate is also pulse-modulated: on the beat, ranges that pass the
    // peak gate fire up to ~50% more particles. Combined with the stroke
    // pulse, this puts a visible density burst right on the kick.
    const beatSpawnBoost = 1 + pulseEnvelope * 0.5;
    let count = Math.floor(exceedPower * 18 * range.weight * beatSpawnBoost);
    count = Math.min(count, 40);
    if (count < 1) continue;

    for (let j = 0; j < count; j++) {
      createColoredParticle(range, energy);
    }
  }
}

function createColoredParticle(range, energy) {
  // v6 (angular layout): frequency ranges are arranged around the canvas in
  // angular sectors (like a clock face / color wheel). Particle density is
  // heavily biased toward the center so the majority of pigment lives near
  // the middle regardless of which frequencies are dominant. The whole wheel
  // rotates globally; energetic ranges also wobble angularly.
  const rangeIndex = frequencyRanges.indexOf(range);
  const totalRanges = frequencyRanges.length;

  // Base angle: each range owns a sector of the circle.
  const sectorAngle = TWO_PI / totalRanges;
  const baseAngle = rangeIndex * sectorAngle;

  // Energy-driven wobble — very active ranges shift their home angle slightly
  // so the "zone" can visibly slide when the music shifts.
  const energyWobble = sin(frameCount * 0.012 + rangeIndex * 1.37) *
                       (range.relativeEnergy || 0) * 0.18;

  const homeAngle = baseAngle + globalRotation + energyWobble;

  // Cluster blob per range: each frequency has a fixed home position on a
  // mid-radius ring, and particles spawn in a small gaussian blob around it.
  // This makes same-color particles visibly cluster on spawn — the flowfield
  // and swirl then carry them outward and mix the clusters together over time.
  const maxR = Math.min(width, height) * 0.48;
  const clusterRadius = maxR * 0.42;
  const cx = width / 2;
  const cy = height / 2;
  const clusterX = cx + Math.cos(homeAngle) * clusterRadius;
  const clusterY = cy + Math.sin(homeAngle) * clusterRadius;

  // Blob size scales with range energy — louder bands have a slightly wider
  // cluster (more particles, looser pack) so transients still look explosive.
  const blobBase = maxR * 0.07;
  const blobEnergy = Math.min(range.relativeEnergy || 0, 1.5) * maxR * 0.04;
  const blobSize = blobBase + blobEnergy;
  const x = clusterX + randomGaussian(0, blobSize);
  const y = clusterY + randomGaussian(0, blobSize);

  // rNorm derived from actual spawn position so the radial-thickness logic
  // below still has something meaningful to read (used for stroke weight).
  const rNorm = Math.min(Math.hypot(x - cx, y - cy) / maxR, 1);

  const p = new Particle(x, y);

  // Use the pre-computed RGB values for the range
  p.color = color(range.rgb[0], range.rgb[1], range.rgb[2]);

  // Lifespan + fade-rate variation creates a mix of short streaks and long
  // ribbon trails. Lifespan can exceed 255 (p5 clamps the alpha when drawing),
  // so high-lifespan particles stay at full brightness for many frames before
  // they begin fading — that's what produces a long visible trail.
  const lifeRoll = Math.random();
  let lifeMultiplier, fadeRate;
  if (lifeRoll < 0.55) {
    // Majority: medium streaks (longer than v6.0 — softer fade too)
    lifeMultiplier = random(1.85, 2.75);
    fadeRate = random(1.1, 1.8);
  } else if (lifeRoll < 0.88) {
    // Mid: long ribbons
    lifeMultiplier = random(3.0, 4.4);
    fadeRate = random(0.7, 1.2);
  } else {
    // Rare: very long persistent ribbons
    lifeMultiplier = random(4.5, 6.3);
    fadeRate = random(0.25, 0.55);
  }
  p.lifespan = 255 * range.alpha * lifeMultiplier;
  p.fadeRate = fadeRate;

  // Stroke weight: thinner overall — particles read as streaks, not blobs.
  // Tightened from v6.0 ranges to bring the average ~20% thinner; the global
  // pulseEnvelope multiplier in Particle.show then breathes the whole field
  // back up by up to 15% on the beat, so loud transients still feel chunky.
  const radialWeight = 0.5 + (1 - rNorm) * 1.0;  // 1.5 at center → 0.5 at edge
  const sizeRoll = Math.random();
  let sizeFactor;
  if (sizeRoll < 0.65) {
    sizeFactor = random(0.35, 0.8);   // slim majority
  } else if (sizeRoll < 0.93) {
    sizeFactor = random(0.8, 1.35);   // medium
  } else {
    sizeFactor = random(1.35, 2.1);   // rare chunky standouts
  }
  const energyBoost = 1 + Math.min(range.relativeEnergy || 0, 1.5) * 0.27;
  p.strokeWeight = radialWeight * sizeFactor * energyBoost;

  // Speed scaling by group — bumped a touch so the now-longer-lived particles
  // travel meaningfully further, producing visibly longer streak trails.
  if (range.group === "bass") {
    p.maxSpeed = map(energy, range.threshold, 1, 1.4, 3.8);
  } else if (range.group === "high") {
    p.maxSpeed = map(energy, range.threshold, 0.5, 2.6, 6.0);
  } else {
    p.maxSpeed = map(energy, range.threshold, 1, 2.0, 4.8);
  }
  p.maxSpeed = constrain(p.maxSpeed, 1.2, 6.0);

  particles.push(p);
}

function getBandEnergy(minFreq, maxFreq) {
  if (!audioInitialized || !analyser || !dataArray) {
    return 0.1 + 0.2 * sin(frameCount * 0.05 + minFreq * 0.001);
  }
  const sampleRate = audioContext.sampleRate;
  const binCount = analyser.frequencyBinCount;
  const nyquist = sampleRate / 2;
  const minBin = Math.floor(minFreq / nyquist * binCount);
  const maxBin = Math.floor(maxFreq / nyquist * binCount);
  let sum = 0;
  let count = 0;
  for (let i = minBin; i <= maxBin; i++) {
    if (i >= 0 && i < binCount) {
      sum += dataArray[i];
      count++;
    }
  }
  return count > 0 ? (sum / (count * 255)) : 0;
}

function displayAudioLevelIndicator() {
  push();
  noStroke();
  fill(255, 100);
  const indicatorSize = map(audioLevel, 0, 1, 5, 20);
  ellipse(width - 20, 20, indicatorSize, indicatorSize);
  textSize(10);
  textAlign(RIGHT);
  fill(255, 180);
  text("Audio Level", width - 30, 23);
  fill(150, 150);
  text("v6", width - 30, 38);
  pop();
}

function displayFrequencyLegend() {
  push();
  const legendHeight = 40;
  const legendY = height - legendHeight - 10;
  const boxWidth = width / frequencyRanges.length;

  for (let i = 0; i < frequencyRanges.length; i++) {
    const range = frequencyRanges[i];
    const x = i * boxWidth;

    // Background
    if (range.isActive) {
      fill(60, 60, 60, 200);
      stroke(255);
      strokeWeight(1.5);
    } else {
      fill(25, 25, 25, 180);
      noStroke();
    }
    rect(x, legendY, boxWidth, legendHeight);

    // Color swatch
    noStroke();
    fill(range.rgb[0], range.rgb[1], range.rgb[2]);
    rect(x + 5, legendY + 5, boxWidth - 10, 10);

    // Text
    fill(255);
    textAlign(CENTER);
    textSize(9);
    text(range.name, x + boxWidth/2, legendY + 25);
    textSize(8);
    fill(200);
    text(range.min + "-" + range.max + "Hz", x + boxWidth/2, legendY + 35);

    // Energy bar (yellow normally, green when active)
    if (range.relativeEnergy !== undefined) {
      const barHeight = 4;
      const barWidth = (boxWidth - 10) * constrain(range.relativeEnergy, 0, 1);
      if (range.isActive) fill(100, 255, 100); else fill(255, 255, 0, 180);
      rect(x + 5, legendY + 16, barWidth, barHeight);
    }
  }
  pop();
}

function mousePressed() {
  if (!audioInitialized && !fallbackMode) {
    initializeAudio();
  }
  if (mouseButton === RIGHT) {
    showFrequencyLegend = !showFrequencyLegend;
    return false;
  }
}

function keyPressed() {
  if (key === 'l' || key === 'L') {
    showFrequencyLegend = !showFrequencyLegend;
  } else if (key === 'h' || key === 'H') {
    uiVisible = !uiVisible;
  } else if (key === 'f' || key === 'F') {
    toggleFullscreen();
  }
}

function doubleClicked() {
  toggleFullscreen();
  return false;
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    // Entering fullscreen: hide HUD so the canvas fills the screen cleanly.
    uiVisible = false;
    (el.requestFullscreen ||
     el.webkitRequestFullscreen ||
     el.mozRequestFullScreen ||
     el.msRequestFullscreen).call(el).catch(e => console.warn('[v6] fullscreen failed:', e));
  } else {
    (document.exitFullscreen ||
     document.webkitExitFullscreen ||
     document.mozCancelFullScreen ||
     document.msExitFullscreen).call(document);
    // Restore HUD when leaving
    uiVisible = true;
  }
}

// Handle fullscreen changes driven by the browser (Esc exit, etc.) so canvas
// resizes to the real viewport and HUD state stays correct.
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) {
    uiVisible = false;
  } else {
    uiVisible = true;
  }
  // Give the browser a moment to settle the viewport then resize
  setTimeout(() => {
    if (typeof resizeCanvas === 'function') {
      resizeCanvas(window.innerWidth, window.innerHeight);
      if (flowfield) {
        flowfield.cols = floor(width / flowfield.scale);
        flowfield.rows = floor(height / flowfield.scale);
        flowfield.field = [];
        for (let i = 0; i < flowfield.cols * flowfield.rows; i++) {
          flowfield.field[i] = createVector(0, 0);
        }
      }
    }
  }, 100);
});

function initializeAudio() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function(stream) {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        audioInitialized = true;
        console.log("[v6] Audio initialized");
      })
      .catch(function(err) {
        console.error("[v6] Audio error:", err);
        fallbackMode = true;
      });
  } catch (e) {
    console.error("[v6] AudioContext error:", e);
    fallbackMode = true;
  }
}

function windowResized() {
  // Bail if p5 fires this before setup() has built the renderer / flowfield —
  // can happen on page load if the browser dispatches a resize during init.
  if (!flowfield || typeof width === 'undefined') return;
  resizeCanvas(windowWidth, windowHeight);
  background(0);
  flowfield.cols = floor(width / flowfield.scale);
  flowfield.rows = floor(height / flowfield.scale);
  flowfield.field = [];
  for (let i = 0; i < flowfield.cols * flowfield.rows; i++) {
    flowfield.field[i] = createVector(0, 0);
  }
}
