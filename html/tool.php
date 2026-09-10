<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tool page</title>
    <link href="../css/styles.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
</head>
<body>
<?php include 'header.php'; ?>

<main class="bg-custom-off-white py-5 min-vh-100 reveal">
    <div class="container text-center mb-4">
        <h1 class="tool-title">Coconut Leaf Health Assessment</h1>
        <p class="tool-subtitle">Walk each tree through a guided assessment &mdash; pin its GPS location, capture a leaf image, and get an AI-powered health analysis using YOLOv8-seg and Random Forest models.</p>
    </div>

    <!--  Session summary bar -->
    <div class="summary-bar mb-4">
        <div class="container py-3">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
                <div>
                    <h2 class="h6 mb-0 fw-bold" id="summary-title">Inspection Session</h2>
                    <p class="small text-muted mb-0" id="summary-subtitle">No trees assessed yet</p>
                </div>
                <div class="d-flex align-items-center gap-4 flex-wrap">
                    <div class="summary-stat">
                        <div class="summary-stat-icon" style="background:#eef9ee;color:var(--leaf-green);"><i class="bi bi-tree"></i></div>
                        <div>
                            <p class="mb-0 fw-bold" id="stat-trees">0</p>
                            <p class="mb-0 small text-muted">Trees</p>
                        </div>
                    </div>
                    <div class="summary-stat">
                        <div class="summary-stat-icon" style="background:#eaf3ff;color:#0d6efd;"><i class="bi bi-images"></i></div>
                        <div>
                            <p class="mb-0 fw-bold" id="stat-images">0</p>
                            <p class="mb-0 small text-muted">Images</p>
                        </div>
                    </div>
                    <div class="d-flex align-items-center gap-2 flex-wrap" id="summary-sev-badges"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- â”€â”€ Main layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
    <div class="container">
        <div class="assess-layout">

            <!-- Sidebar: tree list -->
            <div class="assess-sidebar" id="assess-sidebar">
                <div class="d-flex align-items-center justify-content-between mb-3">
                    <h2 class="small fw-bold text-uppercase text-muted mb-0" style="letter-spacing:.05em;">Assessed Trees</h2>
                    <span class="small text-muted bg-light px-2 py-1 rounded-pill" id="tree-count-badge">0 entries</span>
                </div>

                <button type="button" class="new-assessment-cta mb-3" onclick="openWizard()">
                    <span class="icon-box"><i class="bi bi-plus-lg"></i></span>
                    <span>
                        <span class="d-block fw-semibold" style="color:#1b5e20;font-size:.9rem;">Add New Tree Assessment</span>
                        <span class="d-block small" style="color:#3d8b3a;">GPS confirm &rarr; leaf capture &rarr; analyze</span>
                    </span>
                    <i class="bi bi-chevron-right ms-auto" style="color:#7cc57a;"></i>
                </button>

                <div id="tree-list"></div>

                <div class="mini-map" id="mini-map" style="display:none;">
                    <div id="mini-map-container"></div>
                    <div class="pin-breakdown" id="pin-breakdown" aria-live="polite"></div>
                </div>
                <div class="mini-map-caption" id="mini-map-caption" style="display:none; border:1px solid #e9ecef; border-top:none; border-radius:0 0 12px 12px;">
                    <i class="bi bi-geo-alt text-success"></i> <span id="mini-map-text">Inspection coverage</span>
                </div>
            </div>

            <!-- Detail panel -->
            <div class="assess-detail">
                <div class="detail-panel" id="detail-panel">
                    <div class="empty-detail">
                        <i class="bi bi-tree" style="font-size:3.5rem;color:#e9ecef;"></i>
                        <p class="mt-3 mb-0">Select a tree, or start a new assessment, to view details here.</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!--  Model info footer  -->
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

    <!--  WIZARD MODAL (new tree assessment)  -->
    <div class="modal-backdrop-custom" id="wizard-backdrop" style="display:none;" onclick="if(event.target===this) closeWizard()">
        <div class="wizard-box">
            <div class="wizard-header">
                <div class="d-flex align-items-start justify-content-between">
                    <div>
                        <div class="d-flex align-items-center gap-2">
                            <span style="width:28px;height:28px;border-radius:8px;background:var(--leaf-green);color:#fff;display:flex;align-items:center;justify-content:center;">
                                <i class="bi bi-tree" style="font-size:.85rem;"></i>
                            </span>
                            <h3 class="h6 mb-0 fw-bold">New Tree Assessment</h3>
                            <span class="small text-muted" id="wizard-tree-number">#1</span>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm btn-light rounded-circle" onclick="closeWizard()"><i class="bi bi-x-lg"></i></button>
                </div>
                <div class="step-indicator" id="step-indicator"></div>
            </div>
            <div class="wizard-body" id="wizard-body"></div>
        </div>
    </div>

    <!-- ADD IMAGE MODAL (existing tree) -->
    <div class="modal-backdrop-custom" id="addimg-backdrop" style="display:none;" onclick="if(event.target===this) closeAddImageModal()">
        <div class="wizard-box" style="max-width:520px;">
            <div class="wizard-header d-flex align-items-center justify-content-between">
                <div>
                    <h3 class="h6 mb-0 fw-bold">Add Image</h3>
                    <p class="small text-muted mb-0" id="addimg-subtitle">&nbsp;</p>
                </div>
                <button type="button" class="btn btn-sm btn-light rounded-circle" onclick="closeAddImageModal()"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="wizard-body" id="addimg-body"></div>
        </div>
    </div>

    <div class="modal-backdrop-custom analysis-modal" id="analysis-backdrop" style="display:none;" onclick="if(event.target===this) closeAnalysisModal()">
        <div class="wizard-box">
            <div class="wizard-header d-flex align-items-start justify-content-between">
                <div>
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <span style="width:28px;height:28px;border-radius:8px;background:#0d6efd;color:#fff;display:flex;align-items:center;justify-content:center;">
                            <i class="bi bi-bar-chart" style="font-size:.85rem;"></i>
                        </span>
                        <h3 class="h6 mb-0 fw-bold">Model Analysis</h3>
                    </div>
                    <p class="small text-muted mb-0" id="analysis-subtitle">&nbsp;</p>
                </div>
                <button type="button" class="btn btn-sm btn-light rounded-circle" onclick="closeAnalysisModal()"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="wizard-body" id="analysis-body"></div>
        </div>
    </div>

</main>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"></script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="../javascript/index.js?v=20260908-camera-device"></script>
</body>
</html>
