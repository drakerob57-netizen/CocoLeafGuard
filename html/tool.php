<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tool page</title>
    <link href="../css/styles.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">

    <style>
        /* ── Mode tabs ─────────────────────────────────── */
        .mode-tabs {
            display: flex;
            gap: 8px;
            justify-content: center;
            margin-bottom: 2rem;
        }
        .mode-tab-btn {
            padding: 10px 28px;
            border-radius: 50px;
            border: 2px solid #33B82F;
            background: transparent;
            color: #33B82F;
            font-weight: 600;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .mode-tab-btn.active,
        .mode-tab-btn:hover {
            background: #33B82F;
            color: #fff;
        }

        /* ── Symptom filter buttons ─────────────────────── */
        /* Base state */
        .symptom-filter-btn {
            border: none;
            border-radius: 20px;
            padding: 6px 14px;
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s, box-shadow 0.2s, transform 0.1s;
            /* Always keep text white so it's legible on every color */
            color: #fff !important;
            text-shadow: 0 1px 2px rgba(0,0,0,0.45);
        }
        .symptom-filter-btn:hover {
            opacity: 0.85;
            box-shadow: 0 2px 8px rgba(0,0,0,0.18);
            transform: translateY(-1px);
            /* Explicitly keep text white on hover — fixes gray-spot blend */
            color: #fff !important;
        }
        .symptom-filter-btn.active {
            box-shadow: 0 0 0 3px rgba(0,0,0,0.18);
        }

        /* ── Webcam panel ──────────────────────────────── */
        #realtime-panel { display: none; }

        #webcam-wrapper {
            position: relative;
            width: 100%;
            background: #000;
            border-radius: 12px;
            overflow: hidden;
            aspect-ratio: 4/3;
        }
        #webcam-feed {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            transform: scaleX(-1); /* mirror for selfie-cam feel */
        }
        /* Hidden canvas used to grab frames */
        #webcam-canvas { display: none; }

        .webcam-overlay-badge {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.55);
            color: #fff;
            font-size: 0.75rem;
            padding: 4px 10px;
            border-radius: 20px;
            backdrop-filter: blur(4px);
        }

        #webcam-controls {
            display: flex;
            gap: 10px;
            margin-top: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .webcam-btn {
            padding: 9px 22px;
            border-radius: 50px;
            font-weight: 600;
            font-size: 0.875rem;
            border: none;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
        }
        .webcam-btn:active { transform: scale(0.97); }
        .webcam-btn-start  { background: #33B82F; color: #fff; }
        .webcam-btn-stop   { background: #dc3545; color: #fff; display: none; }
        .webcam-btn-snap   { background: #0d6efd; color: #fff; display: none; }
        .webcam-btn-auto   { background: #6f42c1; color: #fff; display: none; }

        .webcam-status {
            text-align: center;
            font-size: 0.82rem;
            color: #6c757d;
            margin-top: 6px;
            min-height: 1.2em;
        }

        /* auto-capture pulse ring */
        @keyframes pulse-ring {
            0%   { box-shadow: 0 0 0 0   rgba(51,184,47,0.5); }
            70%  { box-shadow: 0 0 0 10px rgba(51,184,47,0);   }
            100% { box-shadow: 0 0 0 0   rgba(51,184,47,0);   }
        }
        #webcam-wrapper.auto-active {
            animation: pulse-ring 2s infinite;
        }

        /* ── Loader spinner ────────────────────────────── */
        .spinner-border-custom {
            width: 2.5rem;
            height: 2.5rem;
            border: 4px solid #d4edda;
            border-top-color: #33B82F;
            border-radius: 50%;
            animation: spin 0.75s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
<?php include 'header.php'; ?>

<main class="bg-custom-off-white py-5 min-vh-100 reveal">
    <div class="container text-center mb-4">
        <h1 class="tool-title">Coconut Leaf Health Analysis</h1>
        <p class="tool-subtitle">Upload a clear image of a coconut leaf — or use your camera in real time — to receive AI-powered health assessment using YOLOv8-seg and Random Forest models.</p>
    </div>

    <!-- ── Mode switcher ─────────────────────────────────── -->
    <div class="container">
        <div class="mode-tabs">
            <button class="mode-tab-btn active" id="tab-upload" onclick="switchMode('upload')">
                &#128247; Upload Image
            </button>
            <button class="mode-tab-btn" id="tab-realtime" onclick="switchMode('realtime')">
                &#127909; Real-Time Camera
            </button>
        </div>
    </div>

    <!-- ══════════════════════════════════════════════════════
         UPLOAD PANEL
    ══════════════════════════════════════════════════════ -->
    <div class="container" id="upload-panel">
        <div id="tool-content-area" class="row">

            <!-- Left: upload zone -->
            <div class="col-md-6 mb-4">
                <div class="card-custom text-center h-100 d-flex flex-column justify-content-center">
                    <h4 class="fw-bold mb-4">Upload Image</h4>
                    <form id="upload-form">
                        <div class="upload-area" id="upload-area">
                            <span class="upload-icon">&#8679;</span>
                            <p class="fw-bold mt-3 mb-1">Drop your image here or click to browse</p>
                            <p class="text-muted small">Supports: JPG, PNG (max 10MB)</p>
                            <input type="file" id="file-input" name="image" accept="image/jpeg, image/png" style="display: none;">
                        </div>
                    </form>
                </div>
            </div>

            <!-- Right: results -->
            <div class="col-md-6 mb-4">
                <div class="upload-section card-custom text-center h-100 d-flex flex-column justify-content-center" id="results-panel">
                    <h4 class="fw-bold mb-4">Analysis Results</h4>
                    <div class="py-5 text-muted" id="results-placeholder">
                        <div class="spinner-border-custom mx-auto" id="loading-spinner" style="display:none;"></div>
                        <span style="font-size: 3rem;" id="placeholder-icon">&#127807;</span>
                        <p class="mt-3" id="placeholder-text">Upload an image to begin analysis</p>
                    </div>
                    <div id="results-content" style="display:none;"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- ══════════════════════════════════════════════════════
         REAL-TIME PANEL
    ══════════════════════════════════════════════════════ -->
    <div class="container" id="realtime-panel">
        <div class="row">

            <!-- Left: webcam feed -->
            <div class="col-md-6 mb-4">
                <div class="card-custom h-100 d-flex flex-column justify-content-center">
                    <h4 class="fw-bold mb-3 text-center">Camera Feed</h4>

                    <div id="webcam-wrapper">
                        <video id="webcam-feed" autoplay playsinline muted></video>
                        <canvas id="webcam-canvas"></canvas>
                        <span class="webcam-overlay-badge" id="webcam-badge" style="display:none;">&#128247; Live</span>
                    </div>

                    <div id="webcam-controls">
                        <button class="webcam-btn webcam-btn-start" id="btn-start-cam"   onclick="startWebcam()">Start Camera</button>
                        <button class="webcam-btn webcam-btn-snap"  id="btn-snap"        onclick="captureAndAnalyze()">&#128247; Capture &amp; Analyse</button>
                        <button class="webcam-btn webcam-btn-auto"  id="btn-auto-toggle" onclick="toggleAutoCapture()">&#9654; Auto (3 s)</button>
                        <button class="webcam-btn webcam-btn-stop"  id="btn-stop-cam"    onclick="stopWebcam()">Stop Camera</button>
                    </div>
                    <p class="webcam-status" id="webcam-status">Click "Start Camera" to begin.</p>
                </div>
            </div>

            <!-- Right: live results -->
            <div class="col-md-6 mb-4">
                <div class="card-custom h-100 d-flex flex-column justify-content-center" id="rt-results-panel">
                    <h4 class="fw-bold mb-4 text-center">Live Analysis Results</h4>
                    <div class="py-5 text-muted text-center" id="rt-results-placeholder">
                        <span style="font-size: 3rem;">&#127807;</span>
                        <p class="mt-3">Capture a frame to begin analysis</p>
                    </div>
                    <div id="rt-results-content" style="display:none;"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- ── Model info footer ──────────────────────────────── -->
    <div class="container mt-4">
        <div class="row">
            <div class="col-12">
                <div class="card p-4" style="background-color:#EBF8F2;border-color:#C3E6CB;color:#155724;border-radius:10px;">
                    <div class="row">
                        <div class="col-md-6">
                            <h6 class="fw-bold">YOLOv8-seg Segmentation</h6>
                            <p class="small mb-0">Advanced instance segmentation identifies and isolates individual leaves, enabling precise disease localization.</p>
                        </div>
                        <div class="col-md-6">
                            <h6 class="fw-bold">Random Forest Classification</h6>
                            <p class="small mb-0">Ensemble learning algorithm analyzes segmented regions to classify health status and disease types with high accuracy.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</main>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"></script>
<script src="../javascript/index.js"></script>

<script>
/* ════════════════════════════════════════════════════════════
   MODE SWITCHER
════════════════════════════════════════════════════════════ */
async function switchMode(mode) {
    const uploadPanel   = document.getElementById('upload-panel');
    const realtimePanel = document.getElementById('realtime-panel');
    const tabUpload     = document.getElementById('tab-upload');
    const tabRealtime   = document.getElementById('tab-realtime');

    if (mode === 'upload') {
        uploadPanel.style.display   = 'block';
        realtimePanel.style.display = 'none';
        tabUpload.classList.add('active');
        tabRealtime.classList.remove('active');
        stopWebcam();
    } else {
        uploadPanel.style.display   = 'none';
        realtimePanel.style.display = 'block';
        tabUpload.classList.remove('active');
        tabRealtime.classList.add('active');

        if (!_stream) {
            await startWebcam();
        }
        if (_stream && !_autoRunning) {
            startAutoCapture();
        }
    }
}

/* ════════════════════════════════════════════════════════════
   WEBCAM / REAL-TIME LOGIC
════════════════════════════════════════════════════════════ */
let _stream       = null;
let _autoInterval = null;
let _autoRunning  = false;
const AUTO_INTERVAL_MS = 3000; // 3 s — safe with FastAPI (was 5 s with PHP shell)

async function startWebcam() {
    try {
        _stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
        const video = document.getElementById('webcam-feed');
        video.srcObject = _stream;
        await video.play();

        document.getElementById('webcam-badge').style.display  = 'inline-block';
        document.getElementById('btn-start-cam').style.display = 'none';
        document.getElementById('btn-stop-cam').style.display  = 'inline-block';
        document.getElementById('btn-snap').style.display      = 'inline-block';
        document.getElementById('btn-auto-toggle').style.display = 'inline-block';
        document.getElementById('webcam-status').textContent   = 'Camera active. Capture a frame or enable auto-capture.';
    } catch (err) {
        document.getElementById('webcam-status').textContent =
            'Camera access denied. Please allow camera permissions and try again.';
        console.error('Webcam error:', err);
    }
}

function stopWebcam() {
    stopAutoCapture();
    if (_stream) {
        _stream.getTracks().forEach(t => t.stop());
        _stream = null;
    }
    const video = document.getElementById('webcam-feed');
    video.srcObject = null;

    document.getElementById('webcam-badge').style.display     = 'none';
    document.getElementById('btn-start-cam').style.display    = '';
    document.getElementById('btn-stop-cam').style.display     = 'none';
    document.getElementById('btn-snap').style.display         = 'none';
    document.getElementById('btn-auto-toggle').style.display  = 'none';
    document.getElementById('webcam-wrapper').classList.remove('auto-active');
    document.getElementById('webcam-status').textContent      = 'Camera stopped.';
}

function toggleAutoCapture() {
    if (_autoRunning) {
        stopAutoCapture();
    } else {
        startAutoCapture();
    }
}

function startAutoCapture() {
    _autoRunning = true;
    document.getElementById('btn-auto-toggle').textContent = '⏸ Auto (3 s)';
    document.getElementById('webcam-wrapper').classList.add('auto-active');
    document.getElementById('webcam-status').textContent   = 'Auto-capture active — analysing every 3 seconds…';
    captureAndAnalyze();                                // fire immediately
    _autoInterval = setInterval(captureAndAnalyze, AUTO_INTERVAL_MS);
}

function stopAutoCapture() {
    _autoRunning = false;
    clearInterval(_autoInterval);
    _autoInterval = null;
    const btn = document.getElementById('btn-auto-toggle');
    if (btn) btn.innerHTML = '&#9654; Auto (5 s)';
    document.getElementById('webcam-wrapper').classList.remove('auto-active');
    if (_stream) {
        document.getElementById('webcam-status').textContent = 'Auto-capture stopped.';
    }
}

async function captureAndAnalyze() {
    if (!_stream) return;

    const video  = document.getElementById('webcam-feed');
    const canvas = document.getElementById('webcam-canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;

    // Mirror correction: the video is CSS-mirrored but we want the real image
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    setRtStatus('Analysing…');

    canvas.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append('image', blob, `webcam_${Date.now()}.jpg`);

        try {
            const resp = await fetch('http://localhost:8000/predict', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.error) {
                setRtStatus('Error: ' + data.error);
            } else {
                renderResults(data, 'rt-results-placeholder', 'rt-results-content');
                setRtStatus('Last analysed: ' + new Date().toLocaleTimeString());
            }
        } catch (e) {
            setRtStatus('Network error — check server.');
        }
    }, 'image/jpeg', 0.92);
}

function setRtStatus(msg) {
    document.getElementById('webcam-status').textContent = msg;
}

/* ════════════════════════════════════════════════════════════
   SHARED RESULT RENDERER
   Called both by the upload handler in index.js AND webcam capture.
   index.js should call: renderResults(data, 'results-placeholder', 'results-content')
════════════════════════════════════════════════════════════ */
function renderResults(data, placeholderId, contentId) {
    document.getElementById(placeholderId).style.display = 'none';
    const container = document.getElementById(contentId);
    container.style.display = '';

    // Severity colour
    const sevColor = {
        Healthy:  '#33B82F',
        Mild:     '#FFC107',
        Moderate: '#fd7e14',
        Severe:   '#dc3545',
        Critical: '#7a0000',
    }[data.status] || '#6c757d';

    // Symptom filter buttons — always white text, distinct background per class
    const symptomBtns = (data.symptoms || []).map(s => `
        <button
            class="symptom-filter-btn active me-1 mb-1"
            style="background:${s.color};"
            data-class="${s.label}"
            onclick="toggleOverlay(this, '${s.label}')">
            ${s.label} &mdash; ${s.percent}%
        </button>
    `).join('');

    // Recommendations
    const recs = (data.recommendations || []).map(r => `<li class="small">${r}</li>`).join('');

    container.innerHTML = `
        <div class="text-center mb-3">
            <span class="badge fs-6 px-3 py-2" style="background:${sevColor};color:#fff;border-radius:20px;">
                ${data.status}
            </span>
            <p class="mt-2 mb-0 small text-muted">Affected area: <strong>${data.affected_area}%</strong></p>
        </div>

        ${symptomBtns ? `
        <div class="mb-3">
            <p class="small fw-bold mb-1 text-start">Detected symptoms:</p>
            <div>${symptomBtns}</div>
        </div>` : ''}

        ${data.image_without_boxes ? `
        <div class="position-relative mb-3" id="overlay-container">
            <img src="${data.image_without_boxes}" class="img-fluid rounded" id="base-result-img" alt="Analysis">
            ${Object.entries(data.class_overlays || {}).map(([cls, url]) => `
                <img src="${url}"
                     class="img-fluid rounded position-absolute top-0 start-0 w-100 h-100"
                     style="object-fit:cover;pointer-events:none;"
                     data-overlay="${cls}"
                     id="overlay-${cls.replace(/\s+/g,'_').replace(/-/g,'_')}"
                     alt="${cls} overlay">
            `).join('')}
        </div>` : ''}

        ${recs ? `
        <div class="text-start">
            <p class="small fw-bold mb-1">Recommendations:</p>
            <ul class="ps-3">${recs}</ul>
        </div>` : ''}
    `;
}

window.addEventListener('DOMContentLoaded', () => {
    switchMode('upload');
});

function toggleOverlay(btn, className) {
    btn.classList.toggle('active');
    const safeId = className.replace(/\s+/g,'_').replace(/-/g,'_');
    const el = document.getElementById('overlay-' + safeId);
    if (el) el.style.display = btn.classList.contains('active') ? '' : 'none';
}
</script>
</body>
</html>