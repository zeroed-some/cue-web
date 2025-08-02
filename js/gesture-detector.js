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
        this.minHandSize = 30;  // Minimum hand size in pixels
        this.maxHandSize = 150; // Maximum hand size (hand-sized)
        this.idealHandRatio = 1.2; // Expected width/height ratio
        
        // Tracking state
        this.yellowHistory = [];
        this.greenHistory = [];
        this.maxHistory = 5;
        
        // Adaptive thresholds
        this.yellowThreshold = { h: [0.12, 0.20], s: 0.3, v: 0.4 };
        this.greenThreshold = { h: [0.25, 0.40], s: 0.3, v: 0.3 };
        
        // Smoothing
        this.lastYellow = null;
        this.lastGreen = null;
        this.smoothingFactor = 0.3;
        
        // Motion detection
        this.previousFrame = null;
        this.motionThreshold = 10;
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
                const detection = this.detectHandsSmart(imageData);
                
                // Draw detection boxes
                if (detection.yellowHand) {
                    this.drawBox(detection.yellowHand, '#ffff00', 'Effect Select');
                }
                
                if (detection.greenHand) {
                    this.drawBox(detection.greenHand, '#00ff00', 'Parameter');
                }
                
                // Call callback if registered
                if (this.onHandsDetected) {
                    this.onHandsDetected(detection.yellowHand, detection.greenHand);
                }
            }
            
            this.animationId = requestAnimationFrame(process);
        };
        
        process();
    }
    
    detectHandsSmart(imageData) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        
        // Detect motion areas first (if we have a previous frame)
        const motionMask = this.previousFrame ? 
            this.detectMotion(data, this.previousFrame, width, height) : null;
        
        // Store current frame for next iteration
        this.previousFrame = new Uint8ClampedArray(data);
        
        // Color detection with motion priority
        const yellowCandidates = [];
        const greenCandidates = [];
        
        // Adaptive sampling - more samples in motion areas
        for (let y = 0; y < height; y += 2) {
            for (let x = 0; x < width; x += 2) {
                const i = (y * width + x) * 4;
                
                // Skip if no motion in this area (when motion mask exists)
                if (motionMask && !motionMask[y * width + x]) {
                    continue;
                }
                
                const r = data[i] / 255;
                const g = data[i + 1] / 255;
                const b = data[i + 2] / 255;
                
                const hsv = this.rgbToHsv(r, g, b);
                
                // YELLOW detection (bright, saturated yellow)
                if (hsv.h >= this.yellowThreshold.h[0] && 
                    hsv.h <= this.yellowThreshold.h[1] &&
                    hsv.s > this.yellowThreshold.s && 
                    hsv.v > this.yellowThreshold.v &&
                    r > 0.6 && g > 0.6 && b < 0.4) {
                    yellowCandidates.push({ x, y, confidence: hsv.s * hsv.v });
                }
                
                // GREEN detection (bright, saturated green)
                if (hsv.h >= this.greenThreshold.h[0] && 
                    hsv.h <= this.greenThreshold.h[1] &&
                    hsv.s > this.greenThreshold.s && 
                    hsv.v > this.greenThreshold.v &&
                    g > r * 1.3 && g > b * 1.2) {
                    greenCandidates.push({ x, y, confidence: hsv.s * hsv.v });
                }
            }
        }
        
        // Cluster and filter candidates
        const yellowClusters = this.clusterPoints(yellowCandidates);
        const greenClusters = this.clusterPoints(greenCandidates);
        
        // Find best hand-sized clusters
        const yellowHand = this.findBestHandCluster(yellowClusters, 'yellow');
        const greenHand = this.findBestHandCluster(greenClusters, 'green');
        
        // Apply temporal smoothing
        const smoothedYellow = this.smoothDetection(yellowHand, this.lastYellow);
        const smoothedGreen = this.smoothDetection(greenHand, this.lastGreen);
        
        this.lastYellow = smoothedYellow;
        this.lastGreen = smoothedGreen;
        
        return { 
            yellowHand: smoothedYellow,
            greenHand: smoothedGreen
        };
    }
    
    detectMotion(currentData, previousData, width, height) {
        const motionMask = new Uint8Array(width * height);
        
        for (let y = 0; y < height; y += 4) {
            for (let x = 0; x < width; x += 4) {
                const i = (y * width + x) * 4;
                
                const diffR = Math.abs(currentData[i] - previousData[i]);
                const diffG = Math.abs(currentData[i + 1] - previousData[i + 1]);
                const diffB = Math.abs(currentData[i + 2] - previousData[i + 2]);
                
                const totalDiff = diffR + diffG + diffB;
                
                if (totalDiff > this.motionThreshold) {
                    // Mark 4x4 area as motion
                    for (let dy = 0; dy < 4; dy++) {
                        for (let dx = 0; dx < 4; dx++) {
                            if (y + dy < height && x + dx < width) {
                                motionMask[(y + dy) * width + (x + dx)] = 1;
                            }
                        }
                    }
                }
            }
        }
        
        return motionMask;
    }
    
    clusterPoints(points) {
        if (points.length < 20) return [];
        
        const clusters = [];
        const visited = new Set();
        
        // DBSCAN-like clustering
        const epsilon = 30; // Maximum distance between points in a cluster
        const minPoints = 20; // Minimum points to form a cluster
        
        for (let i = 0; i < points.length; i++) {
            if (visited.has(i)) continue;
            
            const neighbors = [];
            const cluster = [];
            
            // Find all neighbors
            for (let j = 0; j < points.length; j++) {
                const dist = Math.sqrt(
                    Math.pow(points[i].x - points[j].x, 2) + 
                    Math.pow(points[i].y - points[j].y, 2)
                );
                
                if (dist < epsilon) {
                    neighbors.push(j);
                }
            }
            
            if (neighbors.length >= minPoints) {
                // Start a new cluster
                for (const idx of neighbors) {
                    if (!visited.has(idx)) {
                        visited.add(idx);
                        cluster.push(points[idx]);
                    }
                }
                
                if (cluster.length > 0) {
                    clusters.push(cluster);
                }
            }
        }
        
        return clusters;
    }
    
    findBestHandCluster(clusters, color) {
        if (clusters.length === 0) return null;
        
        let bestCluster = null;
        let bestScore = -1;
        
        for (const cluster of clusters) {
            // Calculate bounding box
            const xs = cluster.map(p => p.x);
            const ys = cluster.map(p => p.y);
            
            const box = {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys)
            };
            
            // Skip if too small or too large
            if (box.width < this.minHandSize || box.height < this.minHandSize ||
                box.width > this.maxHandSize || box.height > this.maxHandSize) {
                continue;
            }
            
            // Calculate quality score
            const sizeScore = 1 - Math.abs(box.width * box.height - 5000) / 10000; // Ideal area ~5000px
            const ratioScore = 1 - Math.abs(box.width / box.height - this.idealHandRatio) / 2;
            const densityScore = cluster.length / (box.width * box.height) * 100;
            const confidenceScore = cluster.reduce((sum, p) => sum + p.confidence, 0) / cluster.length;
            
            const totalScore = sizeScore * 0.3 + ratioScore * 0.2 + densityScore * 0.2 + confidenceScore * 0.3;
            
            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestCluster = box;
                bestCluster.confidence = confidenceScore;
                bestCluster.color = color;
            }
        }
        
        // Update history for this color
        if (bestCluster) {
            const history = color === 'yellow' ? this.yellowHistory : this.greenHistory;
            history.push(bestCluster);
            if (history.length > this.maxHistory) {
                history.shift();
            }
        }
        
        return bestCluster;
    }
    
    smoothDetection(current, previous) {
        if (!current) return null;
        if (!previous) return current;
        
        // Smooth position and size
        return {
            x: previous.x + (current.x - previous.x) * this.smoothingFactor,
            y: previous.y + (current.y - previous.y) * this.smoothingFactor,
            width: previous.width + (current.width - previous.width) * this.smoothingFactor,
            height: previous.height + (current.height - previous.height) * this.smoothingFactor,
            confidence: current.confidence,
            color: current.color
        };
    }
    
    drawBox(box, color, label) {
        // Draw bounding box
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(box.x, box.y, box.width, box.height);
        
        // Draw corners for style
        const cornerLength = 15;
        this.ctx.lineWidth = 4;
        
        // Top-left
        this.ctx.beginPath();
        this.ctx.moveTo(box.x, box.y + cornerLength);
        this.ctx.lineTo(box.x, box.y);
        this.ctx.lineTo(box.x + cornerLength, box.y);
        this.ctx.stroke();
        
        // Top-right
        this.ctx.beginPath();
        this.ctx.moveTo(box.x + box.width - cornerLength, box.y);
        this.ctx.lineTo(box.x + box.width, box.y);
        this.ctx.lineTo(box.x + box.width, box.y + cornerLength);
        this.ctx.stroke();
        
        // Bottom-left
        this.ctx.beginPath();
        this.ctx.moveTo(box.x, box.y + box.height - cornerLength);
        this.ctx.lineTo(box.x, box.y + box.height);
        this.ctx.lineTo(box.x + cornerLength, box.y + box.height);
        this.ctx.stroke();
        
        // Bottom-right
        this.ctx.beginPath();
        this.ctx.moveTo(box.x + box.width - cornerLength, box.y + box.height);
        this.ctx.lineTo(box.x + box.width, box.y + box.height);
        this.ctx.lineTo(box.x + box.width, box.y + box.height - cornerLength);
        this.ctx.stroke();
        
        // Draw label with confidence
        if (label) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            this.ctx.fillRect(box.x, box.y - 25, 120, 22);
            this.ctx.fillStyle = color;
            this.ctx.font = 'bold 14px monospace';
            this.ctx.fillText(`${label} ${Math.round(box.confidence * 100)}%`, box.x + 5, box.y - 8);
        }
        
        // Draw center point
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
        this.ctx.fill();
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
}