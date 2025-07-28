// js/worklets/bitcrusher.js

class BitcrusherProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.phase = 0;
        this.lastSample = [0, 0];
    }
    
    static get parameterDescriptors() {
        return [{
            name: 'bitDepth',
            defaultValue: 8,
            minValue: 1,
            maxValue: 16,
            automationRate: 'k-rate'
        }, {
            name: 'sampleRateReduction',
            defaultValue: 1,
            minValue: 1,
            maxValue: 50,
            automationRate: 'k-rate'
        }];
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        
        if (!input || !input[0]) {
            return true;
        }
        
        const bitDepth = parameters.bitDepth[0] || parameters.bitDepth;
        const sampleRateReduction = parameters.sampleRateReduction?.[0] || 1;
        const step = 2 / Math.pow(2, bitDepth);
        
        for (let channel = 0; channel < input.length; channel++) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];
            
            for (let i = 0; i < inputChannel.length; i++) {
                // Sample rate reduction
                this.phase++;
                if (this.phase >= sampleRateReduction) {
                    this.phase = 0;
                    // Quantize the sample
                    const sample = inputChannel[i];
                    this.lastSample[channel] = Math.round(sample / step) * step;
                    
                    // Add some aliasing artifacts for extra grit
                    if (bitDepth < 4) {
                        this.lastSample[channel] *= (1 + Math.random() * 0.1 - 0.05);
                    }
                }
                
                outputChannel[i] = this.lastSample[channel];
            }
        }
        
        return true;
    }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);