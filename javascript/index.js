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

        fetch('process-image.php', { method: 'POST', body: formData })
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
                    </div>
                </div>
            `;

            // ── Initial render ────────────────────────────────
            renderCanvas(state);

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