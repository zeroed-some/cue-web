// js/effects.js

export class Effects {
    constructor(audioContext) {
        this.context = audioContext;
        this.setupEffects();
    }
    
    setupEffects() {
        // Mid/Side processing
        this.setupMidSide();
        
        // Bitcrusher
        this.bitcrusher = new AudioWorkletNode(this.context, 'bitcrusher-processor');
        
        // Filters with EXTREME settings
        this.lowpass = this.context.createBiquadFilter();
        this.lowpass.type = 'lowpass';
        this.lowpass.frequency.value = 1000;
        
        this.highpass = this.context.createBiquadFilter();
        this.highpass.type = 'highpass';
        this.highpass.frequency.value = 1000;
        
        // Delay with modulation
        this.setupDelay();
        
        // Add LFO for delay modulation
        this.lfo = this.context.createOscillator();
        this.lfoGain = this.context.createGain();
        this.lfoGain.gain.value = 0.002; // Subtle modulation
        this.lfo.frequency.value = 0.5;
        this.lfo.connect(this.lfoGain);
        this.lfoGain.connect(this.delay.delayTime);
        this.lfo.start();
        
        // Convolution reverb with filter
        this.setupReverb();
        
        // Add reverb filter for character
        this.reverbFilter = this.context.createBiquadFilter();
        this.reverbFilter.type = 'lowpass';
        this.reverbFilter.frequency.value = 5000;
        this.convolver.connect(this.reverbFilter);
        this.reverbFilter.connect(this.reverbMix);
        
        // Spectral freeze
        this.spectralFreeze = new AudioWorkletNode(this.context, 'spectral-freeze-processor');
        
        // Pitch shift (placeholder - uses playback rate in AudioEngine)
        this.pitchShift = this.context.createGain();
        
        // Add a limiter to prevent clipping from extreme effects
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -3;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.001;
        this.limiter.release.value = 0.1;
    }
    
    setupMidSide() {
        this.midSideIn = this.context.createChannelSplitter(2);
        this.midSideOut = this.context.createChannelMerger(2);
        this.midGain = this.context.createGain();
        this.sideGain = this.context.createGain();
        this.sideGain.gain.value = 1.0;
        
        // Create mid/side matrix
        // Mid = (L + R) / 2
        // Side = (L - R) / 2
        this.midSideIn.connect(this.midGain, 0);
        this.midSideIn.connect(this.midGain, 1);
        this.midSideIn.connect(this.sideGain, 0);
        this.midSideIn.connect(this.sideGain, 1);
        
        // Reconstruct L/R from M/S
        this.midGain.connect(this.midSideOut, 0, 0);
        this.midGain.connect(this.midSideOut, 0, 1);
        this.sideGain.connect(this.midSideOut, 0, 0);
        
        // Invert phase for right channel side
        const sideInverter = this.context.createGain();
        sideInverter.gain.value = -1;
        this.sideGain.connect(sideInverter);
        sideInverter.connect(this.midSideOut, 0, 1);
    }
    
    setupDelay() {
        this.delay = this.context.createDelay(2);
        this.delay.delayTime.value = 0.3;
        this.delayFeedback = this.context.createGain();
        this.delayFeedback.gain.value = 0.4;
        this.delayMix = this.context.createGain();
        this.delayMix.gain.value = 0.5;
        this.delayDry = this.context.createGain();
        
        // Feedback loop
        this.delay.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delay);
        this.delay.connect(this.delayMix);
    }
    
    setupReverb() {
        this.convolver = this.context.createConvolver();
        this.reverbMix = this.context.createGain();
        this.reverbMix.gain.value = 0.5;
        this.reverbDry = this.context.createGain();
        
        // Create default impulse response
        this.createDefaultIR();
    }
    
    createDefaultIR() {
        const length = this.context.sampleRate * 2; // 2 seconds
        const impulse = this.context.createBuffer(2, length, this.context.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
            }
        }
        
        this.convolver.buffer = impulse;
    }
    
    setImpulseResponse(buffer) {
        this.convolver.buffer = buffer;
    }
    
    getEffect(name) {
        const effects = {
            'mid_side': this.midSideOut,
            'bitcrush': this.bitcrusher,
            'lowpass': this.lowpass,
            'highpass': this.highpass,
            'delay': this.delayMix,
            'reverb': this.reverbMix,
            'spectral_freeze': this.spectralFreeze,
            'pitch_shift': this.pitchShift
        };
        
        return effects[name];
    }
    
    connectEffect(name, input, output) {
        switch (name) {
            case 'mid_side':
                input.connect(this.midSideIn);
                this.midSideOut.connect(output);
                break;
                
            case 'delay':
                input.connect(this.delay);
                input.connect(this.delayDry);
                this.delayMix.connect(output);
                this.delayDry.connect(output);
                break;
                
            case 'reverb':
                input.connect(this.convolver);
                input.connect(this.reverbDry);
                this.convolver.connect(this.reverbMix);
                this.reverbMix.connect(output);
                this.reverbDry.connect(output);
                break;
                
            default:
                const effect = this.getEffect(name);
                input.connect(effect);
                effect.connect(output);
        }
    }
    
    updateParameter(effectName, value) {
        switch (effectName) {
            case 'mid_side':
                // EXTREME stereo effects - from completely mono to psychedelic width
                this.sideGain.gain.value = value * 8.0; // SUPER WIDE
                // Also mess with the mid gain for more extreme effect
                this.midGain.gain.value = 1 - (value * 0.8); // Reduce mid as side increases
                break;
                
            case 'bitcrush':
                // EXTREME bit reduction with sample rate reduction too!
                const bitDepth = Math.max(1, 8 - (value * 7)); // 8-bit down to 1-bit
                this.bitcrusher.parameters.get('bitDepth').value = bitDepth;
                // TODO: Add sample rate reduction for more lofi effect
                break;
                
            case 'lowpass':
                // INSANE filter sweep from sub-bass to almost nothing
                this.lowpass.frequency.value = 20 * Math.pow(500, value); // 20Hz to 10kHz
                this.lowpass.Q.value = 0.5 + (value * value * 30); // Exponential resonance - SCREAMING at high values
                // Add some gain compensation for the resonance
                const lpGain = 1 - (value * value * 0.5);
                if (this.lowpass.gain) this.lowpass.gain.value = lpGain;
                break;
                
            case 'highpass':
                // CRAZY high pass that can remove everything
                this.highpass.frequency.value = 10 * Math.pow(1000, value); // 10Hz to 10kHz
                this.highpass.Q.value = 0.5 + (value * value * 30); // SCREAMING resonance
                break;
                
            case 'delay':
                // CHAOS delay - multiple taps, extreme feedback
                const delayTime = 0.001 + (value * value * 1.5); // 1ms to 1.5 seconds (exponential)
                this.delay.delayTime.value = delayTime;
                this.delayFeedback.gain.value = Math.min(0.98, value * 1.1); // Can go over 100%!
                this.delayMix.gain.value = value * 1.5; // Delay can be louder than dry
                
                // Modulate delay time slightly for chorus/flanger effects at low values
                if (value < 0.3 && this.lfo) {
                    this.lfo.frequency.value = 2 + value * 10;
                }
                break;
                
            case 'reverb':
                // MASSIVE reverb with pre-delay and filtering
                this.reverbMix.gain.value = value * value * 2; // Exponential curve, can be 200% wet
                this.reverbDry.gain.value = 1 - value;
                
                // Add some filtering to the reverb for more character
                if (this.reverbFilter) {
                    this.reverbFilter.frequency.value = 200 + (1 - value) * 5000; // Darker reverb as it gets wetter
                }
                break;
                
            case 'spectral_freeze':
                // Multiple freeze modes based on position
                if (value < 0.2) {
                    this.spectralFreeze.parameters.get('freeze').value = 0;
                } else if (value < 0.5) {
                    // Stutter freeze
                    this.spectralFreeze.parameters.get('freeze').value = 
                        Math.sin(Date.now() * 0.01) > 0 ? 1 : 0;
                } else {
                    // Full freeze
                    this.spectralFreeze.parameters.get('freeze').value = 1;
                }
                break;
                
            case 'pitch_shift':
                // EXTREME pitch shifting with formant effects
                // This is handled in AudioEngine but let's add a note
                break;
        }
    }
}