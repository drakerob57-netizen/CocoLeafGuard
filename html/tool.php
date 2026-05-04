<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tool page</title>
    <link href = "../css/styles.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">
</head>
<body>
 <?php include 'header.php'; ?>

    <main class="bg-custom-off-white py-5 min-vh-100">
        <div class="container text-center mb-5">
            <h1 class="tool-title">Coconut Leaf Health Analysis</h1>
            <p class="tool-subtitle">Upload a clear image of a coconut leaf to receive AI-powered health assessment using YOLOv8-seg and Random Forest models.</p>
        </div>

        <div class="container">
            <div id="tool-content-area" class="row">
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

                <div class="col-md-6 mb-4">
                    <div class="card-custom text-center h-100 d-flex flex-column justify-content-center">
                        <h4 class="fw-bold mb-4">Analysis Results</h4>
                        <div class="py-5 text-muted">
                            <span style="font-size: 3rem;">insert loader</span>
                            <p class="mt-3">Upload an image to begin analysis</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="row mt-5">
                <div class="col-12">
                    <div class="card p-4" style="background-color: #EBF8F2; border-color: #C3E6CB; color: #155724; border-radius: 10px;">
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

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"></script>
    
    <script src="../javascript/index.js"></script>
    
</body>
</html>
