document.addEventListener("DOMContentLoaded", function () {
    const observerOptions = {
        root: null, // use the viewport
        threshold: 0.15, // trigger when 15% of the element is visible
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                // Add the active class to trigger the CSS animation
                entry.target.classList.add("active");
                // Stop observing after the animation has triggered (optional)
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Attach the observer to all elements with the 'reveal' class
    const revealElements = document.querySelectorAll(".reveal");
    revealElements.forEach((el) => observer.observe(el));
});


// upload section

document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const contentArea = document.getElementById('tool-content-area');

    if (uploadArea) {
        // Trigger file input click
        uploadArea.addEventListener('click', () => fileInput.click());

        // File selection handling
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleUpload(fileInput.files[0]);
            }
        });

        // Drag and Drop support
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => uploadArea.classList.add('dragging'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('dragging'), false);
        });

        uploadArea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) {
                handleUpload(files[0]);
            }
        });
    }

    function handleUpload(file) {
        renderProcessingState();

        const formData = new FormData();
        formData.append('image', file);

        // Placeholder for the actual backend call
        fetch('process-image.php', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            renderResultsState(file, data);
        })
        .catch(error => {
            console.error('Error:', error);
            alert("An error occurred during analysis.");
        });
    }

    // Add this missing function to prevent the script from crashing
    function renderProcessingState() {
        contentArea.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="spinner-border text-success" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <h5 class="mt-3 fw-bold text-success">Analyzing Leaf...</h5>
                <p class="text-muted small">Please wait while the AI model processes the image.</p>
            </div>
        `;
    }   

    function renderResultsState(file, apiResponse) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const rawImageUrl = e.target.result;
            
            if (apiResponse.error) {
                alert("Error: " + apiResponse.error);
                return;
            }
            
            // Get the analyzed image URL from the AI, fallback to raw if missing
            const analyzedImageUrl = apiResponse.analyzed_image_url || rawImageUrl;
            
            contentArea.innerHTML = `
                <div class="col-md-6 mb-4">
                    <div class="card-custom text-center h-100 d-flex flex-column align-items-center">
                        <h4 class="fw-bold mb-3">Leaf Image</h4>
                        
                        <div class="btn-group mb-3" role="group" aria-label="Image Toggle">
                            <button type="button" class="btn btn-outline-success active" id="btn-analyzed" 
                                onclick="document.getElementById('display-img').src='${analyzedImageUrl}'; this.classList.add('active'); document.getElementById('btn-raw').classList.remove('active');">
                                Analyzed Result
                            </button>
                            <button type="button" class="btn btn-outline-success" id="btn-raw" 
                                onclick="document.getElementById('display-img').src='${rawImageUrl}'; this.classList.add('active'); document.getElementById('btn-analyzed').classList.remove('active');">
                                Original Image
                            </button>
                        </div>

                        <img src="${analyzedImageUrl}" id="display-img" class="img-fluid rounded mb-4" style="max-height: 400px; object-fit: contain;" alt="Leaf View">
                        
                        <button class="btn btn-upload-different mt-auto" onclick="location.reload();">Upload Different Image</button>
                    </div>
                </div>

                <div class="col-md-6 mb-4">
                    <div class="card-custom h-100">
                        <h4 class="fw-bold mb-4 text-center">Analysis Results</h4>
                        
                        <div class="card-result-severe mb-4">
                            <div class="d-flex justify-content-between align-items-start">
                                <div class="d-flex align-items-center">
                                    <span class="icon-severe me-3">⚠️</span>
                                    <div>
                                        <h6 class="status-text-severe mb-0">${apiResponse.status || 'Unknown'}</h6>
                                        <p class="small text-muted mb-0">${apiResponse.affected_area}%</p>
                                        <p class="small text-muted mb-0">Overall affected area</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <h6 class="fw-bold mb-3">Symptom Distribution</h6>
                        ${(apiResponse.symptoms || []).map(s => `
                            <div class="symptom-card">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div class="d-flex align-items-center">
                                        <span class="symptom-indicator me-3" style="background-color: ${s.color};"></span>
                                        <span>${s.label}</span>
                                    </div>
                                    <div class="text-end">
                                        <span class="fw-bold">${s.percent}%</span><br>
                                        <span class="small text-muted">${s.count} detected</span>
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
        };
        reader.readAsDataURL(file);
    }
});
