/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Native Web Audio API synthesizer for retro high-stress lexical game audio feedback
class AudioManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private noiseBuffer: AudioBuffer | null = null;

  private initCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  private getNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuffer) {
      const bufferSize = this.ctx.sampleRate * 0.1; // 0.1s is plenty for a tick
      this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return this.noiseBuffer;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted() {
    return this.muted;
  }

  playType() {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (e) {
      // Ignored
    }
  }

  playTick(isTock: boolean = false) {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      
      const now = this.ctx.currentTime;
      
      // Layer 1: Metal casing/escapement wheel resonance
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      
      osc.type = "sine";
      // Natural clock balance: Tock has a slightly lower, warmer resonance than Tick
      const frequency = isTock ? 1600 : 2100;
      osc.frequency.setValueAtTime(frequency, now);
      
      // Extremely sharp impulse attack with micro decay
      oscGain.gain.setValueAtTime(0.08, now);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
      
      osc.connect(oscGain);
      oscGain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.02);

      // Layer 2: Escapement pallet click (mechanical dry noise burst)
      const noise = this.ctx.createBufferSource();
      const noiseBuf = this.getNoiseBuffer();
      if (noiseBuf) {
        noise.buffer = noiseBuf;
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.setValueAtTime(isTock ? 4200 : 5800, now);
        filter.Q.setValueAtTime(1.5, now);
        
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.14, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
        
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        
        noise.start(now);
        noise.stop(now + 0.025);
      }
    } catch (e) {
      // Ignored
    }
  }

  playExplode() {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      // Low frequency rumble
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(120, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(30, this.ctx.currentTime + 0.6);

      // Noise simulation
      const bufferSize = this.ctx.sampleRate * 0.6;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = "lowpass";
      noiseFilter.frequency.setValueAtTime(400, this.ctx.currentTime);
      noiseFilter.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.6);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.6);

      gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.6);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.6);
      noise.start();
      noise.stop(this.ctx.currentTime + 0.6);
    } catch (e) {
      // Ignored
    }
  }

  playSuccess() {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, this.ctx.currentTime + 0.1); // E5

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.25);
    } catch (e) {
      // Ignored
    }
  }

  playOpen() {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      // Ascending chime: E4 -> G4 -> C5
      osc.frequency.setValueAtTime(329.63, this.ctx.currentTime); // E4
      osc.frequency.setValueAtTime(392.00, this.ctx.currentTime + 0.08); // G4
      osc.frequency.setValueAtTime(523.25, this.ctx.currentTime + 0.16); // C5

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch (e) {
      // Ignored
    }
  }

  playClose() {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      // Descending drop: C5 -> G4 -> E4
      osc.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
      osc.frequency.setValueAtTime(392.00, this.ctx.currentTime + 0.08); // G4
      osc.frequency.setValueAtTime(329.63, this.ctx.currentTime + 0.16); // E4

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch (e) {
      // Ignored
    }
  }

  playError() {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, this.ctx.currentTime);
      osc.frequency.setValueAtTime(120, this.ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch (e) {
      // Ignored
    }
  }

  playCountdown(value?: number) {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      if (value === 0) {
        // "START!" - Big energetic high-pitched chord / fanfare chime
        const frequencies = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        frequencies.forEach((freq, idx) => {
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
          
          // Slight delay for a beautiful arpeggiated ring
          const startTime = this.ctx.currentTime + idx * 0.04;
          
          gain.gain.setValueAtTime(0, this.ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.12, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
          
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          
          osc.start(startTime);
          osc.stop(startTime + 0.45);
        });
      } else {
        // Ticks for 3, 2, 1 with a very clear rising sequence
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "triangle";
        // 3 -> 440Hz, 2 -> 660Hz, 1 -> 880Hz (Perfect fifth and octave jump for unmistakable rise)
        const freq = value === 1 ? 880 : value === 2 ? 660 : 440;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        // Quick, clean decay
        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.25);
      }
    } catch (e) {
      // Ignored
    }
  }

  playGameOver(victory: boolean) {
    if (this.muted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      
      if (victory) {
        // Victory chime: C5 -> E5 -> G5 -> C6
        osc.frequency.setValueAtTime(523.25, this.ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, this.ctx.currentTime + 0.12);
        osc.frequency.setValueAtTime(783.99, this.ctx.currentTime + 0.24);
        osc.frequency.setValueAtTime(1046.50, this.ctx.currentTime + 0.36);
        
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.7);
      } else {
        // Defeat downer: C4 -> G3 -> E3
        osc.frequency.setValueAtTime(261.63, this.ctx.currentTime);
        osc.frequency.setValueAtTime(196.00, this.ctx.currentTime + 0.2);
        osc.frequency.setValueAtTime(164.81, this.ctx.currentTime + 0.4);
        
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.8);
      }

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.8);
    } catch (e) {
      // Ignored
    }
  }
}

export const audio = new AudioManager();
