// js/app.js
import { AudioEngine } from './audio-engine.js';
import { GestureDetector } from './gesture-detector.js';

class GestureDSPApp {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.gestureDetector = new GestureDetector();
        
        this.effectHistory = [];
        this.lastCueTime = 0;
        this.cueActive = false;
        
        this.setupUI();
        this.setupEffectZones();
        this.setupGestureCallbacks();
    }
    
    async loadAudioFileList() {
        try {
            // First try the API endpoint if available
            const response = await fetch('audio/list.php');
            if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
                const files = await response.json();
                console.log('Audio files from API:', files);
                this.populateAudioSelect(files);
                return;
            }
        } catch (err) {
            console.log('API endpoint error:', err);
        }
        
        try {
            // Fallback to parsing directory listing
            const response = await fetch('audio/');
            const text = await response.text();
            console.log('Directory listing response:', text.substring(0, 200));
            
            // Parse the directory listing
            const files = this.parseDirectoryListing(text);
            console.log('Parsed audio files:', files);
            
            if (files.length > 0) {
                this.populateAudioSelect(files);
            } else {
                console.log('No audio files found, using defaults');
                this.addDefaultAudioFiles();
            }
        } catch (err) {
            console.error('Could not load audio file list:', err);
            this.addDefaultAudioFiles();
        }
    }
    
    populateAudioSelect(files) {
        const select = document.getElementById('audioSelect');
        files.forEach(filename => {
            if (filename.toLowerCase().endsWith('.wav')) {
                const option = document.createElement('option');
                option.value = filename;
                option.textContent = this.formatFilename(filename);
                select.appendChild(option);
            }
        });
    }
    
    formatFilename(filename) {
        // Remove .wav extension and prettify
        return filename
            .replace(/\.wav$/i, '')
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }
    
    parseDirectoryListing(html) {
        const files = [];
        
        // Try to parse Apache/Nginx directory listing
        const linkRegex = /<a\s+href="([^"]+\.wav)"[^>]*>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            const filename = match[1];
            if (!filename.startsWith('/') && !filename.startsWith('..')) {
                files.push(filename);
            }
        }
        
        // If no files found, try a different pattern (JSON response)
        if (files.length === 0) {
            try {
                const json = JSON.parse(html);
                if (Array.isArray(json)) {
                    return json.filter(f => f.endsWith('.wav'));
                }
            } catch (e) {
                // Not JSON, ignore
            }
        }
        
        return files.sort();
    }
    
    addDefaultAudioFiles() {
        // Fallback list of common demo files
        const defaultFiles = [
            'drums.wav',
            'synth.wav',
            'vocals.wav',
            'guitar.wav',
            'piano.wav'
        ];
        
        const select = document.getElementById('audioSelect');
        defaultFiles.forEach(filename => {
            const option = document.createElement('option');
            option.value = filename;
            option.textContent = filename.replace(/\.wav$/i, '');
            select.appendChild(option);
        });
    }
    
    async loadAudioFromServer(filename) {
        try {
            this.updateStatus(`Loading ${filename}...`);
            const response = await fetch(`audio/${filename}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            await this.audioEngine.loadArrayBuffer(arrayBuffer);
            this.updateStatus(`Loaded: ${filename}`);
        } catch (err) {
            console.error('Error loading audio file:', err);
            this.updateStatus(`Failed to load ${filename}`);
        }
    }
    
    async setupUI() {
        // Load available audio files
        await this.loadAudioFileList();
        
        // Camera control
        document.getElementById('startCamera').addEventListener('click', () => this.startCamera());
        
        // Microphone control
        document.getElementById('microphoneToggle').addEventListener('click', () => this.toggleMicrophone());
        
        // Audio selection
        document.getElementById('audioSelect').addEventListener('change', async (e) => {
            const value = e.target.value;
            if (!value) return;
            
            if (value === '__demo__') {
                await this.audioEngine.loadDemoAudio();
                this.updateStatus('Demo audio loaded');
            } else {
                await this.loadAudioFromServer(value);
            }
            document.getElementById('playPause').disabled = false;
        });
        
        // Audio upload
        document.getElementById('loadFile').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        
        document.getElementById('fileInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.audioEngine.loadFile(file);
                this.updateStatus(`Loaded: ${file.name}`);
                document.getElementById('playPause').disabled = false;
                
                // Reset select to show custom file loaded
                document.getElementById('audioSelect').value = '';
            }
        });
        
        document.getElementById('playPause').addEventListener('click', () => {
            this.togglePlayback();
        });
        
        // IR controls
        document.getElementById('irSelect').addEventListener('change', (e) => {
            this.audioEngine.loadPresetIR(e.target.value);
            this.updateStatus(`Loaded ${e.target.value} IR`);
        });
        
        document.getElementById('loadIR').addEventListener('click', () => {
            document.getElementById('irInput').click();
        });
        
        document.getElementById('irInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.audioEngine.loadIRFile(file);
                this.updateStatus(`Loaded IR: ${file.name}`);
            }
        });
    }
    
    setupEffectZones() {
        const zonesContainer = document.getElementById('effectZones');
        zonesContainer.innerHTML = '';
        
        this.audioEngine.effectNames.forEach((name, index) => {
            const zone = document.createElement('div');
            zone.className = 'zone';
            zone.textContent = name.replace('_', ' ');
            zone.id = `zone-${index}`;
            zonesContainer.appendChild(zone);
        });
    }
    
    setupGestureCallbacks() {
        this.gestureDetector.onHandsDetected = (yellowHand, greenHand) => {
            // Yellow hand for horizontal effect selection
            if (yellowHand) {
                this.handleEffectSelection(yellowHand);
            }
            
            // Green hand for vertical parameter control
            if (greenHand) {
                this.handleParameterControl(greenHand);
            } else {
                // Slowly return to center when no hand detected
                if (this.audioEngine.audioContext && this.audioEngine.effects) {
                    const currentParam = this.audioEngine.currentParam;
                    this.audioEngine.updateEffectParameter(currentParam * 0.95 + 0.5 * 0.05);
                }
                this.updateParameterDisplay();
            }
            
            // Update hand status with confidence
            const status = [];
            if (yellowHand) status.push(`Yellow: ${Math.round(yellowHand.confidence * 100)}%`);
            if (greenHand) status.push(`Green: ${Math.round(greenHand.confidence * 100)}%`);
            document.getElementById('handStatus').textContent = status.length > 0 ? status.join(', ') : 'No';
        };
    }
    
    handleEffectSelection(handBox) {
        const centerX = handBox.x + handBox.width / 2;
        const canvasWidth = this.gestureDetector.canvas.width;
        const zoneWidth = canvasWidth / this.audioEngine.effectNames.length;
        const effectIndex = Math.floor(centerX / zoneWidth);
        const clampedIndex = Math.max(0, Math.min(effectIndex, this.audioEngine.effectNames.length - 1));
        
        // Update effect history for cue detection
        this.effectHistory.push(clampedIndex);
        if (this.effectHistory.length > 10) {
            this.effectHistory.shift();
        }
        
        // Check for cue trigger
        if (this.effectHistory.length === 10 && 
            this.effectHistory.every(i => i === clampedIndex) &&
            Date.now() - this.lastCueTime > 2000) {
            this.triggerCue();
            this.lastCueTime = Date.now();
        }
        
        // Switch effect
        this.audioEngine.switchToEffect(clampedIndex);
        
        // Update UI
        document.querySelectorAll('.zone').forEach((zone, i) => {
            zone.classList.toggle('active', i === clampedIndex);
        });
        
        document.getElementById('currentEffect').textContent = 
            this.audioEngine.effectNames[clampedIndex].replace('_', ' ');
    }
    
    handleParameterControl(handBox) {
        const centerY = handBox.y + handBox.height / 2;
        const canvasHeight = this.gestureDetector.canvas.height;
        const paramMinRatio = 0.2;
        const paramMaxRatio = 0.8;
        const minY = paramMinRatio * canvasHeight;
        const maxY = paramMaxRatio * canvasHeight;
        
        let param;
        if (centerY <= minY) {
            param = 1.0;
        } else if (centerY >= maxY) {
            param = 0.0;
        } else {
            param = 1.0 - (centerY - minY) / (maxY - minY);
        }
        
        // Only update if audio engine is initialized
        if (this.audioEngine.audioContext) {
            this.audioEngine.updateEffectParameter(param);
        }
        this.updateParameterDisplay();
    }
    
    updateParameterDisplay() {
        // Safely get parameters with defaults
        const param = this.audioEngine.currentParam || 0.5;
        const rawParam = this.audioEngine.rawParam || 0.5;
        
        document.getElementById('paramValue').textContent = param.toFixed(2);
        document.getElementById('rawParamValue').textContent = rawParam.toFixed(2);
        document.getElementById('paramFill').style.height = `${param * 100}%`;
    }
    
    triggerCue() {
        this.cueActive = true;
        const indicator = document.getElementById('cueIndicator');
        indicator.classList.add('active');
        
        setTimeout(() => {
            indicator.classList.remove('active');
            this.cueActive = false;
        }, 1000);
    }
    
    async startCamera() {
        try {
            // Initialize audio engine first if not already done
            await this.audioEngine.init();
            
            await this.gestureDetector.start();
            this.updateStatus('Camera active - wear colored gloves!');
            document.getElementById('startCamera').disabled = true;
            document.getElementById('microphoneToggle').disabled = false;
        } catch (err) {
            console.error('Error starting camera:', err);
            this.updateStatus('Camera access denied');
        }
    }
    
    async toggleMicrophone() {
        const micBtn = document.getElementById('microphoneToggle');
        
        try {
            if (this.audioEngine.isMicrophoneActive) {
                this.audioEngine.stopMicrophone();
                micBtn.textContent = 'Start Microphone';
                micBtn.className = 'btn btn-warning';
                this.updateStatus('Microphone stopped');
            } else {
                await this.audioEngine.startMicrophone();
                micBtn.textContent = 'Stop Microphone';
                micBtn.className = 'btn btn-danger';
                this.updateStatus('Live microphone active! Use gestures to control effects.');
            }
        } catch (err) {
            console.error('Microphone error:', err);
            if (err.name === 'NotAllowedError') {
                this.updateStatus('Microphone permission denied. Please allow microphone access.');
            } else if (err.name === 'NotFoundError') {
                this.updateStatus('No microphone found. Please connect a microphone.');
            } else {
                this.updateStatus('Microphone error: ' + err.message);
            }
        }
    }
    
    togglePlayback() {
        if (this.audioEngine.isPlaying) {
            this.audioEngine.stop();
            document.getElementById('playPause').textContent = 'Play';
        } else {
            this.audioEngine.play();
            document.getElementById('playPause').textContent = 'Stop';
        }
    }
    
    updateStatus(message) {
        document.getElementById('status').textContent = message;
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new GestureDSPApp();
});