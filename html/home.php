<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Home Page</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">
    <link rel="stylesheet" href="../css/styles.css">
</head>
<body>
    <?php include 'header.php'; ?>
    <section class="hero-section">
        <div class="container d-flex vh-100 justify-content-center align-items-center">
            <div class="row text-start gap-4">
                <div class="col-12">
                    <h3 class="text-white">Coconut Leaf Health Assessment Using AI</h3>
                </div>
                <div class="col-12">
                    <h5 class="text-white fw-normal">Advanced detection and classification of coconut leaf diseases using YOLOv8-seg and Random Forest machine learning models.</h5>
                </div>
                <div class="col-12">
                    <button type="button" class="btn btn-primary btn-lg fs-6 try-button">Try the tool -></button>
                </div>
            </div>
        </div>
    </section>
    <section class="problem-section">
        <div class="container">
            <div class="row problem-section-upper text-center">
                <div class="col">
                    <h3>The Problem</h3>
                    <p>Coconut farmers face significant challenges in early disease detection, leading to crop losses and reduced yields. Manual inspection is time-consuming, inconsistent, and requires expert knowledge.</p>
                </div>
            </div>
            <div class="row gap-0 problem-section-lower">
                <div class="col-4">
                    <div class="card h-100 border-1 bg-white p-3">
                        <div class="col d-flex justify-content-start">
                            <img src="../img/coco_logo.png" class="img-fluid">
                        </div>
                        <div class="card-body p-4">
                            <h5 class="card-title fw-bold">Early Detection</h5>
                            <p class="card-text text-muted">Identify diseases at early stages before they spread and cause irreversible damage to plantations.</p>
                        </div>
                    </div>
                </div>
                <div class="col-4">
                    <div class="card h-100 border-1 bg-white p-3">
                        <div class="col d-flex justify-content-start">
                            <img src="../img/coco_logo.png" class="img-fluid">
                        </div>
                        <div class="card-body p-4">
                            <h5 class="card-title fw-bold">Accurate Classification</h5>
                            <p class="card-text text-muted">Precisely classify disease types using advanced machine learning for targeted treatment strategies.</p>
                        </div>
                    </div>
                </div>
                <div class="col-4">
                    <div class="card h-100 border-1 bg-white p-3">
                        <div class="col d-flex justify-content-start">
                            <img src="../img/coco_logo.png" class="img-fluid">
                        </div>
                        <div class="card-body p-4">
                            <h5 class="card-title fw-bold">Accessible Technology</h5>
                            <p class="card-text text-muted">Provide farmers with easy-to-use tools that democratize access to agricultural expertise.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
    <section class="sdg-section">
        <div class="container">
            <div class="row">
                <div class="col-6">
                    <h4>Aligned with SDG 15</h4>
                    <br>
                    <h4 class="text-muted fw-normal">Our project supports Sustainable Development Goal 15: Life on Land, by protecting terrestrial ecosystems and promoting sustainable agriculture.</h4>
                    
                    <ul>
                        <li>Prevent land degradation through early disease intervention</li>
                        <li>Promote sustainable farming practices with precision agriculture</li>
                        <li>Support biodiversity by reducing chemical pesticide usage</li>
                    </ul>
                </div>
                <div class="col-6">
                    <div class="card h-100 border-0 shadow bg-white p-3">
                        <div class="col d-flex justify-content-center">
                            <img src="../img/coco_logo.png" class="img-fluid">
                        </div>
                        <div class="card-body p-4 text-center">
                            <h5 class="card-title fw-bold">Life on Land</h5>
                            <p class="card-text text-muted">Protecting, restoring and promoting sustainable use of terrestrial ecosystems, sustainably managing forests, combating desertification, and halting biodiversity loss.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
    <section class="launch-tool-section bg-primary text-center d-flex flex-column justify-content-center">
        <div class="container">
            <div class="row gap-3">
                <div class="col-12">
                    <h4 class="text-white">Ready to Analyze Your Coconut Leaves?</h4>
                </div>
                <div class="col-12">
                    <h4 class=" fw-normal text-white">Upload an image and get instant AI-powered health assessment results.</h4>
                </div>
                <div class="col-12">
                    <button type="button" class="btn bg-white btn-lg px-4 text-primary fs-6 try-button">Launch the Tool -></button>
                </div>
            </div>
        </div>
    </section>

</body>
</html>