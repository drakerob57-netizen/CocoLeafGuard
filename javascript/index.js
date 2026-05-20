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
                    : state.imageWithoutBoxes;

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
                activeFilters: new Set(),      // empty = show all
            };

            // ── Build filter pill buttons ─────────────────────
            const filterPillsHtml = hasDetections
                ? `<div class="d-flex flex-wrap gap-2 justify-content-center mb-3" id="class-filters">
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
                                📊 Model Analysis
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
                setActiveViewBtn(btnNoBoxes);
                renderCanvas(state);
            });

            btnWithBoxes.addEventListener('click', () => {
                state.showBoxes = true;
                setActiveViewBtn(btnWithBoxes);
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
    const binCounts  = [];
    for (let lo = BIN_START; lo < 1.0; lo = Math.round((lo + BIN_SIZE) * 100) / 100) {
        const hi = Math.min(Math.round((lo + BIN_SIZE) * 100) / 100, 1.0);
        binLabels.push(`${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`);
        binCounts.push(detections.filter(d => d.confidence >= lo && d.confidence < hi).length);
    }
    // Put the 100% detections in the last bin
    if (binCounts.length > 0) binCounts[binCounts.length - 1] +=
        detections.filter(d => d.confidence >= 1.0).length;

    // ── Symptom area donut data ───────────────────────────────
    const symptomLabels  = symptoms.map(s => s.label);
    const symptomPercents = symptoms.map(s => s.percent);
    const symptomColors  = symptoms.map(s => s.color);

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
            <span>🔬 <strong>Severity Source:</strong> ${severitySource === 'rf' ? 'Random Forest' : 'Threshold Fallback'}</span>
            <span>🍃 <strong>Leaf Area:</strong> ${leafAreaPx} px</span>
            <span>🎯 <strong>Total Detections:</strong> ${detections.length}</span>
            <span>📌 <strong>Dominant Symptom:</strong> ${dominantSymptom}</span>
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
                  Share of the total affected leaf area attributed to each disease class.
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
                    datasets: [{
                        label: 'Detections',
                        data:  binCounts,
                        backgroundColor: binCounts.map((_, i) => {
                            const alpha = 0.55 + (i / binLabels.length) * 0.35;
                            return `rgba(51,184,47,${alpha.toFixed(2)})`;
                        }),
                        borderColor: '#1a7a17',
                        borderWidth: 1,
                        borderRadius: 4,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => ` ${ctx.parsed.y} detection(s)`,
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