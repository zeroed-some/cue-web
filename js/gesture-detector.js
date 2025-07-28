// js/gesture-detector.js

export class GestureDetector {
    constructor() {
        this.video = null;
        this.canvas = document.getElementById('videoCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.animationId = null;
        
        // Callback for detected hands
        this.onHandsDetected = null;
        
        // Detection parameters
        this.minHandSize = 5;   // Very small
        this.maxHandY = 1.0;    // No vertical restriction
    }
    
    async start() {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: 640, 
                height: 480,
                facingMode: 'user'
            } 
        });
        
        if (!this.video) {
            this.video = document.createElement('video');
            this.video.width = 640;
            this.video.height = 480;
            this.video.autoplay = true;
            this.video.playsInline = true;
        }
        
        this.video.srcObject = stream;
        
        // Wait for video to be ready
        await new Promise((resolve) => {
            this.video.onloadedmetadata = resolve;
        });
        
        this.startProcessing();
    }
    
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        if (this.video && this.video.srcObject) {
            const tracks = this.video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            this.video.srcObject = null;
        }
    }
    
    startProcessing() {
        const process = () => {
            if (this.video && this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
                // Draw video frame
                this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
                
                // Get image data and detect hands
                const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                const detection = this.detectHands(imageData);
                
                // Draw detection boxes
                if (detection.redHand) {
                    this.drawBox(detection.redHand, '#000000');  // Black outline for white objects
                }
                
                if (detection.yellowHand) {
                    this.drawBox(detection.yellowHand, '#40e0d0');  // Turquoise for teal
                }
                
                // Call callback if registered
                if (this.onHandsDetected) {
                    this.onHandsDetected(detection.redHand, detection.yellowHand);
                }
            }
            
            this.animationId = requestAnimationFrame(process);
        };
        
        process();
    }
    
    drawBox(box, color) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(box.x, box.y, box.width, box.height);
        
        // Draw center point
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
        this.ctx.fill();
    }
    
    detectHands(imageData) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        
        // Pixel arrays for each color
        const whitePixels = [];
        const tealPixels = [];
        
        // Sample center pixel for debugging
        const centerX = Math.floor(width / 2);
        const centerY = Math.floor(height / 2);
        const centerI = (centerY * width + centerX) * 4;
        const centerR = data[centerI];
        const centerG = data[centerI + 1];
        const centerB = data[centerI + 2];
        
        // Process every 2nd pixel for better performance
        for (let y = 0; y < height; y += 2) {
            for (let x = 0; x < width; x += 2) {
                const i = (y * width + x) * 4;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                
                // Convert to HSV for better color discrimination
                const hsv = this.rgbToHsv(r/255, g/255, b/255);
                
                // BRIGHT WHITE detection
                // White should have very low saturation and high brightness
                const isWhite = hsv.s < 0.15 && // Very low saturation (near grayscale)
                               hsv.v > 0.75 && // High brightness
                               r > 190 && g > 190 && b > 190 && // All channels high
                               Math.abs(r - g) < 20 && // Channels close together
                               Math.abs(g - b) < 20 && // Neutral color
                               Math.abs(r - b) < 20;   // No color cast
                
                // Alternative: Very bright neutral colors
                const isBrightNeutral = (r + g + b) > 650 && // Total brightness
                                       Math.max(r, g, b) - Math.min(r, g, b) < 25; // Low variance
                
                if (isWhite || isBrightNeutral) {
                    whitePixels.push({ x, y });
                }
                
                // TEAL detection (keeping exactly as is - it works!)
                const isTeal = (hsv.h > 0.45 && hsv.h < 0.55) && // Cyan range
                              hsv.s > 0.3 && // Some saturation
                              hsv.v > 0.3 && // Not too dark
                              (g > r * 1.2 || b > r * 1.2); // Green or blue dominant
                
                if (isTeal) {
                    tealPixels.push({ x, y });
                }
            }
        }
        
        // Debug: Draw center crosshair and color info
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(centerX - 10, centerY - 10, 20, 20);
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(centerX - 9, centerY - 9, 18, 18);
        
        // Show color at center with better contrast
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(10, 10, 200, 30);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px monospace';
        this.ctx.fillText(`Center RGB: ${centerR},${centerG},${centerB}`, 15, 30);
        
        // Find bounding boxes
        const whiteHand = this.getBoundingBox(whitePixels, height);
        const tealHand = this.getBoundingBox(tealPixels, height);
        
        // Debug logging
        if (whitePixels.length > 50 || tealPixels.length > 50) {
            console.log('White pixels:', whitePixels.length, 'Teal pixels:', tealPixels.length);
        }
        
        return { 
            redHand: whiteHand,
            yellowHand: tealHand 
        };
    }
    
    rgbToHsv(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;
        
        const v = max;
        const s = max === 0 ? 0 : diff / max;
        
        let h = 0;
        if (diff !== 0) {
            if (max === r) {
                h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
            } else if (max === g) {
                h = ((b - r) / diff + 2) / 6;
            } else {
                h = ((r - g) / diff + 4) / 6;
            }
        }
        
        return { h, s, v };
    }
    
    getBoundingBox(pixels, frameHeight) {
        // Higher threshold to avoid noise
        if (pixels.length < 100) return null;
        
        const xs = pixels.map(p => p.x);
        const ys = pixels.map(p => p.y);
        
        const box = {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys)
        };
        
        // Reasonable size requirements
        if (box.width < 20 || box.height < 20) {
            return null;
        }
        
        // Reject if too large (probably background)
        if (box.width > frameHeight * 0.5 || box.height > frameHeight * 0.5) {
            return null;
        }
        
        return box;
    }
}