<?php
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['leaf_image'])) {
    $uploadDir = '../uploads/';
    if (!is_dir($uploadDir)) mkdir($uploadDir);
    
    $file = $_FILES['leaf_image'];
    $filePath = $uploadDir . time() . '_' . basename($file['name']);

    if (move_uploaded_file($file['tmp_name'], $filePath)) {
        // EXECUTE MODEL HERE: 
        // In a real setup, you would use shell_exec() to run your YOLOv8 python script
        // and capture the output. Example:
        // $output = shell_exec("python3 predict.py --source " . escapeshellarg($filePath));
        
        // Placeholder response matching your "After" image:
        $response = [
            "status" => "Severe",
            "affected_area" => 99.6,
            "symptoms" => [
                ["label" => "Yellowing", "percent" => 39.5, "color" => "#ffc107"],
                ["label" => "Gray Spots", "percent" => 35.6, "color" => "#6c757d"],
                ["label" => "Leaf Rots", "percent" => 20.2, "color" => "#dc3545"]
            ],
            "recommendations" => [
                "Isolate affected plants immediately",
                "Remove all severely infected leaves",
                "Apply intensive fungicide treatment"
            ]
        ];
        echo json_encode($response);
    } else {
        echo json_encode(["error" => "Upload failed"]);
    }
}
?>