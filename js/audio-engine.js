// js/audio-engine.js
import { Effects } from './effects.js';

export class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.source = null;
        this.isPlaying = false;
        this.audioBuffer = null;
        
        // Microphone support
        this.microphoneStream = null;
        this.microphoneSource = null;
        this.isMicrophoneActive = false;
        
        this.currentEffectIndex = 0;
        this.currentParam = 0.5;
        this.rawParam = 0.5;
        this.smoothedParam = 0.5;
        this.paramSmoothFactor = 0.2;
        
        this.effectNames = [
            'mid_side', 
            'bitcrush', 
            'lowpass', 
            'highpass', 
            'delay', 
            'reverb', 
            'spectral_freeze', 
            'pitch_shift'
        ];
        
        this.effects = null;
        this.effectNodes = [];
    }
    
    async init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Load AudioWorklet modules
            await this.loadWorklets();
            
            // Setup audio graph
            this.setupAudioGraph();
        }
    }
    
    async loadWorklets() {
        try {
            // Load bitcrusher worklet
            const bitcrusherResponse = await fetch('js/worklets/bitcrusher.js');
            const bitcrusherCode = await bitcrusherResponse.text();
            const bitcrusherBlob = new Blob([bitcrusherCode], { type: 'application/javascript' });
            const bitcrusherUrl = URL.createObjectURL(bitcrusherBlob);
            await this.audioContext.audioWorklet.addModule(bitcrusherUrl);
            
            // Load spectral freeze worklet
            const freezeResponse = await fetch('js/worklets/spectral-freeze.js');
            const freezeCode = await freezeResponse.text();
            const freezeBlob = new Blob([freezeCode], { type: 'application/javascript' });
            const freezeUrl = URL.createObjectURL(freezeBlob);
            await this.audioContext.audioWorklet.addModule(freezeUrl);
        } catch (err) {
            console.error('Error loading AudioWorklets:', err);
            console.log('Falling back to inline worklets');
            
            // Fallback: load worklets inline
            await this.loadInlineWorklets();
        }
    }
    
    async loadInlineWorklets() {
        // Inline worklet code as fallback
        const bitcrusherProcessor = `
            class BitcrusherProcessor extends AudioWorkletProcessor {
                static get parameterDescriptors() {
                    return [{
                        name: 'bitDepth',
                        defaultValue: 8,
                        minValue: 1,
                        maxValue: 16,
                        automationRate: 'k-rate'
                    }];
                }
                
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    const output = outputs[0];
                    const bitDepth = parameters.bitDepth[0];
                    
                    const step = 2 / Math.pow(2, bitDepth);
                    
                    for (let channel = 0; channel < input.length; channel++) {
                        const inputChannel = input[channel];
                        const outputChannel = output[channel];
                        
                        for (let i = 0; i < inputChannel.length; i++) {
                            const sample = inputChannel[i];
                            outputChannel[i] = Math.round(sample / step) * step;
                        }
                    }
                    
                    return true;
                }
            }
            
            registerProcessor('bitcrusher-processor', BitcrusherProcessor);
        `;
        
        const spectralFreezeProcessor = `
            class SpectralFreezeProcessor extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.frozenSpectrum = null;
                    this.isActive = false;
                    this.port.onmessage = (e) => {
                        if (e.data.type === 'setActive') {
                            this.isActive = e.data.value;
                            if (!this.isActive) {
                                this.frozenSpectrum = null;
                            }
                        }
                    };
                }
                
                static get parameterDescriptors() {
                    return [{
                        name: 'freeze',
                        defaultValue: 0,
                        minValue: 0,
                        maxValue: 1,
                        automationRate: 'k-rate'
                    }];
                }
                
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    const output = outputs[0];
                    const freeze = parameters.freeze[0];
                    
                    if (freeze > 0.5 && !this.frozenSpectrum && input[0]) {
                        this.frozenSpectrum = new Float32Array(input[0].length);
                        for (let i = 0; i < input[0].length; i++) {
                            this.frozenSpectrum[i] = input[0][i];
                        }
                    } else if (freeze <= 0.5) {
                        this.frozenSpectrum = null;
                    }
                    
                    for (let channel = 0; channel < input.length; channel++) {
                        const inputChannel = input[channel];
                        const outputChannel = output[channel];
                        
                        if (this.frozenSpectrum && freeze > 0.5) {
                            for (let i = 0; i < outputChannel.length; i++) {
                                const phase = Math.random() * 2 * Math.PI;
                                outputChannel[i] = this.frozenSpectrum[i % this.frozenSpectrum.length] * 
                                                  Math.cos(phase) * 0.8;
                            }
                        } else {
                            for (let i = 0; i < outputChannel.length; i++) {
                                outputChannel[i] = inputChannel ? inputChannel[i] : 0;
                            }
                        }
                    }
                    
                    return true;
                }
            }
            
            registerProcessor('spectral-freeze-processor', SpectralFreezeProcessor);
        `;
        
        const bitcrusherBlob = new Blob([bitcrusherProcessor], { type: 'application/javascript' });
        const bitcrusherUrl = URL.createObjectURL(bitcrusherBlob);
        await this.audioContext.audioWorklet.addModule(bitcrusherUrl);
        
        const freezeBlob = new Blob([spectralFreezeProcessor], { type: 'application/javascript' });
        const freezeUrl = URL.createObjectURL(freezeBlob);
        await this.audioContext.audioWorklet.addModule(freezeUrl);
    }
    
    setupAudioGraph() {
        // Create main input/output nodes
        this.inputGain = this.audioContext.createGain();
        this.outputGain = this.audioContext.createGain();
        
        // Create effects
        this.effects = new Effects(this.audioContext);
        
        // Create a simple serial effects chain
        this.setupSerialEffectsChain();
        
        this.outputGain.connect(this.audioContext.destination);
    }
    
    setupSerialEffectsChain() {
        // Create bypass and effect paths for each effect
        this.effectNodes = [];
        
        let previousNode = this.inputGain;
        
        this.effectNames.forEach((name, i) => {
            const bypass = this.audioContext.createGain();
            const effectInput = this.audioContext.createGain();
            const mixer = this.audioContext.createGain();
            
            // Split signal to bypass and effect
            previousNode.connect(bypass);
            previousNode.connect(effectInput);
            
            // Connect effect
            const effectOutput = this.audioContext.createGain();
            
            switch (name) {
                case 'mid_side':
                    effectInput.connect(this.effects.midSideIn);
                    this.effects.midSideOut.connect(effectOutput);
                    break;
                    
                case 'bitcrush':
                    effectInput.connect(this.effects.bitcrusher);
                    this.effects.bitcrusher.connect(effectOutput);
                    break;
                    
                case 'lowpass':
                    effectInput.connect(this.effects.lowpass);
                    this.effects.lowpass.connect(effectOutput);
                    break;
                    
                case 'highpass':
                    effectInput.connect(this.effects.highpass);
                    this.effects.highpass.connect(effectOutput);
                    break;
                    
                case 'delay':
                    effectInput.connect(this.effects.delay);
                    effectInput.connect(this.effects.delayDry);
                    this.effects.delayMix.connect(effectOutput);
                    this.effects.delayDry.connect(effectOutput);
                    break;
                    
                case 'reverb':
                    effectInput.connect(this.effects.convolver);
                    effectInput.connect(this.effects.reverbDry);
                    this.effects.convolver.connect(this.effects.reverbMix);
                    this.effects.reverbMix.connect(effectOutput);
                    this.effects.reverbDry.connect(effectOutput);
                    break;
                    
                case 'spectral_freeze':
                    effectInput.connect(this.effects.spectralFreeze);
                    this.effects.spectralFreeze.connect(effectOutput);
                    break;
                    
                case 'pitch_shift':
                    effectInput.connect(effectOutput); // Pass through, handled by playback rate
                    break;
            }
            
            // Mix bypass and effect
            bypass.connect(mixer);
            effectOutput.connect(mixer);
            
            // Store node info
            this.effectNodes.push({
                name,
                bypass,
                effectInput,
                effectOutput,
                mixer,
                isActive: false
            });
            
            // Set initial state (all bypassed)
            bypass.gain.value = 1;
            effectInput.gain.value = 0;
            
            // Chain to next effect
            previousNode = mixer;
        });
        
        // Connect final node to output
        previousNode.connect(this.outputGain);
    }
    
    switchToEffect(index) {
        // Disable all effects
        this.effectNodes.forEach((node, i) => {
            if (i === index) {
                // Enable this effect
                node.bypass.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
                node.effectInput.gain.setTargetAtTime(1, this.audioContext.currentTime, 0.01);
                node.isActive = true;
            } else {
                // Bypass this effect
                node.bypass.gain.setTargetAtTime(1, this.audioContext.currentTime, 0.01);
                node.effectInput.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
                node.isActive = false;
            }
        });
        
        this.currentEffectIndex = index;
    }
    
    updateEffectParameter(value) {
        // Don't update if not initialized
        if (!this.effects) {
            return;
        }
        
        this.rawParam = value;
        
        // Smooth the parameter
        this.smoothedParam = this.paramSmoothFactor * this.smoothedParam + 
                            (1 - this.paramSmoothFactor) * value;
        this.currentParam = this.smoothedParam;
        
        // Update the effect
        const effectName = this.effectNames[this.currentEffectIndex];
        this.effects.updateParameter(effectName, this.currentParam);
        
        // Special handling for pitch shift - EXTREME VERSION
        if (effectName === 'pitch_shift' && this.source && this.source.playbackRate) {
            // INSANE pitch range: -3 octaves to +3 octaves
            // Non-linear curve for more fun in the middle
            const normalized = (this.currentParam - 0.5) * 2; // -1 to 1
            const semitones = normalized * Math.abs(normalized) * 36; // -36 to +36 with curve
            this.source.playbackRate.value = Math.pow(2, semitones / 12);
            
            // Also detune for microtonal madness at certain positions
            if (this.source.detune) {
                this.source.detune.value = Math.sin(this.currentParam * Math.PI * 4) * 50;
            }
        }
    }
    
    async loadArrayBuffer(arrayBuffer) {
        await this.init();
        
        try {
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.audioBuffer = audioBuffer;
            return true;
        } catch (err) {
            console.error('Error decoding audio:', err);
            return false;
        }
    }
    
    async loadFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        return this.loadArrayBuffer(arrayBuffer);
    }
    
    async loadDemoAudio() {
        await this.init();
        
        // Create a rich demo audio
        const sampleRate = this.audioContext.sampleRate;
        const duration = 30;
        const buffer = this.audioContext.createBuffer(2, sampleRate * duration, sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = buffer.getChannelData(channel);
            
            for (let i = 0; i < channelData.length; i++) {
                const t = i / sampleRate;
                
                // Bass line
                const bassFreq = 110 * Math.pow(2, Math.floor(t * 2) % 4 / 12);
                const bass = Math.sin(2 * Math.PI * bassFreq * t) * 0.3;
                
                // Melody
                const melodyPattern = [0, 3, 5, 7, 8, 7, 5, 3];
                const melodyNote = melodyPattern[Math.floor(t * 4) % 8];
                const melodyFreq = 440 * Math.pow(2, melodyNote / 12);
                const melody = Math.sin(2 * Math.PI * melodyFreq * t) * 0.2;
                
                // Drums
                const kick = (t % 0.5 < 0.05) ? Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t % 0.5 * 20) : 0;
                const hihat = (t % 0.125 < 0.02) ? (Math.random() * 2 - 1) * 0.1 * Math.exp(-t % 0.125 * 50) : 0;
                
                // Mix with stereo separation
                const pan = channel === 0 ? 0.7 : 1.3;
                channelData[i] = (bass + melody * pan + kick + hihat) * 0.5;
            }
        }
        
        this.audioBuffer = buffer;
    }
    
    async loadPresetIR(preset) {
        if (preset === 'none') {
            this.effects.createDefaultIR();
            return;
        }
        
        // Create synthetic IRs for different spaces
        const lengths = { room: 1, hall: 2, plate: 3 };
        const length = this.audioContext.sampleRate * lengths[preset];
        const ir = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const channelData = ir.getChannelData(channel);
            
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 2);
                
                switch (preset) {
                    case 'room':
                        channelData[i] = (Math.random() * 2 - 1) * decay;
                        break;
                    case 'hall':
                        channelData[i] = (Math.random() * 2 - 1) * decay * 
                                         (1 + 0.5 * Math.sin(i / this.audioContext.sampleRate * 100));
                        break;
                    case 'plate':
                        channelData[i] = (Math.random() * 2 - 1) * decay * 
                                         Math.sin(i / this.audioContext.sampleRate * 2000);
                        break;
                }
            }
        }
        
        this.effects.setImpulseResponse(ir);
    }
    
    async loadIRFile(file) {
        await this.init();
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const irBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.effects.setImpulseResponse(irBuffer);
            return true;
        } catch (err) {
            console.error('Error loading IR:', err);
            return false;
        }
    }
    
    async startMicrophone() {
        try {
            await this.init();
            
            this.microphoneStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                } 
            });
            
            this.microphoneSource = this.audioContext.createMediaStreamSource(this.microphoneStream);
            this.microphoneSource.connect(this.inputGain);
            
            this.isMicrophoneActive = true;
            return true;
        } catch (err) {
            console.error('Error starting microphone:', err);
            throw err;
        }
    }
    
    stopMicrophone() {
        if (this.microphoneSource) {
            this.microphoneSource.disconnect();
            this.microphoneSource = null;
        }
        
        if (this.microphoneStream) {
            this.microphoneStream.getTracks().forEach(track => track.stop());
            this.microphoneStream = null;
        }
        
        this.isMicrophoneActive = false;
    }
    
    play() {
        if (!this.audioBuffer) return;
        
        this.source = this.audioContext.createBufferSource();
        this.source.buffer = this.audioBuffer;
        this.source.loop = true;
        this.source.connect(this.inputGain);
        this.source.start();
        
        this.isPlaying = true;
    }
    
    stop() {
        if (this.source) {
            this.source.stop();
            this.source.disconnect();
            this.source = null;
        }
        
        this.isPlaying = false;
    }
}