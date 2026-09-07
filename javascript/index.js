document.addEventListener("DOMContentLoaded", function () {
    // ── Scroll reveal observer ────────────────────────────────
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("active");
                observer.unobserve(entry.target);
            }
        });
    }, { root: null, threshold: 0.15 });

    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));


    // ── Upload section ────────────────────────────────────────
    const uploadArea  = document.getElementById('upload-area');
    const fileInput   = document.getElementById('file-input');
    const contentArea = document.getElementById('tool-content-area');

    if (!uploadArea) return;

    uploadArea.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) handleUpload(fileInput.files[0]);
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        uploadArea.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    ['dragenter', 'dragover'].forEach(ev =>
        uploadArea.addEventListener(ev, () => uploadArea.classList.add('dragging'), false));
    ['dragleave', 'drop'].forEach(ev =>
        uploadArea.addEventListener(ev, () => uploadArea.classList.remove('dragging'), false));

    uploadArea.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) handleUpload(files[0]);
    });


    function handleUpload(file) {
        renderProcessingState();

        const formData = new FormData();
        formData.append('image', file);

        fetch('http://localhost:8000/predict', { method: 'POST', body: formData })
            .then(r => r.json())
            .then(data => renderResultsState(file, data))
            .catch(err => {
                console.error('Error:', err);
                alert("An error occurred during analysis.");
            });
    }

    function renderProcessingState() {
        contentArea.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="spinner-border text-success" role="status" style="width:3rem;height:3rem;">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <h5 class="mt-3 fw-bold text-success">Analyzing Leaf...</h5>
                <p class="text-muted small">Please wait while the AI model processes the image.</p>
            </div>
        `;
    }


    // ── Canvas compositing for class filters ──────────────────

    /**
     * Draws the original image onto the canvas, then composites
     * whichever class overlay PNGs are currently active.
     * If no filters are active, shows the pre-rendered analyzed image instead.
     */
    async function renderCanvas(state) {
        const canvas  = document.getElementById('leaf-canvas');
        const ctx     = canvas.getContext('2d');

        // Helper: load an image URL into an HTMLImageElement
        const loadImg = (src) => new Promise((res, rej) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload  = () => res(img);
            img.onerror = () => rej(new Error(`Failed to load: ${src}`));
            img.src = src;
        });

        try {
            const activeFilters = state.activeFilters; // Set of class names
            const showBoxes     = state.showBoxes;

            // No class filter active — show static pre-rendered image
            if (activeFilters.size === 0) {
                const src = showBoxes
                    ? state.imageWithBoxes
                    : state.showYoloMask
                        ? state.imageWithoutBoxes
                        : state.rawImageUrl;

                const img = await loadImg(src);
                canvas.width  = img.naturalWidth;
                canvas.height = img.naturalHeight;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                return;
            }

            // Class filter active — composite: original + selected overlays
            const origImg = await loadImg(state.rawImageUrl);
            canvas.width  = origImg.naturalWidth;
            canvas.height = origImg.naturalHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(origImg, 0, 0);

            for (const cls of activeFilters) {
                const overlayUrl = state.classOverlays[cls];
                if (!overlayUrl) continue;
                try {
                    const overlayImg = await loadImg(overlayUrl);
                    ctx.drawImage(overlayImg, 0, 0, canvas.width, canvas.height);
                } catch (e) {
                    console.warn(`Overlay not found for class: ${cls}`);
                }
            }

        } catch (err) {
            console.error('Canvas render error:', err);
        }
    }


    function renderResultsState(file, apiResponse) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const rawImageUrl = e.target.result;

            if (apiResponse.error) {
                alert("Error: " + apiResponse.error);
                return;
            }

            const imageWithBoxes    = apiResponse.image_with_boxes    || rawImageUrl;
            const imageWithoutBoxes = apiResponse.image_without_boxes || rawImageUrl;
            const classOverlays     = apiResponse.class_overlays      || {};
            const symptoms          = apiResponse.symptoms            || [];
            const hasDetections     = symptoms.length > 0;

            // ── Shared reactive state ─────────────────────────
            const state = {
                rawImageUrl,
                imageWithBoxes,
                imageWithoutBoxes,
                classOverlays,
                showBoxes:     false,          // default: no boxes
                showYoloMask:  true,           // default: show the model mask output
                activeFilters: new Set(),      // empty = show all
            };

            // ── Build filter pill buttons ─────────────────────
            const filterPillsHtml = hasDetections
                ? `<div class="d-flex flex-wrap gap-2 justify-content-center mb-3" id="class-filters">
                    <button
                        class="btn btn-sm btn-outline-dark filter-mask-btn active"
                        id="btn-yolo-mask"
                        title="Show the actual YOLO segmentation mask">
                        Actual YOLO Mask
                    </button>
                    ${symptoms.map(s => `
                        <button
                            class="btn btn-sm btn-outline-secondary filter-pill"
                            data-class="${s.label}"
                            style="border-color:${s.color}; color:${s.color};"
                            title="Show only ${s.label}">
                            <span class="me-1" style="
                                display:inline-block;width:10px;height:10px;
                                border-radius:50%;background:${s.color};
                                vertical-align:middle;">
                            </span>
                            ${s.label}
                        </button>
                    `).join('')}
                    <button class="btn btn-sm btn-outline-dark" id="btn-clear-filters" title="Show all classes">
                        Show All
                    </button>
                </div>`
                : '';

            // ── Severity icon ────────────────────────────────
            const severityIcon = {
                Severe:   '🔴',
                Moderate: '🟡',
                Mild:     '🟢',
                Healthy:  '✅',
            }[apiResponse.status] || '⚠️';

            // ── Inject HTML ───────────────────────────────────
            contentArea.innerHTML = `
                <div class="col-md-6 mb-4">
                    <div class="card-custom text-center h-100 d-flex flex-column align-items-center">
                        <h4 class="fw-bold mb-3">Leaf Image</h4>

                        <!-- View toggle: Original / No Boxes / With Boxes -->
                        <div class="btn-group mb-2" role="group" aria-label="Image View Toggle">
                            <button type="button" class="btn btn-sm btn-outline-success" id="btn-original"
                                title="Show original uploaded image">
                                Original
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-success active" id="btn-no-boxes"
                                title="Show masks without bounding boxes">
                                Masks Only
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-success" id="btn-with-boxes"
                                title="Show masks with bounding boxes and confidence scores">
                                With Boxes
                            </button>
                        </div>

                        <!-- Class filter pills -->
                        ${filterPillsHtml}

                        <!-- Canvas — all rendering happens here -->
                        <canvas id="leaf-canvas"
                            style="max-height:400px;max-width:100%;object-fit:contain;border-radius:8px;"
                            class="mb-4">
                        </canvas>

                        <button class="btn btn-upload-different mt-auto" onclick="location.reload();">
                            Upload Different Image
                        </button>
                    </div>
                </div>

                <div class="col-md-6 mb-4">
                    <div class="card-custom h-100">
                        <h4 class="fw-bold mb-4 text-center">Analysis Results</h4>

                        <div class="card-result-severe mb-4">
                            <div class="d-flex justify-content-between align-items-start">
                                <div class="d-flex align-items-center">
                                    <span class="icon-severe me-3">${severityIcon}</span>
                                    <div>
                                        <h6 class="status-text-severe mb-0">
                                            ${apiResponse.status || 'Unknown'}
                                        </h6>
                                        <p class="small text-muted mb-0">
                                            ${apiResponse.affected_area}% overall affected area
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <h6 class="fw-bold mb-3">Symptom Distribution</h6>
                        ${symptoms.map(s => `
                            <div class="symptom-card">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div class="d-flex align-items-center">
                                        <span class="symptom-indicator me-3"
                                            style="background-color:${s.color};"></span>
                                        <span>${s.label}</span>
                                    </div>
                                    <div class="text-end">
                                        <span class="fw-bold">${s.percent}%</span><br>
                                        <span class="small text-muted">${s.count} instance(s)</span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}

                        <div class="mt-4">
                            <h6 class="fw-bold">Recommendations</h6>
                            <ul class="small text-muted ps-3">
                                ${(apiResponse.recommendations || []).map(r => `<li>${r}</li>`).join('')}
                            </ul>
                        </div>

                        <div class="text-center mt-4 pt-3" style="border-top:1px solid #e9ecef;">
                            <button
                                id="btn-model-analysis"
                                style="border:1.5px solid #0d6efd;color:#0d6efd;background:transparent;
                                       border-radius:20px;padding:7px 20px;font-weight:600;
                                       font-size:0.85rem;cursor:pointer;transition:all .2s;">
                                &#128202; Model Analysis
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // ── Initial render ────────────────────────────────
            renderCanvas(state);

            // ── Model Analysis modal ──────────────────────────
            document.getElementById('btn-model-analysis').addEventListener('click', () => {
                openModelAnalysisModal(apiResponse);
            });
            document.getElementById('btn-model-analysis').addEventListener('mouseover', function () {
                this.style.background = '#0d6efd';
                this.style.color = '#fff';
            });
            document.getElementById('btn-model-analysis').addEventListener('mouseout', function () {
                this.style.background = 'transparent';
                this.style.color = '#0d6efd';
            });

            // ── View toggle listeners ─────────────────────────
            const btnOriginal = document.getElementById('btn-original');
            const btnNoBoxes  = document.getElementById('btn-no-boxes');
            const btnWithBoxes = document.getElementById('btn-with-boxes');

            function setActiveViewBtn(active) {
                [btnOriginal, btnNoBoxes, btnWithBoxes].forEach(b => b.classList.remove('active'));
                active.classList.add('active');
            }

            btnOriginal.addEventListener('click', () => {
                state.showBoxes     = false;
                state.showYoloMask  = false;
                state.activeFilters = new Set();   // clear filters too
                clearFilterPillSelections();
                setActiveViewBtn(btnOriginal);

                // Draw original directly — bypass canvas compositing
                const canvas = document.getElementById('leaf-canvas');
                const ctx    = canvas.getContext('2d');
                const img    = new Image();
                img.onload = () => {
                    canvas.width  = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                };
                img.src = rawImageUrl;
            });

            btnNoBoxes.addEventListener('click', () => {
                state.showBoxes = false;
                state.showYoloMask = true;
                setActiveViewBtn(btnNoBoxes);
                renderCanvas(state);
            });

            btnWithBoxes.addEventListener('click', () => {
                state.showBoxes = true;
                state.showYoloMask = true;
                setActiveViewBtn(btnWithBoxes);
                renderCanvas(state);
            });

            document.getElementById('btn-yolo-mask').addEventListener('click', () => {
                state.showYoloMask = !state.showYoloMask;
                const button = document.getElementById('btn-yolo-mask');
                button.classList.toggle('active', state.showYoloMask);
                renderCanvas(state);
            });

            // ── Class filter pill listeners ───────────────────
            function clearFilterPillSelections() {
                document.querySelectorAll('.filter-pill').forEach(p => {
                    p.classList.remove('active');
                    p.style.opacity = '1';
                });
            }

            document.querySelectorAll('.filter-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    const cls = pill.dataset.class;

                    if (state.activeFilters.has(cls)) {
                        state.activeFilters.delete(cls);
                        pill.classList.remove('active');
                    } else {
                        state.activeFilters.add(cls);
                        pill.classList.add('active');
                    }

                    // Dim pills that are not selected when any filter is active
                    if (state.activeFilters.size > 0) {
                        document.querySelectorAll('.filter-pill').forEach(p => {
                            p.style.opacity = state.activeFilters.has(p.dataset.class)
                                ? '1' : '0.35';
                        });
                    } else {
                        clearFilterPillSelections();
                    }

                    renderCanvas(state);
                });
            });

            const btnClear = document.getElementById('btn-clear-filters');
            if (btnClear) {
                btnClear.addEventListener('click', () => {
                    state.activeFilters = new Set();
                    clearFilterPillSelections();
                    renderCanvas(state);
                });
            }
        };

        reader.readAsDataURL(file);
    }
});


/* ════════════════════════════════════════════════════════════
   MODEL ANALYSIS MODAL
   Shows three Chart.js charts:
     1. Confidence Distribution  — histogram of per-detection scores
     2. Symptom Area Distribution — doughnut of % per symptom class
     3. Confidence by Class       — horizontal bar, avg confidence
════════════════════════════════════════════════════════════ */
function openModelAnalysisModal(data) {
    // Remove any stale modal from a previous analysis
    const old = document.getElementById('model-analysis-modal');
    if (old) old.remove();

    const detections       = data.detections          || [];
    const classAvgConf     = data.class_avg_confidence || {};
    const symptoms         = data.symptoms             || [];
    const severitySource   = data.severity_source      || 'N/A';
    const leafAreaPx       = data.leaf_area_px          != null ? data.leaf_area_px.toLocaleString() : 'N/A';
    const dominantSymptom  = data.dominant_symptom      || 'None';

    // ── Build confidence histogram bins ───────────────────────
    const BIN_SIZE   = 0.10;
    const BIN_START  = 0.25;
    const binLabels  = [];
    for (let lo = BIN_START; lo < 1.0; lo = Math.round((lo + BIN_SIZE) * 100) / 100) {
        const hi = Math.min(Math.round((lo + BIN_SIZE) * 100) / 100, 1.0);
        binLabels.push(`${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`);
    }

    // ── Symptom area donut data ───────────────────────────────
    const symptomLabels  = symptoms.map(s => s.label);
    const symptomPercents = symptoms.map(s => s.percent);
    const symptomColors  = symptoms.map(s => s.color);

    const confidenceClasses = [...new Set(detections.map(d => d.class))];
    const confidenceColors = confidenceClasses.map(name => {
        const symptom = symptoms.find(s => s.label.toLowerCase() === name.toLowerCase());
        return symptom ? symptom.color : '#33B82F';
    });
    const confidenceDatasets = confidenceClasses.map((className, classIndex) => ({
        label: className,
        data: binLabels.map((_, binIndex) => {
            const lo = BIN_START + binIndex * BIN_SIZE;
            const hi = Math.min(Math.round((lo + BIN_SIZE) * 100) / 100, 1.0);
            return detections.filter(d => d.class === className &&
                d.confidence >= lo && (d.confidence < hi || (hi === 1 && d.confidence <= 1))).length;
        }),
        backgroundColor: confidenceColors[classIndex] + 'B3',
        borderColor: confidenceColors[classIndex],
        borderWidth: 1,
        borderRadius: 4,
    }));

    const detectedArea = symptoms.reduce((sum, symptom) => sum + (Number(symptom.percent) || 0), 0);
    symptomLabels.push('Unaffected');
    symptomPercents.push(Math.max(0, 100 - detectedArea));
    symptomColors.push('#D9E0E5');

    // ── Per-class confidence bar data ─────────────────────────
    const classNames   = Object.keys(classAvgConf);
    const classConfVals = Object.values(classAvgConf).map(v => (v * 100).toFixed(1));
    const classColors  = classNames.map(name => {
        const sym = symptoms.find(s => s.label.toLowerCase() === name.toLowerCase());
        return sym ? sym.color : '#33B82F';
    });

    // ── No-detection state ────────────────────────────────────
    const noDetHTML = `<p class="text-muted text-center py-3" style="font-size:.9rem;">
        No detections — leaf appears healthy 🌿</p>`;

    // ── Modal HTML ────────────────────────────────────────────
    const modalEl = document.createElement('div');
    modalEl.id = 'model-analysis-modal';
    modalEl.innerHTML = `
    <div class="modal fade" id="maModalDialog" tabindex="-1" aria-labelledby="maModalLabel" aria-hidden="true">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content" style="border-radius:14px;overflow:hidden;">

          <!-- Header -->
          <div class="modal-header" style="background:linear-gradient(135deg,#1a7a17,#33B82F);color:#fff;border:none;">
            <div>
              <h5 class="modal-title fw-bold mb-0" id="maModalLabel">📊 Model Analysis</h5>
              <p class="mb-0 mt-1" style="font-size:.8rem;opacity:.85;">
                Detailed confidence and distribution metrics from the AI inference
              </p>
            </div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>

          <!-- Meta strip -->
          <div class="d-flex flex-wrap gap-3 px-4 py-3" style="background:#f8f9fa;border-bottom:1px solid #dee2e6;font-size:.82rem;">
            <span> <strong>Severity Source:</strong> ${severitySource === 'rf' ? 'Random Forest' : 'Threshold Fallback'}</span>
            <span> <strong>Leaf Area:</strong> ${leafAreaPx} px</span>
            <span> <strong>Total Detections:</strong> ${detections.length}</span>
            <span> <strong>Dominant Symptom:</strong> ${dominantSymptom}</span>
          </div>

          <!-- Body: 3 chart sections -->
          <div class="modal-body px-4 py-4">

            <!-- Row 1: Confidence Distribution -->
            <div class="mb-5">
              <h6 class="fw-bold mb-1">1 · Confidence Distribution</h6>
              <p class="text-muted mb-3" style="font-size:.82rem;">
                How many YOLO detections fall in each confidence score bucket.
                Taller bars at higher confidence indicate the model is more certain.
              </p>
              ${detections.length === 0 ? noDetHTML : `
              <div style="position:relative;height:220px;">
                <canvas id="chart-conf-dist"></canvas>
              </div>`}
            </div>

            <!-- Row 2: Symptom Area + Confidence by Class side-by-side -->
            <div class="row g-4">
              <div class="col-md-5">
                <h6 class="fw-bold mb-1">2 · Symptom Area Distribution</h6>
                <p class="text-muted mb-3" style="font-size:.82rem;">
                  Share of the total leaf area attributed to each disease class and unaffected tissue.
                </p>
                ${symptoms.length === 0 ? noDetHTML : `
                <div style="position:relative;height:250px;">
                  <canvas id="chart-symptom-area"></canvas>
                </div>`}
              </div>
              <div class="col-md-7">
                <h6 class="fw-bold mb-1">3 · Average Confidence by Class</h6>
                <p class="text-muted mb-3" style="font-size:.82rem;">
                  Mean YOLO confidence score across all detections for each disease class.
                  Values closer to 100 % mean the model is highly certain.
                </p>
                ${classNames.length === 0 ? noDetHTML : `
                <div style="position:relative;height:250px;">
                  <canvas id="chart-class-conf"></canvas>
                </div>`}
              </div>
            </div>

          </div><!-- /modal-body -->

          <div class="modal-footer" style="border-top:1px solid #dee2e6;">
            <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;

    document.body.appendChild(modalEl);

    const bsModal = new bootstrap.Modal(document.getElementById('maModalDialog'));
    bsModal.show();

    // Destroy charts when modal hides (prevents canvas reuse error on re-open)
    document.getElementById('maModalDialog').addEventListener('hidden.bs.modal', () => {
        ['chart-conf-dist', 'chart-symptom-area', 'chart-class-conf'].forEach(id => {
            const c = Chart.getChart(id);
            if (c) c.destroy();
        });
        modalEl.remove();
    });

    // Draw charts after the modal is fully shown (canvas must be visible)
    document.getElementById('maModalDialog').addEventListener('shown.bs.modal', () => {
        const gridLines = { color: 'rgba(0,0,0,0.06)' };
        const tickFont  = { size: 11 };

        // ── Chart 1: Confidence Distribution Histogram ────────
        if (detections.length > 0) {
            new Chart(document.getElementById('chart-conf-dist'), {
                type: 'bar',
                data: {
                    labels: binLabels,
                    datasets: confidenceDatasets,
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { font: tickFont, padding: 14, usePointStyle: true } },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.parsed.y} ${ctx.dataset.label} detection(s)`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Confidence Range', font: tickFont },
                            grid:  gridLines,
                            ticks: { font: tickFont },
                        },
                        y: {
                            title: { display: true, text: 'Count', font: tickFont },
                            grid:  gridLines,
                            ticks: { font: tickFont, stepSize: 1 },
                            beginAtZero: true,
                        },
                    },
                },
            });
        }

        // ── Chart 2: Symptom Area Doughnut ───────────────────
        if (symptoms.length > 0) {
            new Chart(document.getElementById('chart-symptom-area'), {
                type: 'doughnut',
                data: {
                    labels: symptomLabels,
                    datasets: [{
                        data:            symptomPercents,
                        backgroundColor: symptomColors,
                        borderColor:     '#fff',
                        borderWidth:     3,
                        hoverOffset:     8,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '60%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { font: tickFont, padding: 14, usePointStyle: true },
                        },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}% of leaf area`,
                            },
                        },
                    },
                },
            });
        }

        // ── Chart 3: Confidence by Class Horizontal Bar ───────
        if (classNames.length > 0) {
            new Chart(document.getElementById('chart-class-conf'), {
                type: 'bar',
                data: {
                    labels: classNames,
                    datasets: [{
                        label: 'Avg Confidence (%)',
                        data:  classConfVals,
                        backgroundColor: classColors.map(c => c + 'CC'),
                        borderColor:     classColors,
                        borderWidth: 2,
                        borderRadius: 5,
                        barThickness: 36,
                    }],
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.parsed.x}% avg confidence`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            min: 0,
                            max: 100,
                            title: { display: true, text: 'Avg Confidence (%)', font: tickFont },
                            grid:  gridLines,
                            ticks: { font: tickFont, callback: v => v + '%' },
                        },
                        y: {
                            grid:  { display: false },
                            ticks: { font: { size: 12, weight: '600' } },
                        },
                    },
                },
            });
        }
    });
}
/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   STATE
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const API_BASE = 'http://localhost:8000';
const API_ENDPOINT = API_BASE + '/predict';

let trees = [];              // {id, treeNumber, locationLabel, coordinates, inspectedAt, images:[{id,url,timestamp,result}], }
let loadingTrees = true;     // true until the initial GET /trees finishes
let selectedTreeId = null;
let selectedImageIdByTree = {};
let captureTargetTreeId = null;
let miniMapInstance = null;

let wizard = {
    step: 'location',            // 'location' | 'leaf' | 'results'
    coordinates: null,
    locationLabel: '',
    gpsLoading: false,
    gpsError: null,
    treePhoto: null,
    leafImage: null,
    leafFile: null,
    analyzing: false,
    result: null,
    analyzeError: null,
};

const SEVERITY_ORDER = ['Healthy', 'Mild', 'Moderate', 'Severe', 'Critical'];

const SEVERITY_STYLES = {
    Healthy:  { bg:'#ECFDF5', border:'#A7F3D0', badgeBg:'#D1FAE5', badgeText:'#065F46', dot:'#10B981', bar:'#10B981' },
    Mild:     { bg:'#FFFBEB', border:'#FDE68A', badgeBg:'#FEF3C7', badgeText:'#92400E', dot:'#F59E0B', bar:'#FBBF24' },
    Moderate: { bg:'#FFF7ED', border:'#FED7AA', badgeBg:'#FFEDD5', badgeText:'#9A3412', dot:'#F97316', bar:'#FB923C' },
    Severe:   { bg:'#FEF2F2', border:'#FECACA', badgeBg:'#FEE2E2', badgeText:'#991B1B', dot:'#EF4444', bar:'#F87171' },
    Critical: { bg:'#FCE9E9', border:'#7a0000', badgeBg:'#7a0000', badgeText:'#ffffff', dot:'#7a0000', bar:'#7a0000' },
};
function sevStyle(level){ return SEVERITY_STYLES[level] || SEVERITY_STYLES.Healthy; }

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   HELPERS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function esc(s){ return (s ?? '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtTime(d){ return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function fmtDate(d){ return d.toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}); }
function uid(prefix){ return prefix + '-' + Date.now() + '-' + Math.floor(Math.random()*1000); }

function severityBadgeHtml(level){
    const c = sevStyle(level);
    return `<span class="sev-badge" style="background:${c.badgeBg};color:${c.badgeText};">
                <span class="sev-dot" style="background:${c.dot};"></span>${esc(level)}
            </span>`;
}

function aggregateStatus(affectedArea){
    if (affectedArea > 85) return 'Critical';
    if (affectedArea > 61) return 'Severe';
    if (affectedArea > 30) return 'Moderate';
    if (affectedArea > 10) return 'Mild';
    return 'Healthy';
}

// Aggregate a tree's images into a single summary. Percentages are pooled
// using each image's leaf area so symptoms absent from an image count as zero.
function aggregateTree(images){
    if (!images.length){
        return { affected_area: 0, status: 'Healthy', symptoms: [], recommendations: [] };
    }
    const areaRecords = images.filter(im => Number.isFinite(Number(im.result.leaf_area_px)) && Number(im.result.leaf_area_px) > 0);
    const totalLeafArea = areaRecords.reduce((s, im) => s + Number(im.result.leaf_area_px), 0);
    const canPoolAreas = areaRecords.length === images.length;
    const avgArea = canPoolAreas
        ? areaRecords.reduce((s, im) => s + (Number(im.result.affected_area) || 0) * Number(im.result.leaf_area_px), 0) / totalLeafArea
        : images.reduce((s, im) => s + (Number(im.result.affected_area) || 0), 0) / images.length;
    const status = aggregateStatus(avgArea);
    const symptomMap = {};
    images.forEach(im => (im.result.symptoms || []).forEach(s => {
        if (!symptomMap[s.label]) symptomMap[s.label] = { label:s.label, color:s.color, total:0, legacyTotal:0 };
        symptomMap[s.label].total += (Number(s.percent) || 0) * (Number(im.result.leaf_area_px) || 0);
        symptomMap[s.label].legacyTotal += Number(s.percent) || 0;
    }));
    const symptoms = Object.values(symptomMap).map(s => ({
        label:s.label,
        color:s.color,
        percent: canPoolAreas
            ? s.total / totalLeafArea
            : s.legacyTotal / images.length
    }));
    // recommendations from the worst image found
    const worstImg = images.slice().sort((a,b) => SEVERITY_ORDER.indexOf(b.result.status) - SEVERITY_ORDER.indexOf(a.result.status))[0];
    return { affected_area: avgArea, status, symptoms, recommendations: worstImg.result.recommendations || [] };
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   ANALYSIS CALL
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function analyzeImage(blob){
    const formData = new FormData();
    formData.append('image', blob, `leaf_${Date.now()}.jpg`);
    const resp = await fetch(API_ENDPOINT, { method: 'POST', body: formData });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    // Preserve the full API response fields needed for the chart modal.
    return {
        status: data.status || 'Healthy',
        affected_area: data.affected_area || 0,
        symptoms: data.symptoms || [],
        recommendations: data.recommendations || [],
        image_without_boxes: data.image_without_boxes || null,
        image_with_boxes: data.image_with_boxes || null,
        class_overlays: data.class_overlays || {},
        detections: data.detections || [],
        class_avg_confidence: data.class_avg_confidence || {},
        severity_source: data.severity_source || 'N/A',
        leaf_area_px: data.leaf_area_px || null,
        dominant_symptom: data.dominant_symptom || 'None',
        original_image: data.original_image || null,
    };
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   PERSISTENCE (SQLite, via the FastAPI server)
   Trees and their images are saved server-side so refreshing or
   closing the tab no longer loses an inspection session.
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

// Convert a server tree record (dates as ISO strings) into the shape
// the rest of the UI code expects (Date objects, aggregated summary).
function apiTreeToLocal(t){
    // IDs are stringified because they end up embedded inside onclick="..."
    // attribute HTML (e.g. selectTree('5')), so the value that comes back
    // through those handlers is always a string â€” keeping tree/image ids
    // as strings everywhere avoids number/string === mismatches.
    const images = (t.images || []).map(im => ({
        id: String(im.id),
        url: im.url,
        timestamp: new Date(im.timestamp),
        result: im.result,
    }));
    return {
        id: String(t.id),
        treeNumber: t.treeNumber,
        locationLabel: t.locationLabel,
        coordinates: t.coordinates,
        photo: t.photo,
        inspectedAt: new Date(t.inspectedAt),
        images,
        aggregated: aggregateTree(images),
    };
}

async function loadTreesFromServer(){
    try {
        const resp = await fetch(`${API_BASE}/trees`);
        if (!resp.ok){
            const body = await resp.text().catch(() => '');
            throw new Error(`GET /trees failed (status ${resp.status}): ${body}`);
        }
        const data = await resp.json();
        trees = (data.trees || []).map(apiTreeToLocal);
    } catch (e){
        console.error('Could not load saved trees from server:', e);
        trees = [];
        // Surface it instead of failing silently.
        const list = document.getElementById('tree-list');
        if (list){
            list.innerHTML = `<p class="small text-danger text-center py-3">
                Could not load saved assessments: ${esc(e.message || String(e))}
            </p>`;
        }
    }
    loadingTrees = false;
    render();
}

async function apiCreateTree(tree){
    const resp = await fetch(`${API_BASE}/trees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            locationLabel: tree.locationLabel,
            coordinates: tree.coordinates,
            photo: tree.photo,
            inspectedAt: tree.inspectedAt.toISOString(),
            images: tree.images.map(im => ({
                url: im.url,
                timestamp: im.timestamp.toISOString(),
                result: im.result,
            })),
        }),
    });
    if (!resp.ok) throw new Error('Failed to save tree (status ' + resp.status + ')');
    return resp.json();
}

async function apiUpdateTree(treeId, fields){
    const resp = await fetch(`${API_BASE}/trees/${treeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
    });
    if (!resp.ok) throw new Error('Failed to update tree (status ' + resp.status + ')');
    return resp.json();
}

async function apiDeleteTree(treeId){
    const resp = await fetch(`${API_BASE}/trees/${treeId}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Failed to delete tree (status ' + resp.status + ')');
    return resp.json();
}

async function apiAddImage(treeId, image){
    const resp = await fetch(`${API_BASE}/trees/${treeId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: image.url,
            timestamp: image.timestamp.toISOString(),
            result: image.result,
        }),
    });
    if (!resp.ok) throw new Error('Failed to save image (status ' + resp.status + ')');
    return resp.json();
}

async function apiDeleteImage(imageId){
    const resp = await fetch(`${API_BASE}/images/${imageId}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Failed to delete image (status ' + resp.status + ')');
    return resp.json();
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   TOP-LEVEL RENDER
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function render(){
    renderSummaryBar();
    renderTreeList();
    renderMiniMap();
    renderDetailPanel();
}

function renderSummaryBar(){
    const totalImages = trees.reduce((s,t) => s + t.images.length, 0);
    document.getElementById('summary-subtitle').textContent = trees.length
        ? `${fmtDate(trees[0].inspectedAt)} \u00b7 ${trees.length} tree${trees.length!==1?'s':''} assessed`
        : 'No trees assessed yet';
    document.getElementById('stat-trees').textContent = trees.length;
    document.getElementById('stat-images').textContent = totalImages;

    const counts = {};
    trees.forEach(t => { counts[t.aggregated.status] = (counts[t.aggregated.status]||0) + 1; });
    const badges = document.getElementById('summary-sev-badges');
    badges.innerHTML = SEVERITY_ORDER.filter(l => counts[l]).map(l => {
        const c = sevStyle(l);
        return `<span class="sev-badge" style="background:${c.badgeBg};color:${c.badgeText};"><span class="sev-dot" style="background:${c.dot};"></span>${counts[l]} ${l}</span>`;
    }).join('');
}

function renderTreeList(){
    document.getElementById('tree-count-badge').textContent = `${trees.length} entries`;
    const list = document.getElementById('tree-list');
    if (loadingTrees){
        list.innerHTML = `<p class="small text-muted text-center py-3"><i class="bi bi-arrow-repeat spin"></i> Loading saved assessments&hellip;</p>`;
        return;
    }
    if (!trees.length){
        list.innerHTML = `<p class="small text-muted text-center py-3">No trees yet &mdash; start your first assessment above.</p>`;
        return;
    }
    list.innerHTML = trees.map(t => {
        const c = sevStyle(t.aggregated.status);
        const selected = t.id === selectedTreeId;
        const symptomChips = (t.aggregated.symptoms || []).slice(0,3).map(s => `
            <div>
                <p class="small text-muted mb-0">${esc(s.label)}</p>
                <p class="small fw-bold mb-0">${s.percent.toFixed(1)}%</p>
            </div>`).join('');
        const treeThumb = t.photo || null;
        return `
        <div class="tree-card ${selected?'selected':''}" onclick="selectTree('${t.id}')">
            <div class="d-flex align-items-start justify-content-between gap-2 mb-1">
                <div class="d-flex align-items-center gap-2">
                    ${treeThumb ? `<img src="${treeThumb}" alt="Tree #${t.treeNumber} thumbnail" class="tree-icon" style="object-fit:cover;">` : `<span class="tree-icon"><i class="bi bi-tree"></i></span>`}
                    <div>
                        <p class="mb-0 fw-semibold small">Tree #${t.treeNumber}</p>
                        <p class="mb-0 small text-muted">${esc(t.locationLabel)}</p>
                    </div>
                </div>
                ${severityBadgeHtml(t.aggregated.status)}
            </div>
            <div class="tree-card-meta">
                <span><i class="bi bi-clock"></i> ${fmtTime(t.inspectedAt)}</span>
                <span><i class="bi bi-images"></i> ${t.images.length} image${t.images.length!==1?'s':''}</span>
                ${t.coordinates ? `<span><i class="bi bi-geo-alt"></i> ${t.coordinates.lat.toFixed(4)}, ${t.coordinates.lng.toFixed(4)}</span>` : ''}
            </div>
            ${selected && symptomChips ? `<div class="tree-card-symptoms">${symptomChips}</div>` : ''}
        </div>`;
    }).join('');
}

function renderMiniMap(){
    const map = document.getElementById('mini-map');
    const caption = document.getElementById('mini-map-caption');
    const container = document.getElementById('mini-map-container');
    const breakdown = document.getElementById('pin-breakdown');
    const withCoords = trees.filter(t => t.coordinates);
    if (!withCoords.length){
        map.style.display='none';
        caption.style.display='none';
        breakdown.style.display='none';
        if (miniMapInstance){
            miniMapInstance.remove();
            miniMapInstance = null;
        }
        return;
    }

    map.style.display='';
    caption.style.display='';
    breakdown.style.display='none';
    document.getElementById('mini-map-text').textContent = `Inspection Coverage Â· ${withCoords.length} assessment${withCoords.length!==1?'s':''}`;

    if (miniMapInstance){
        miniMapInstance.remove();
        miniMapInstance = null;
    }
    container.innerHTML = '';
    miniMapInstance = L.map(container, { zoomControl: true, attributionControl: false });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(miniMapInstance);

    const PIN_GROUP_DISTANCE_METERS = 20;
    const locationGroups = [];
    withCoords.forEach(t => {
        const point = L.latLng(t.coordinates.lat, t.coordinates.lng);
        let group = locationGroups.find(candidate =>
            candidate.center.distanceTo(point) <= PIN_GROUP_DISTANCE_METERS
        );
        if (!group){
            group = { center: point, trees: [] };
            locationGroups.push(group);
        }
        group.trees.push(t);
    });

    function showPinBreakdown(group){
        if (group.length === 1){
            selectTree(group[0].id);
            return;
        }
        breakdown.innerHTML = `
            <div class="pin-breakdown-header">
                <span><i class="bi bi-geo-alt-fill me-1"></i>${group.length} assessments at this pin</span>
                <button type="button" class="pin-breakdown-close" aria-label="Close pin breakdown"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="pin-breakdown-list">
                ${group.map(t => {
                    const style = sevStyle(t.aggregated.status);
                    return `<button type="button" class="pin-breakdown-item" data-tree-id="${esc(t.id)}">
                        <span class="pin-breakdown-dot" style="background:${style.dot};"></span>
                        <span class="pin-breakdown-name">Tree #${esc(t.treeNumber)}<span class="pin-breakdown-meta">${esc(t.locationLabel || 'Unnamed location')}</span></span>
                        <span class="pin-breakdown-status" style="color:${style.badgeText};">${esc(t.aggregated.status)}</span>
                    </button>`;
                }).join('')}
            </div>`;
        breakdown.style.display = 'block';
        breakdown.querySelector('.pin-breakdown-close').onclick = () => {
            breakdown.style.display = 'none';
        };
        breakdown.querySelectorAll('.pin-breakdown-item').forEach(item => {
            item.onclick = () => {
                breakdown.style.display = 'none';
                selectTree(item.dataset.treeId);
            };
        });
    }

    const markers = locationGroups.map(group => {
        const t = group.trees[0];
        const marker = L.circleMarker([group.center.lat, group.center.lng], {
            radius: group.trees.length > 1 ? 10 : 7,
            color: '#fff',
            fillColor: group.trees.length > 1 ? '#0d6efd' : '#10B981',
            fillOpacity: 0.9,
            weight: 2,
        }).addTo(miniMapInstance);
        marker.bindTooltip(group.trees.length > 1 ? `${group.trees.length} nearby tree assessments` : `Tree #${t.treeNumber}`);
        marker.on('click', () => showPinBreakdown(group.trees));
        return marker;
    });

    if (locationGroups.length === 1){
        miniMapInstance.setView([withCoords[0].coordinates.lat, withCoords[0].coordinates.lng], 14);
        markers[0].openTooltip();
    } else {
        const bounds = L.latLngBounds(withCoords.map(t => [t.coordinates.lat, t.coordinates.lng]));
        miniMapInstance.fitBounds(bounds.pad(0.25));
    }
}

function symptomRowHtml(sym, delay){
    const color = sym.color || '#6c757d';
    return `
    <div class="symptom-row">
        <div class="d-flex align-items-center justify-content-between small">
            <span><span class="sev-dot" style="background:${color};margin-right:6px;"></span>${esc(sym.label)}</span>
            <span class="fw-semibold">${sym.percent.toFixed(1)}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(sym.percent,100)}%;background:${color};"></div></div>
    </div>`;
}

// Reusable thumbnail grid for a list of {id, url, result} images.
// selectFnName is the name of a global function(imgId) to call on click.
function imageGalleryHtml(images, selectedId, selectFnName){
    return images.map((im, idx) => {
        const ic = sevStyle(im.result.status);
        return `<div class="img-thumb ${im.id===selectedId?'selected':''}" onclick="${selectFnName}('${im.id}')">
            <img src="${im.url}" alt="Image ${idx+1}">
            <button type="button" class="thumb-zoom-btn" onclick="event.stopPropagation(); openImageZoom('${im.url}')" title="Zoom image">
                <i class="bi bi-zoom-in"></i>
            </button>
            <div class="thumb-badge">
                <span>#${idx+1}</span>
                <span class="thumb-pct" style="background:${ic.dot};">${im.result.affected_area.toFixed(1)}%</span>
            </div>
        </div>`;
    }).join('');
}

function openImageZoom(url){
    const old = document.getElementById('image-zoom-modal');
    if (old) old.remove();

    const modalEl = document.createElement('div');
    modalEl.id = 'image-zoom-modal';
    modalEl.innerHTML = `
    <div class="modal fade" id="imageZoomDialog" tabindex="-1" aria-labelledby="imageZoomLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-xl">
        <div class="modal-content" style="border-radius:14px;overflow:hidden;">
          <div class="modal-header" style="border-bottom:1px solid #dee2e6;">
            <h5 class="modal-title fw-bold" id="imageZoomLabel">Zoomed Image</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body p-0" style="background:#000;display:flex;align-items:center;justify-content:center;">
            <img src="${url}" alt="Zoomed image" style="max-width:100%;max-height:80vh;object-fit:contain;display:block;width:100%;" />
          </div>
        </div>
      </div>
    </div>`;

    document.body.appendChild(modalEl);
    const bsModal = new bootstrap.Modal(document.getElementById('imageZoomDialog'));
    bsModal.show();
    document.getElementById('imageZoomDialog').addEventListener('hidden.bs.modal', () => modalEl.remove());
}

function openEditTreeModal(treeId){
    const tree = trees.find(t => t.id === treeId);
    if (!tree) return;
    const old = document.getElementById('edit-tree-modal');
    if (old) old.remove();

    const modalEl = document.createElement('div');
    modalEl.id = 'edit-tree-modal';
    modalEl.innerHTML = `
    <div class="modal fade" id="editTreeDialog" tabindex="-1" aria-labelledby="editTreeLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-lg">
        <div class="modal-content" style="border-radius:14px;overflow:hidden;">
          <div class="modal-header" style="border-bottom:1px solid #dee2e6;">
            <h5 class="modal-title fw-bold" id="editTreeLabel">Edit Tree Details</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body p-4">
            <div class="row g-3">
              <div class="col-md-8">
                <label class="form-label small fw-semibold">Tree name</label>
                <input type="text" id="edit-tree-name" class="form-control form-control-sm" value="${esc(tree.locationLabel)}">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-semibold">Latitude</label>
                <input type="number" step="0.000001" id="edit-tree-lat" class="form-control form-control-sm" value="${tree.coordinates?.lat ?? ''}">
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-semibold">Longitude</label>
                <input type="number" step="0.000001" id="edit-tree-lng" class="form-control form-control-sm" value="${tree.coordinates?.lng ?? ''}">
              </div>
            </div>
            <div class="mt-4">
                <p class="small fw-semibold mb-2">Tree thumbnail</p>
                <div class="d-flex align-items-center gap-3 mb-3">
                    <img id="edit-tree-photo-preview" src="${tree.photo || 'https://via.placeholder.com/160?text=No+Photo'}" style="width:120px;height:90px;object-fit:cover;border-radius:12px;border:1px solid #e9ecef;">
                    <button type="button" class="btn btn-outline-secondary btn-sm" id="edit-tree-photo-btn">Replace Thumbnail</button>
                </div>
                <input type="file" accept="image/*" id="edit-tree-photo-input" style="display:none;">
            </div>
            <div class="mt-4">
                <p class="small fw-semibold mb-2">Existing images</p>
                <div class="list-group" id="edit-tree-image-list">
                    ${tree.images.map(im => `
                        <div class="list-group-item d-flex align-items-center justify-content-between gap-3 p-2">
                            <div class="d-flex align-items-center gap-2">
                                <img src="${im.url}" style="width:60px;height:40px;object-fit:cover;border-radius:10px;">
                                <span class="small">Image #${tree.images.indexOf(im)+1}</span>
                            </div>
                            <button type="button" class="btn btn-outline-danger btn-sm" data-img-id="${im.id}">Remove</button>
                        </div>
                    `).join('')}
                </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-danger btn-sm me-auto" id="edit-tree-delete-btn">Delete Tree</button>
            <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-leaf btn-sm" id="edit-tree-save-btn">Save Changes</button>
          </div>
          <p class="small text-danger px-4 pb-3 mb-0" id="edit-tree-error" style="display:none;"></p>
        </div>
      </div>
    </div>`;

    document.body.appendChild(modalEl);
    const bsModal = new bootstrap.Modal(document.getElementById('editTreeDialog'));

    const fileInput = document.getElementById('edit-tree-photo-input');
    const photoBtn = document.getElementById('edit-tree-photo-btn');
    const preview = document.getElementById('edit-tree-photo-preview');
    let newTreePhoto = null;

    photoBtn.onclick = () => fileInput.click();
    fileInput.onchange = e => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = ev => {
            preview.src = ev.target.result;
            newTreePhoto = ev.target.result;
        };
        reader.readAsDataURL(file);
    };

    function refreshImageList(){
        const imageList = document.getElementById('edit-tree-image-list');
        if (!imageList) return;
        imageList.innerHTML = tree.images.map(im => `
            <div class="list-group-item d-flex align-items-center justify-content-between gap-3 p-2">
                <div class="d-flex align-items-center gap-2">
                    <img src="${im.url}" style="width:60px;height:40px;object-fit:cover;border-radius:10px;">
                    <span class="small">Image #${tree.images.indexOf(im)+1}</span>
                </div>
                <button type="button" class="btn btn-outline-danger btn-sm" data-img-id="${im.id}">Remove</button>
            </div>
        `).join('');
        imageList.querySelectorAll('[data-img-id]').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.dataset.imgId;
                const errEl = document.getElementById('edit-tree-error');
                btn.disabled = true;
                try {
                    await apiDeleteImage(id);
                    tree.images = tree.images.filter(im => String(im.id) !== String(id));
                    if (String(selectedImageIdByTree[tree.id]) === String(id)){
                        selectedImageIdByTree[tree.id] = tree.images[0]?.id || null;
                    }
                    refreshImageList();
                } catch (e){
                    btn.disabled = false;
                    if (errEl){ errEl.textContent = e.message || 'Could not remove image.'; errEl.style.display = ''; }
                }
            };
        });
    }
    refreshImageList();

    document.getElementById('edit-tree-save-btn').onclick = async () => {
        const name = document.getElementById('edit-tree-name').value.trim() || `Tree #${tree.treeNumber}`;
        const lat = parseFloat(document.getElementById('edit-tree-lat').value);
        const lng = parseFloat(document.getElementById('edit-tree-lng').value);
        const coordinates = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : tree.coordinates;
        const photo = newTreePhoto || tree.photo;
        const errEl = document.getElementById('edit-tree-error');
        const saveBtn = document.getElementById('edit-tree-save-btn');

        saveBtn.disabled = true;
        saveBtn.textContent = 'Savingâ€¦';
        try {
            await apiUpdateTree(tree.id, { locationLabel: name, coordinates, photo });
            tree.locationLabel = name;
            tree.coordinates = coordinates;
            tree.photo = photo;
            tree.aggregated = aggregateTree(tree.images);
            selectedTreeId = tree.id;
            bsModal.hide();
            render();
        } catch (e){
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
            if (errEl){ errEl.textContent = e.message || 'Could not save changes.'; errEl.style.display = ''; }
        }
    };

    document.getElementById('edit-tree-delete-btn').onclick = async () => {
        if (!confirm(`Delete Tree #${tree.treeNumber} and all its images? This cannot be undone.`)) return;
        const delBtn = document.getElementById('edit-tree-delete-btn');
        const errEl = document.getElementById('edit-tree-error');
        delBtn.disabled = true;
        delBtn.textContent = 'Deletingâ€¦';
        try {
            await apiDeleteTree(tree.id);
            trees = trees.filter(t => t.id !== tree.id);
            if (selectedTreeId === tree.id) selectedTreeId = null;
            delete selectedImageIdByTree[tree.id];
            bsModal.hide();
            render();
        } catch (e){
            delBtn.disabled = false;
            delBtn.textContent = 'Delete Tree';
            if (errEl){ errEl.textContent = e.message || 'Could not delete tree.'; errEl.style.display = ''; }
        }
    };

    document.getElementById('editTreeDialog').addEventListener('hidden.bs.modal', () => modalEl.remove());
    bsModal.show();
}

// Reusable "individual image" stats + symptom-filter/overlay card.
function imageDetailHtml(im, idx){
    const symptomBtns = (im.result.symptoms || []).map(s => `
        <button type="button" class="overlay-toggle-btn active me-1 mb-1" style="background:${s.color};" data-class="${esc(s.label)}"
            onclick="toggleOverlay(this,'${im.id}','${esc(s.label)}')">${esc(s.label)} &mdash; ${s.percent.toFixed(1)}%</button>`).join('');
    const recRows = (im.result.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('');

    return `
    <div class="bg-white border rounded-4 p-4 mb-4">
        <div class="d-flex align-items-center gap-2 mb-3">
            <i class="bi bi-bar-chart text-muted"></i>
            <h4 class="h6 fw-bold mb-0">Image #${idx+1} &middot; Individual Result</h4>
            <span class="ms-auto small text-muted">${fmtTime(im.timestamp)}</span>
        </div>
        <div class="d-flex align-items-center gap-3 mb-3">
            ${severityBadgeHtml(im.result.status)}
            <span class="fs-4 fw-bold">${im.result.affected_area.toFixed(1)}%</span>
            <span class="small text-muted">affected area</span>
        </div>
        ${im.url ? `
        <div class="position-relative mb-3" id="overlay-container-${im.id}">
            <img src="${im.url}" class="img-fluid rounded w-100" alt="Original leaf image">
            ${im.result.image_without_boxes ? `<button type="button" class="yolo-mask-icon-btn" id="yolo-mask-btn-${im.id}"
                title="Show actual YOLO mask" aria-label="Show actual YOLO mask"
                onclick="toggleYoloMask(this,'${im.id}')"><i class="bi bi-eye"></i></button>` : ''}
            ${Object.entries(im.result.class_overlays || {}).map(([cls,url]) => `
                <img src="${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(im.timestamp)}" class="rounded position-absolute top-0 start-0 w-100 h-100"
                     style="object-fit:fill;pointer-events:none;" data-overlay="${esc(cls)}"
                     id="overlay-${im.id}-${esc(cls).replace(/\s+/g,'_').replace(/-/g,'_')}" alt="${esc(cls)} overlay">
            `).join('')}
            ${im.result.image_without_boxes ? `
                <img src="${im.result.image_without_boxes}?v=${encodeURIComponent(im.timestamp)}"
                     class="rounded position-absolute top-0 start-0 w-100 h-100"
                     style="object-fit:fill;pointer-events:none;display:none;"
                     id="yolo-mask-${im.id}" alt="Actual YOLO mask">
            ` : ''}
        </div>` : ''}
        ${symptomBtns ? `<div class="mb-3">${symptomBtns}</div>` : ''}
        ${(im.result.symptoms||[]).map((s,i) => symptomRowHtml(s,i*0.05)).join('')}
        <div class="rec-box mb-3">
            <p class="small fw-semibold mb-2" style="color:#1e4f91;">Recommendations</p>
            <ul class="ps-3 mb-0">${recRows || '<li class="text-muted">No recommendations available.</li>'}</ul>
        </div>
        <div class="text-center mt-4 pt-3" style="border-top:1px solid #e9ecef;">
            <button
                type="button"
                class="btn-model-analysis"
                data-analysis-type="image"
                data-img-id="${im.id}"
                style="border:1.5px solid #0d6efd;color:#0d6efd;background:transparent;
                       border-radius:20px;padding:7px 20px;font-weight:600;
                       font-size:0.85rem;cursor:pointer;transition:all .2s;">
                &#128202; Model Analysis
            </button>
        </div>
    </div>`;
}

function renderDetailPanel(){
    const panel = document.getElementById('detail-panel');
    const tree = trees.find(t => t.id === selectedTreeId);
    if (!tree){
        panel.innerHTML = `<div class="empty-detail">
            <i class="bi bi-tree" style="font-size:3.5rem;color:#e9ecef;"></i>
            <p class="mt-3 mb-0">Select a tree, or start a new assessment, to view details here.</p>
        </div>`;
        return;
    }

    const c = sevStyle(tree.aggregated.status);
    if (!selectedImageIdByTree[tree.id] && tree.images.length) selectedImageIdByTree[tree.id] = tree.images[0].id;
    const selImg = tree.images.find(im => im.id === selectedImageIdByTree[tree.id]) || tree.images[0];

    const symptomRows = (tree.aggregated.symptoms || []).map((s,i) => symptomRowHtml(s, i*0.05)).join('');
    const recRows = (tree.aggregated.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('');

    const thumbs = imageGalleryHtml(tree.images, selImg ? selImg.id : null, 'selectTreeDetailImage');
    const selDetail = selImg ? imageDetailHtml(selImg, tree.images.indexOf(selImg)) : '';

    panel.innerHTML = `
        <div class="d-flex align-items-center gap-3 mb-4 flex-wrap">
            ${tree.photo ? `<img src="${tree.photo}" alt="Tree #${tree.treeNumber} photo" style="width:64px;height:64px;border-radius:14px;object-fit:cover;flex-shrink:0;border:1px solid #e9ecef;">` : ''}
            <div class="flex-grow-1">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <h2 class="h5 fw-bold mb-0">Tree #${tree.treeNumber}</h2>
                    ${severityBadgeHtml(tree.aggregated.status)}
                </div>
                <div class="d-flex align-items-center gap-3 small text-muted mt-1 flex-wrap">
                    <span><i class="bi bi-geo-alt"></i> ${esc(tree.locationLabel)}</span>
                    <span><i class="bi bi-clock"></i> ${fmtDate(tree.inspectedAt)} &middot; ${fmtTime(tree.inspectedAt)}</span>
                    ${tree.coordinates ? `<span class="text-muted">${tree.coordinates.lat.toFixed(4)}&deg;N, ${tree.coordinates.lng.toFixed(4)}&deg;E</span>` : ''}
                </div>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1" onclick="openEditTreeModal('${tree.id}')">
                    <i class="bi bi-pencil-square"></i> Edit
                </button>
                <button type="button" class="btn btn-leaf btn-sm d-flex align-items-center gap-1" onclick="openAddImageModal('${tree.id}')">
                    <i class="bi bi-plus-lg"></i> Add Image
                </button>
            </div>
        </div>

        <div class="agg-card" style="background:${c.bg};border-color:${c.border};">
            <div class="d-flex align-items-center gap-2 mb-3">
                <i class="bi bi-layers"></i>
                <h4 class="h6 fw-bold mb-0">Aggregated Assessment</h4>
                <span class="ms-auto small text-muted">from ${tree.images.length} image${tree.images.length!==1?'s':''}</span>
            </div>
            <div class="d-flex align-items-center gap-4 mb-3 flex-wrap">
                <div>
                    <p class="display-6 fw-bold mb-0" style="color:${c.badgeText};">${tree.aggregated.affected_area.toFixed(1)}%</p>
                    <p class="small text-muted mb-0">Overall affected area</p>
                </div>
                <div class="flex-grow-1" style="min-width:180px;">
                    <div class="agg-progress"><div style="width:${Math.min(tree.aggregated.affected_area,100)}%;background:${c.bar};"></div></div>
                    <div class="d-flex justify-content-between small text-muted mt-1"><span>0%</span><span>25%</span><span>50%</span><span>100%</span></div>
                </div>
            </div>
            ${symptomRows}
        <div class="text-center mt-4 pt-3" style="border-top:1px solid #e9ecef;">
            <button
                id="btn-model-analysis-agg"
                type="button"
                class="btn-model-analysis"
                data-analysis-type="aggregated"
                style="border:1.5px solid #0d6efd;color:#0d6efd;background:transparent;
                       border-radius:20px;padding:7px 20px;font-weight:600;
                       font-size:0.85rem;cursor:pointer;transition:all .2s;">
                &#128202; Model Analysis
            </button>
        </div>
        </div>
    ${tree.images.length ? `
        <div class="mb-4">
            <p class="small fw-semibold mb-2">Captured Images (${tree.images.length})</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">${thumbs}</div>
        </div>
    ` : ''}
    ${selDetail}
    `;
    setTimeout(attachAnalysisButtonEvents, 0);
}

function openAnalysisModal(type){
    const tree = trees.find(t => t.id === selectedTreeId);
    const subtitle = document.getElementById('analysis-subtitle');
    const body = document.getElementById('analysis-body');

    if (!tree){
        subtitle.textContent = '';
        body.innerHTML = '<p class="small text-muted">No tree selected.</p>';
        document.getElementById('analysis-backdrop').style.display = 'flex';
        return;
    }

    const selImg = tree.images.find(im => im.id === selectedImageIdByTree[tree.id]) || tree.images[0];

    if (type === 'image' && selImg && typeof openModelAnalysisModal === 'function' && selImg.result){
        openModelAnalysisModal(selImg.result);
        return;
    }

    if (type === 'aggregated' && typeof openModelAnalysisModal === 'function'){
        const aggregatedData = buildAggregatedAnalysisResult(tree);
        if (aggregatedData){
            openModelAnalysisModal(aggregatedData);
            return;
        }
    }

    if (type === 'image' && selImg){
        subtitle.textContent = `Tree #${tree.treeNumber} Â· Image #${tree.images.indexOf(selImg)+1}`;
        body.innerHTML = `
            <div class="analysis-grid">
                <div class="analysis-section">
                    <h5>Image Analysis</h5>
                    <p class="mb-2"><strong>Status:</strong> ${esc(selImg.result.status)}</p>
                    <p class="mb-2"><strong>Affected area:</strong> ${selImg.result.affected_area.toFixed(1)}%</p>
                    <p class="mb-0"><strong>Captured:</strong> ${fmtDate(selImg.timestamp)} ${fmtTime(selImg.timestamp)}</p>
                </div>
                <div class="analysis-section">
                    <h5>Detections</h5>
                    <ul class="analysis-list">
                        ${(selImg.result.detections || []).map(d => `<li>${esc(d.class)} â€” ${esc(d.confidence.toFixed(2))}</li>`).join('') || '<li class="text-muted">No detections.</li>'}
                    </ul>
                </div>
            </div>
            <div class="analysis-section mt-3">
                <h5>Symptoms</h5>
                <ul class="analysis-list">
                    ${(selImg.result.symptoms || []).map(s => `<li>${esc(s.label)} â€” ${esc(s.percent.toFixed(1))}%</li>`).join('') || '<li class="text-muted">No symptoms detected.</li>'}
                </ul>
            </div>
            <div class="analysis-section mt-3">
                <h5>Recommendations</h5>
                <ul class="analysis-list">
                    ${(selImg.result.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('')}
                </ul>
            </div>
        `;
    } else {
        subtitle.textContent = `Tree #${tree.treeNumber} Â· Aggregated result`;
        body.innerHTML = `
            <div class="analysis-grid">
                <div class="analysis-section">
                    <h5>Aggregated Status</h5>
                    <p class="mb-2"><strong>Status:</strong> ${esc(tree.aggregated.status)}</p>
                    <p class="mb-2"><strong>Affected area:</strong> ${tree.aggregated.affected_area.toFixed(1)}%</p>
                    <p class="mb-0"><strong>Images:</strong> ${tree.images.length}</p>
                </div>
                <div class="analysis-section">
                    <h5>Symptom Summary</h5>
                    <ul class="analysis-list">
                        ${(tree.aggregated.symptoms || []).map(s => `<li>${esc(s.label)} â€” ${esc(s.percent.toFixed(1))}%</li>`).join('') || '<li class="text-muted">No aggregated symptoms.</li>'}
                    </ul>
                </div>
            </div>
            <div class="analysis-section mt-3">
                <h5>Recommendations</h5>
                <ul class="analysis-list">
                    ${(tree.aggregated.recommendations || []).map(r => `<li>${esc(r)}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    document.getElementById('analysis-backdrop').style.display = 'flex';
}

function closeAnalysisModal(){
    document.getElementById('analysis-backdrop').style.display = 'none';
}

function buildAggregatedAnalysisResult(tree){
    if (!tree || !Array.isArray(tree.images) || tree.images.length === 0) return null;

    const detections = [];
    const classConfMap = {};
    let leafAreaSum = 0;
    let leafAreaCount = 0;

    tree.images.forEach(im => {
        if (im.result){
            if (Array.isArray(im.result.detections)){
                im.result.detections.forEach(d => {
                    detections.push({ class: d.class, confidence: d.confidence });
                });
            }
            if (im.result.class_avg_confidence){
                Object.entries(im.result.class_avg_confidence).forEach(([cls, val]) => {
                    if (!classConfMap[cls]) classConfMap[cls] = [];
                    classConfMap[cls].push(Number(val));
                });
            }
            if (typeof im.result.leaf_area_px === 'number'){
                leafAreaSum += im.result.leaf_area_px;
                leafAreaCount += 1;
            }
        }
    });

    const class_avg_confidence = {};
    Object.entries(classConfMap).forEach(([cls, values]) => {
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
        class_avg_confidence[cls] = Number(avg.toFixed(4));
    });

    const symptoms = (tree.aggregated.symptoms || []).map(s => ({
        label: s.label,
        color: s.color,
        percent: s.percent,
    }));

    const dominant = symptoms.reduce((best, current) => {
        return !best || current.percent > best.percent ? current : best;
    }, null);

    return {
        detections,
        class_avg_confidence,
        symptoms,
        severity_source: 'aggregated',
        leaf_area_px: leafAreaCount ? Math.round(leafAreaSum / leafAreaCount) : null,
        dominant_symptom: dominant ? dominant.label : 'None',
        image_without_boxes: tree.images[0]?.result?.image_without_boxes || null,
    };
}

function attachAnalysisButtonEvents(){
    document.querySelectorAll('.btn-model-analysis').forEach(btn => {
        btn.onclick = () => {
            const type = btn.dataset.analysisType || 'aggregated';
            const imgId = btn.dataset.imgId;
            const tree = trees.find(t => t.id === selectedTreeId);
            let targetResult = null;

            if (type === 'image'){
                if (imgId){
                    targetResult = wizard.images.find(im => im.id === imgId)?.result
                        || tree?.images.find(im => im.id === imgId)?.result;
                }
                if (targetResult){
                    return openModelAnalysisModal(targetResult);
                }
            }

            if (type === 'aggregated' && tree){
                const aggregatedData = buildAggregatedAnalysisResult(tree);
                if (aggregatedData){
                    return openModelAnalysisModal(aggregatedData);
                }
            }

            openAnalysisModal(type);
        };
        btn.onmouseover = () => {
            btn.style.background = '#0d6efd';
            btn.style.color = '#fff';
        };
        btn.onmouseout = () => {
            btn.style.background = 'transparent';
            btn.style.color = '#0d6efd';
        };
    });
}

function selectTree(id){
    selectedTreeId = id;
    render();
}
function selectTreeDetailImage(imgId){
    selectedImageIdByTree[selectedTreeId] = imgId;
    renderDetailPanel();
}
function toggleOverlay(btn, imgId, className){
    btn.classList.toggle('active');
    const safeId = className.replace(/\s+/g,'_').replace(/-/g,'_');
    const el = document.getElementById(`overlay-${imgId}-${safeId}`);
    if (el) el.style.display = btn.classList.contains('active') ? '' : 'none';
}
function toggleYoloMask(btn, imgId){
    const showMask = btn.classList.toggle('active');
    const mask = document.getElementById(`yolo-mask-${imgId}`);
    const container = document.getElementById(`overlay-container-${imgId}`);
    if (!mask || !container) return;
    mask.style.display = showMask ? '' : 'none';
    container.querySelectorAll('[data-overlay]').forEach(overlay => {
        overlay.style.display = showMask ? 'none' : '';
    });
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   WIZARD (new tree assessment)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function resetWizard(){
    wizard = { step:'location', coordinates:null, locationLabel:'', gpsLoading:false, gpsError:null,
               treePhoto:null, leafImage:null, leafFile:null, analyzing:false, result:null, analyzeError:null,
               images:[], selectedImageId:null, saving:false, saveError:null };
}

function openWizard(){
    resetWizard();
    document.getElementById('wizard-tree-number').textContent = `#${trees.length + 1}`;
    document.getElementById('wizard-backdrop').style.display = 'flex';
    renderWizard();
}
function closeWizard(){
    document.getElementById('wizard-backdrop').style.display = 'none';
}
function wizardGoTo(step){ wizard.step = step; renderWizard(); }

const WIZARD_STEPS = [
    { id:'location', label:'Location' },
    { id:'leaf', label:'Leaf Image' },
    { id:'results', label:'Assessment' },
];

function renderStepIndicator(){
    const idx = WIZARD_STEPS.findIndex(s => s.id === wizard.step);
    document.getElementById('step-indicator').innerHTML = WIZARD_STEPS.map((s,i) => {
        const done = i < idx, active = i === idx;
        return `
        <div class="step-node">
            <div class="step-circle ${done?'done':''} ${active?'active':''}">${done ? '<i class="bi bi-check-lg"></i>' : i+1}</div>
            <div class="step-label ${active?'active':''}">${s.label}</div>
        </div>
        ${i < WIZARD_STEPS.length-1 ? `<div class="step-connector ${done?'done':''}"></div>` : ''}`;
    }).join('');
}

function renderWizard(){
    renderStepIndicator();
    const body = document.getElementById('wizard-body');
    if (wizard.step === 'location') body.innerHTML = locationStepHtml();
    else if (wizard.step === 'leaf') body.innerHTML = leafStepHtml();
    else body.innerHTML = resultsStepHtml();
    wireWizardEvents();
    attachAnalysisButtonEvents();
}

function locationStepHtml(){
    return `
    <h3 class="h6 fw-bold mb-1">Confirm Tree Location</h3>
    <p class="small text-muted mb-3">Use your device's GPS to pin the exact position of the tree being assessed.</p>

    <div class="gps-panel mb-4">
        <div class="gps-map">
            ${wizard.coordinates ? `
                <div class="text-center">
                    <i class="bi bi-geo-alt-fill" style="font-size:1.8rem;color:var(--leaf-green);"></i>
                    <div><span class="badge bg-white text-success mt-1">${wizard.coordinates.lat.toFixed(5)}&deg;N, ${wizard.coordinates.lng.toFixed(5)}&deg;E</span></div>
                </div>` : `
                <div class="text-center text-muted">
                    <i class="bi bi-compass" style="font-size:1.6rem;opacity:.5;"></i>
                    <p class="small mb-0 mt-1">Waiting for GPS fix&hellip;</p>
                </div>`}
        </div>
        <div class="gps-controls">
            <div class="flex-grow-1">
                ${wizard.coordinates ? `
                    <p class="small fw-semibold mb-0">${esc(wizard.locationLabel)}</p>
                    <p class="small text-muted mb-0">${wizard.coordinates.lat.toFixed(6)}, ${wizard.coordinates.lng.toFixed(6)}</p>`
                    : `<p class="small text-muted mb-0">No location fixed yet</p>`}
                ${wizard.gpsError ? `<p class="small text-danger mb-0 mt-1">${esc(wizard.gpsError)}</p>` : ''}
            </div>
            <button type="button" class="btn btn-leaf btn-sm d-flex align-items-center gap-1" id="btn-get-gps" ${wizard.gpsLoading?'disabled':''}>
                ${wizard.gpsLoading ? '<i class="bi bi-arrow-repeat spin"></i> Locating&hellip;' : (wizard.coordinates ? '<i class="bi bi-arrow-repeat"></i> Refresh' : '<i class="bi bi-crosshair"></i> Get Position')}
            </button>
        </div>
    </div>

    <p class="small fw-semibold mb-2">Tree Photo <span class="fw-normal text-muted">(optional &mdash; for visual reference)</span></p>
    ${wizard.treePhoto ? `
        <div class="leaf-preview mb-3" style="height:150px;">
            <img src="${wizard.treePhoto}" style="height:150px;">
            <button type="button" class="remove-btn" id="btn-remove-tree-photo"><i class="bi bi-x"></i></button>
        </div>` : `
        <div class="drop-zone mb-3 py-3" id="tree-photo-zone" style="padding:16px;">
            <div class="d-flex align-items-center gap-3 text-start">
                <span class="icon-circle" style="width:44px;height:44px;font-size:1.1rem;margin:0;"><i class="bi bi-camera"></i></span>
                <div>
                    <p class="mb-0 small fw-semibold">Capture or upload tree photo</p>
                    <p class="mb-0" style="font-size:.72rem;color:#adb5bd;">Helps confirm which tree is being assessed</p>
                </div>
            </div>
        </div>`}
    <input type="file" accept="image/*" capture="environment" id="tree-photo-input" style="display:none;">

    <button type="button" class="btn btn-leaf w-100 py-2 fw-semibold d-flex align-items-center justify-content-center gap-2" id="btn-loc-next" ${!wizard.coordinates?'disabled':''}>
        Confirm Location &amp; Continue <i class="bi bi-chevron-right"></i>
    </button>
    ${!wizard.coordinates ? `<p class="small text-center text-muted mt-2 mb-0">Tap "Get Position" first to confirm the tree location.</p>` : ''}
    `;
}

function leafStepHtml(){
    const addedCount = wizard.images.length;
    const pendingReady = !!(wizard.result && !wizard.analyzing);
    const totalCount = addedCount + (pendingReady ? 1 : 0);

    const addedGallery = addedCount ? `
        <div class="mb-3">
            <p class="small fw-semibold mb-2">Added Images (${addedCount})</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                ${wizard.images.map((im, idx) => {
                    const ic = sevStyle(im.result.status);
                    return `<div class="img-thumb" style="height:84px;">
                        <img src="${im.url}" alt="Image ${idx+1}">
                        <div class="thumb-badge">
                            <span>#${idx+1}</span>
                            <span class="thumb-pct" style="background:${ic.dot};">${im.result.affected_area.toFixed(1)}%</span>
                        </div>
                        <button type="button" class="remove-btn" style="width:22px;height:22px;top:4px;right:4px;" onclick="removeWizardImage('${im.id}')">
                            <i class="bi bi-x" style="font-size:.75rem;"></i>
                        </button>
                    </div>`;
                }).join('')}
            </div>
        </div>` : '';

    const captureArea = wizard.leafImage ? `
        <div class="leaf-preview mb-2">
            <img src="${wizard.leafImage}">
            ${(!wizard.analyzing) ? `<button type="button" class="remove-btn" id="btn-remove-leaf"><i class="bi bi-x"></i></button>` : ''}
            ${wizard.analyzing ? `
                <div class="analyzing-overlay">
                    <i class="bi bi-arrow-repeat spin" style="font-size:1.6rem;"></i>
                    <p class="small mb-0 fw-semibold">Running YOLOv8-seg&hellip;</p>
                    <p class="mb-0" style="font-size:.72rem;opacity:.8;">Random Forest classification</p>
                </div>` : ''}
            ${pendingReady ? `
                <div class="result-strip">
                    ${severityBadgeHtml(wizard.result.status)}
                    <span class="text-white fw-semibold small">${wizard.result.affected_area.toFixed(1)}% affected</span>
                </div>` : ''}
        </div>
        ${pendingReady ? `
        <button type="button" class="btn btn-outline-success btn-sm w-100 mb-3 d-flex align-items-center justify-content-center gap-1" id="btn-add-image">
            <i class="bi bi-plus-lg"></i> Add This Image &amp; Capture Another
        </button>` : ''}` : `
        <div class="drop-zone mb-3" id="leaf-drop-zone">
            <div class="icon-circle"><i class="bi bi-upload"></i></div>
            <p class="fw-semibold mb-1">Drop a leaf image here</p>
            <p class="small text-muted mb-3">or click to browse / use camera</p>
            <span class="btn btn-leaf btn-sm"><i class="bi bi-camera me-1"></i> Browse / Capture</span>
        </div>`;

    return `
    <h3 class="h6 fw-bold mb-1">Capture Leaf Image${addedCount ? 's' : ''}</h3>
    <p class="small text-muted mb-3">Upload or photograph coconut leaves from this tree. You can add several images before finishing.</p>

    ${wizard.treePhoto ? `
        <div class="d-flex align-items-center gap-3 p-2 bg-light rounded-3 mb-3">
            <img src="${wizard.treePhoto}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;">
            <div>
                <p class="mb-0 small fw-semibold">Assessing tree at</p>
                <p class="mb-0 small text-muted">${esc(wizard.locationLabel)}</p>
            </div>
            <i class="bi bi-geo-alt text-success ms-auto"></i>
        </div>` : ''}

    ${addedGallery}
    ${captureArea}
    <input type="file" accept="image/*" capture="environment" id="leaf-file-input" style="display:none;">

    ${wizard.analyzeError ? `<p class="small text-danger mt-2 mb-0">${esc(wizard.analyzeError)} &mdash; check that the analysis server is running.</p>` : ''}

    <div class="d-flex gap-2 mt-3">
        <button type="button" class="btn btn-outline-secondary d-flex align-items-center gap-1" id="btn-leaf-back"><i class="bi bi-arrow-left"></i> Back</button>
        <button type="button" class="btn btn-leaf flex-grow-1 d-flex align-items-center justify-content-center gap-2" id="btn-leaf-next" ${(totalCount===0 || wizard.analyzing)?'disabled':''}>
            ${wizard.analyzing ? '<i class="bi bi-arrow-repeat spin"></i> Analyzing&hellip;' : `<span>View Results${totalCount ? ` (${totalCount} image${totalCount!==1?'s':''})` : ''}</span> <i class="bi bi-chevron-right"></i>`}
        </button>
    </div>
    ${totalCount===0 ? `<p class="small text-center text-muted mt-2 mb-0">Add at least one leaf image to continue.</p>` : ''}
    `;
}

function resultsStepHtml(){
    const agg = aggregateTree(wizard.images);
    const c = sevStyle(agg.status);
    const symptomRows = (agg.symptoms || []).map((s,i) => symptomRowHtml(s,i*0.05)).join('');
    const recRows = (agg.recommendations || []).map(x => `<li class="d-flex gap-2"><span class="mt-1" style="width:5px;height:5px;border-radius:50%;background:#7aa7dd;flex-shrink:0;"></span>${esc(x)}</li>`).join('');

    if (!wizard.selectedImageId || !wizard.images.find(im => im.id === wizard.selectedImageId)){
        wizard.selectedImageId = wizard.images.length ? wizard.images[0].id : null;
    }
    const selImg = wizard.images.find(im => im.id === wizard.selectedImageId);
    const gallery = wizard.images.length > 0 ? imageGalleryHtml(wizard.images, wizard.selectedImageId, 'selectWizardImage') : '';
    const selDetail = selImg ? imageDetailHtml(selImg, wizard.images.indexOf(selImg)) : '';

    return `
    <h3 class="h6 fw-bold mb-1">Assessment Results</h3>
    <p class="small text-muted mb-3">Tree #${trees.length+1} &middot; ${esc(wizard.locationLabel)} &middot; ${wizard.images.length} image${wizard.images.length!==1?'s':''}</p>

    <div class="agg-card mb-3" style="background:${c.bg};border-color:${c.border};">
        <div class="d-flex align-items-center justify-content-between mb-3">
            <div class="d-flex align-items-center gap-2">
                <i class="bi ${agg.status==='Healthy'?'bi-check-circle':'bi-exclamation-triangle'}" style="font-size:1.6rem;color:${c.badgeText};"></i>
                <div>
                    <p class="fs-5 fw-bold mb-0" style="color:${c.badgeText};">${esc(agg.status)}</p>
                    <p class="small text-muted mb-0">Overall severity classification</p>
                </div>
            </div>
            <div class="text-end">
                <p class="fs-3 fw-bold mb-0" style="color:${c.badgeText};">${agg.affected_area.toFixed(1)}%</p>
                <p class="small text-muted mb-0">average affected area</p>
            </div>
        </div>
        <div class="agg-progress mb-1"><div style="width:${Math.min(agg.affected_area,100)}%;background:${c.bar};"></div></div>
        <div class="d-flex justify-content-between small text-muted"><span>Healthy</span><span>Mild</span><span>Moderate</span><span>Severe</span></div>
        ${symptomRows ? `<div class="mt-3">${symptomRows}</div>` : ''}
    </div>

    <div class="mb-3">
        <p class="small fw-semibold mb-2">Captured Images (${wizard.images.length})</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">${gallery}</div>
    </div>

    ${selDetail}

    <div class="rec-box mb-4">
        <p class="small fw-semibold mb-2" style="color:#1e4f91;">Recommendations</p>
        <ul class="ps-3 mb-0">${recRows}</ul>
    </div>

    <div class="d-flex gap-2">
        <button type="button" class="btn btn-outline-secondary d-flex align-items-center gap-1" id="btn-add-more" ${wizard.saving?'disabled':''}><i class="bi bi-plus-lg"></i> Add More Images</button>
        <button type="button" class="btn btn-leaf flex-grow-1 d-flex align-items-center justify-content-center gap-2" id="btn-finish" ${wizard.saving?'disabled':''}>
            ${wizard.saving ? '<i class="bi bi-arrow-repeat spin"></i> Saving&hellip;' : '<i class="bi bi-flag-fill"></i> Finish Assessment'}
        </button>
    </div>
    ${wizard.saveError ? `<p class="small text-danger mt-2 mb-0">${esc(wizard.saveError)}</p>` : ''}
    `;
}

function wireWizardEvents(){
    if (wizard.step === 'location'){
        const gpsBtn = document.getElementById('btn-get-gps');
        if (gpsBtn) gpsBtn.onclick = requestGPS;
        const zone = document.getElementById('tree-photo-zone');
        const input = document.getElementById('tree-photo-input');
        if (zone) zone.onclick = () => input.click();
        if (input) input.onchange = e => e.target.files[0] && readTreePhoto(e.target.files[0]);
        const rm = document.getElementById('btn-remove-tree-photo');
        if (rm) rm.onclick = () => { wizard.treePhoto = null; renderWizard(); };
        const next = document.getElementById('btn-loc-next');
        if (next) next.onclick = () => wizardGoTo('leaf');
    } else if (wizard.step === 'leaf'){
        const zone = document.getElementById('leaf-drop-zone');
        const input = document.getElementById('leaf-file-input');
        if (zone){
            zone.onclick = () => input.click();
            zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragging'); };
            zone.ondragleave = () => zone.classList.remove('dragging');
            zone.ondrop = e => { e.preventDefault(); zone.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if (f) handleLeafFile(f); };
        }
        if (input) input.onchange = e => e.target.files[0] && handleLeafFile(e.target.files[0]);
        const rm = document.getElementById('btn-remove-leaf');
        if (rm) rm.onclick = () => { wizard.leafImage = null; wizard.leafFile = null; wizard.result = null; wizard.analyzeError = null; renderWizard(); };
        const addBtn = document.getElementById('btn-add-image');
        if (addBtn) addBtn.onclick = () => { pushPendingImage(); renderWizard(); };
        document.getElementById('btn-leaf-back').onclick = () => wizardGoTo('location');
        document.getElementById('btn-leaf-next').onclick = () => {
            pushPendingImage();
            if (wizard.images.length === 0) return;
            wizardGoTo('results');
        };
    } else {
        const addMore = document.getElementById('btn-add-more');
        if (addMore) addMore.onclick = () => wizardGoTo('leaf');
        document.getElementById('btn-finish').onclick = finishWizard;
    }
}

// Moves the currently-analyzed pending image into wizard.images, if any.
// Prefer the permanent server-side copy of the upload (original_image) as
// the thumbnail URL over the in-browser data: URL, so the gallery still
// has something to show after a refresh once this is saved to the DB.
function pushPendingImage(){
    if (!wizard.result || !wizard.leafImage) return;
    const url = wizard.result.original_image || wizard.leafImage;
    wizard.images.push({ id: uid('img'), url, timestamp: new Date(), result: wizard.result });
    wizard.leafImage = null;
    wizard.leafFile = null;
    wizard.result = null;
    wizard.analyzeError = null;
}
function removeWizardImage(imgId){
    wizard.images = wizard.images.filter(im => im.id !== imgId);
    if (wizard.selectedImageId === imgId) wizard.selectedImageId = null;
    renderWizard();
}
function selectWizardImage(imgId){
    wizard.selectedImageId = imgId;
    renderWizard();
}

function requestGPS(){
    if (!navigator.geolocation){
        wizard.gpsError = "Geolocation is not supported by this device.";
        renderWizard();
        return;
    }
    wizard.gpsLoading = true; wizard.gpsError = null; wizard.coordinates = null;
    renderWizard();
    navigator.geolocation.getCurrentPosition(
        pos => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            wizard.gpsLoading = false;
            wizard.coordinates = { lat, lng };
            wizard.locationLabel = `Field \u00b7 ${lat.toFixed(4)}\u00b0N`;
            renderWizard();
        },
        err => {
            wizard.gpsLoading = false;
            wizard.gpsError = "Couldn't get your location (" + err.message + "). Check location permissions and try again.";
            renderWizard();
        },
        { timeout: 8000, enableHighAccuracy: true }
    );
}

function readTreePhoto(file){
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => { wizard.treePhoto = e.target.result; renderWizard(); };
    reader.readAsDataURL(file);
}

function handleLeafFile(file){
    if (!file.type.startsWith('image/')) return;
    wizard.leafFile = file;
    wizard.result = null;
    wizard.analyzeError = null;
    const reader = new FileReader();
    reader.onload = e => {
        wizard.leafImage = e.target.result;
        renderWizard();
        runAnalysis();
    };
    reader.readAsDataURL(file);
}

async function runAnalysis(){
    wizard.analyzing = true; renderWizard();
    try {
        wizard.result = await analyzeImage(wizard.leafFile);
    } catch (e){
        wizard.analyzeError = e.message || 'Analysis failed';
    }
    wizard.analyzing = false;
    renderWizard();
}

async function finishWizard(){
    // Sweep in any analyzed-but-not-yet-added pending image first.
    pushPendingImage();
    if (!wizard.coordinates || wizard.images.length === 0) return;

    const treeNumber = trees.length + 1;
    const draft = {
        locationLabel: wizard.locationLabel || `Field \u00b7 Tree #${treeNumber}`,
        coordinates: wizard.coordinates,
        photo: wizard.treePhoto,
        inspectedAt: new Date(),
        images: wizard.images,
    };

    wizard.saving = true;
    wizard.saveError = null;
    renderWizard();

    let tree;
    try {
        const saved = await apiCreateTree(draft);
        tree = apiTreeToLocal(saved);
    } catch (e){
        wizard.saving = false;
        wizard.saveError = (e.message || 'Could not save this assessment') + ' \u2014 check that the analysis server is running.';
        renderWizard();
        return;
    }

    trees.push(tree);
    selectedTreeId = tree.id;
    selectedImageIdByTree[tree.id] = tree.images[0].id;
    closeWizard();
    render();
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   ADD IMAGE MODAL (existing tree)
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
let addImgState = { preview:null, file:null, analyzing:false, error:null };

function openAddImageModal(treeId){
    captureTargetTreeId = treeId;
    addImgState = { preview:null, file:null, analyzing:false, error:null };
    const tree = trees.find(t => t.id === treeId);
    document.getElementById('addimg-subtitle').textContent = tree ? `Tree #${tree.treeNumber} \u00b7 ${tree.locationLabel}` : '';
    document.getElementById('addimg-backdrop').style.display = 'flex';
    renderAddImageModal();
}
function closeAddImageModal(){
    document.getElementById('addimg-backdrop').style.display = 'none';
    captureTargetTreeId = null;
}

function renderAddImageModal(){
    const body = document.getElementById('addimg-body');
    body.innerHTML = `
    ${!addImgState.preview ? `
        <div class="drop-zone" id="addimg-drop-zone">
            <div class="icon-circle"><i class="bi bi-camera"></i></div>
            <p class="fw-semibold mb-1">Drop an image or click to browse</p>
            <p class="small text-muted mb-0">JPG, PNG &mdash; up to 10&nbsp;MB</p>
        </div>` : `
        <div class="leaf-preview mb-2">
            <img src="${addImgState.preview}">
            ${!addImgState.analyzing ? `<button type="button" class="remove-btn" id="addimg-remove"><i class="bi bi-x"></i></button>` : `
                <div class="analyzing-overlay">
                    <i class="bi bi-arrow-repeat spin" style="font-size:1.6rem;"></i>
                    <p class="small mb-0 fw-semibold">Analyzing&hellip;</p>
                </div>`}
        </div>`}
    <input type="file" accept="image/*" capture="environment" id="addimg-file-input" style="display:none;">
    ${addImgState.error ? `<p class="small text-danger mt-2">${esc(addImgState.error)}</p>` : ''}
    <button type="button" class="btn btn-leaf w-100 mt-3" id="addimg-analyze-btn" ${(!addImgState.preview || addImgState.analyzing)?'disabled':''}>
        ${addImgState.analyzing ? 'Analyzing&hellip;' : 'Analyze &amp; Add to Tree'}
    </button>
    `;

    const zone = document.getElementById('addimg-drop-zone');
    const input = document.getElementById('addimg-file-input');
    if (zone){
        zone.onclick = () => input.click();
        zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragging'); };
        zone.ondragleave = () => zone.classList.remove('dragging');
        zone.ondrop = e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) addImgProcessFile(f); };
    }
    if (input) input.onchange = e => e.target.files[0] && addImgProcessFile(e.target.files[0]);
    const rm = document.getElementById('addimg-remove');
    if (rm) rm.onclick = () => { addImgState.preview=null; addImgState.file=null; renderAddImageModal(); };
    const analyzeBtn = document.getElementById('addimg-analyze-btn');
    if (analyzeBtn) analyzeBtn.onclick = addImgAnalyze;
}

function addImgProcessFile(file){
    if (!file.type.startsWith('image/')) return;
    addImgState.file = file;
    addImgState.error = null;
    const reader = new FileReader();
    reader.onload = e => { addImgState.preview = e.target.result; renderAddImageModal(); };
    reader.readAsDataURL(file);
}

async function addImgAnalyze(){
    if (!addImgState.file || !captureTargetTreeId) return;
    addImgState.analyzing = true; renderAddImageModal();
    try {
        const result = await analyzeImage(addImgState.file);
        const tree = trees.find(t => t.id === captureTargetTreeId);
        if (tree){
            const url = result.original_image || addImgState.preview;
            const timestamp = new Date();
            const saved = await apiAddImage(tree.id, { url, timestamp, result });
            const image = { id: String(saved.id), url, timestamp, result };
            tree.images.push(image);
            tree.aggregated = aggregateTree(tree.images);
            selectedImageIdByTree[tree.id] = image.id;
        }
        closeAddImageModal();
        render();
    } catch (e){
        addImgState.error = (e.message || 'Analysis failed') + ' \u2014 check that the analysis server is running.';
        addImgState.analyzing = false;
        renderAddImageModal();
    }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   INIT
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
window.addEventListener('DOMContentLoaded', loadTreesFromServer);

