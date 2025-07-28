// js/worklets/spectral-freeze.js

class SpectralFreezeProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.frozenBuffer = null;
        this.bufferIndex = 0;
        this.fadeIn = 0;
        this.fadeOut = 0;
        this.isTransitioning = false;
        
        // Buffer size for spectral capture
        this.bufferSize = 2048;
        this.captureBuffer = new Float32Array(this.bufferSize);
        this.captureIndex = 0;
        
        // Crossfade duration in samples
        this.fadeLength = 128;
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
        
        if (!input || !input[0]) {
            return true;
        }
        
        const freeze = parameters.freeze[0] || parameters.freeze;
        const shouldFreeze = freeze > 0.5;
        
        for (let channel = 0; channel < output.length; channel++) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];
            
            for (let i = 0; i < outputChannel.length; i++) {
                const inputSample = inputChannel ? inputChannel[i] : 0;
                
                // Capture input into buffer
                if (!shouldFreeze) {
                    this.captureBuffer[this.captureIndex] = inputSample;
                    this.captureIndex = (this.captureIndex + 1) % this.bufferSize;
                }
                
                // Handle freeze state
                if (shouldFreeze && !this.frozenBuffer) {
                    // Start freezing - copy capture buffer
                    this.frozenBuffer = new Float32Array(this.captureBuffer);
                    this.bufferIndex = 0;
                    this.isTransitioning = true;
                    this.fadeIn = 0;
                } else if (!shouldFreeze && this.frozenBuffer) {
                    // Stop freezing
                    this.isTransitioning = true;
                    this.fadeOut = 0;
                }
                
                // Generate output
                if (this.frozenBuffer && shouldFreeze) {
                    // Output frozen spectrum with slight variation
                    const frozenSample = this.frozenBuffer[this.bufferIndex];
                    const variation = 1 + (Math.random() - 0.5) * 0.02; // ±1% variation
                    let outputSample = frozenSample * variation;
                    
                    // Apply fade in
                    if (this.isTransitioning && this.fadeIn < this.fadeLength) {
                        const fadeGain = this.fadeIn / this.fadeLength;
                        outputSample = inputSample * (1 - fadeGain) + outputSample * fadeGain;
                        this.fadeIn++;
                        if (this.fadeIn >= this.fadeLength) {
                            this.isTransitioning = false;
                        }
                    }
                    
                    outputChannel[i] = outputSample;
                    this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;
                } else if (this.frozenBuffer && !shouldFreeze) {
                    // Fade out frozen buffer
                    const frozenSample = this.frozenBuffer[this.bufferIndex];
                    const fadeGain = 1 - (this.fadeOut / this.fadeLength);
                    
                    outputChannel[i] = inputSample * (1 - fadeGain) + frozenSample * fadeGain;
                    
                    this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;
                    this.fadeOut++;
                    
                    if (this.fadeOut >= this.fadeLength) {
                        this.frozenBuffer = null;
                        this.isTransitioning = false;
                    }
                } else {
                    // Pass through
                    outputChannel[i] = inputSample;
                }
            }
        }
        
        return true;
    }
}

registerProcessor('spectral-freeze-processor', SpectralFreezeProcessor);