<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>About Us</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">
    <link rel="stylesheet" href="../css/styles.css">
</head>
<body>
    <?php include 'header.php'; ?>
    <section class="AboutProject-section">
        <div class="container d-flex justify-content-center align-items-center">
            <div class="row text-center gap-4">
                <div class="col-12">
                    <h3 class="reveal">About The Project</h3>
                </div>
                <div class="col-12">
                    <h4 class="fw-normal text-muted reveal">Our research combines cutting-edge machine learning with agricultural expertise to create accessible tools for coconut farmers worldwide.</h4>
                </div>
            </div>
        </div>
    </section>
    <section class="project_overview-section reveal">
        <div class="container">
            <div class="row text-start gap-4">
                <div class="col-12">
                    <h5>Project Overview</h5>
                </div>
                <div class="col-12">
                    <h6 class="fw-normal">This project develops an AI-powered diagnostic tool for coconut leaf health assessment, leveraging state-of-the-art computer vision and machine learning techniques.</h6>
                </div>
                <div class="col-12">
                    <h6 class="fw-normal">By combining YOLOv8-seg for precise leaf segmentation with Random Forest classification for disease identification, we achieve high accuracy in detecting and categorizing various coconut leaf diseases.</h6>
                </div>
                <div class="col-12">
                    <h6 class="fw-normal">Our goal is to democratize access to agricultural expertise, enabling farmers to make informed decisions about crop health management and reducing economic losses due to undetected plant diseases.</h6>
                </div>
            </div>
        </div>
    </section>
    <section class="technical-section reveal">
        <div class="container">
            <div class="row text-center">
                <div class="col-12">
                    <img src="../img/gear.png" class="img-fluid">
                </div>
                <div class="col-12">
                    <h5>Technical Approach</h5>
                    <br>
                </div>
            </div>
            <div class="row">
                <div class="col-6">
                    <div class="card h-100 border-1 bg-white p-3">
                        <div class="col d-flex justify-content-start">
                            <img src="../img/vision.png" class="img-fluid">
                        </div>
                        <div class="card-body p-4">
                            <h5 class="card-title fw-bold">YOLOv8-seg</h5>
                            <p class="card-text text-muted">Instance segmentation model that identifies and isolates individual coconut leaves within images, enabling precise analysis of leaf regions.</p>
                            <ul>
                                <li>Multi class object detection</li>
                                <li>Pixel-level Segmentation</li>
                                <li>High accuracy on complex backgrounds</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="card h-100 border-1 bg-white p-3">
                        <div class="col d-flex justify-content-start">
                            <img src="../img/health.png" class="img-fluid">
                        </div>
                        <div class="card-body p-4">
                            <h5 class="card-title fw-bold">Random Forest</h5>
                            <p class="card-text text-muted">Ensemble learning method that classifies leaf health status and disease types based on features extracted from segmented regions.</p>
                            <ul>
                                <li>Robust overfitting</li>
                                <li>Handle multi class symptom</li>
                                <li>Provides confidence scores</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
    <section class="research-team-section reveal">
        <div class="container">
            <div class="row text-center">
                <div class="col-12">
                    <img src="../img/people.png" class="img-fluid">
                </div>
                <div class="col-12">
                    <h5 class="fw-bold">Research Team</h5>
                </div>
                <div class="col-12">
                    <p class="text-muted">A multidisciplinary team combining expertise in AI, agriculture, and software development</p>
                    <br>
                </div>
            </div>
            <div class="row d-flex justify-content-center gy-5">
                <div class="col-6">
                    <div class="card h-100 border-1 bg-white p-3">
                        <div class="col d-flex justify-content-start">
                            <img src="../img/programmer.png" class="img-fluid">
                        </div>
                        <div class="card-body p-3">
                            <h5 class="card-title fw-bold">Cristeto M. Turiano</h5>
                            <h6 class="text-primary">Lead Programmer</h6>
                            <p class="card-text text-muted">Responsible for designing and implementing the core AI algorithms and software architecture.</p>
                        </div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="card h-100 border-1 bg-white p-3">
                        <div class="col d-flex justify-content-start">
                            <img src="../img/pencil.png" class="img-fluid">
                        </div>
                        <div class="card-body p-3">
                            <h5 class="card-title fw-bold">Jan Drake L. Robillo</h5>
                            <h6 class="text-primary">UI/UX Designer</h6>
                            <p class="card-text text-muted">Responsible for creating intuitive user interfaces and seamless user experiences for the application.</p>
                        </div>
                    </div>
                </div>
                <div class="col-12 third-card">
                    <div class="card h-100 border-1 bg-white p-3">
                        <div class="col d-flex justify-content-start">
                            <img src="../img/document.png" class="img-fluid">
                        </div>
                        <div class="card-body p-3">
                            <h5 class="card-title fw-bold">Philip Emerson C. Jayoma</h5>
                            <h6 class="text-primary">Technical Writer</h6>
                            <p class="card-text text-muted">Responsible for creating comprehensive documentation and user guides for the application.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
    <section class="impact-section bg-primary text-center d-flex flex-column justify-content-center">
        <div class="container">
            <div class="row gap-3">
                <div class="col-12">
                    <h4 class="text-white reveal">Our Impact</h4>
                </div>
                <div class="col-12">
                    <h4 class="text-white fw-normal reveal">By making disease detection accessible and affordable, we aim to protect livelihoods, improve food security, and promote sustainable agricultural practices in coconut-growing regions worldwide.</h4>
                </div>
            </div>
        </div>
    </section>

    <script src="../javascript/index.js"></script>
</body>
</html>