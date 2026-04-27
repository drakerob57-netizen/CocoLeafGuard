<?php
header('Content-Type: application/json');

// Allow the script to run for up to 5 minutes
set_time_limit(300); 

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['image'])) {
    $uploadDir = '../uploads/';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);

    $file = $_FILES['image'];
    $targetFile = $uploadDir . time() . '_' . basename($file['name']);

    if (move_uploaded_file($file['tmp_name'], $targetFile)) {
        // Ensure you are calling the correct python path (e.g., 'python' or 'python3')
        $pythonPath = 'python3'; 
        $scriptPath = '../ai_model/predict.py';
        
        $escapedImage = escapeshellarg($targetFile);
        $command = "$pythonPath $scriptPath $escapedImage 2>&1";
        
        $output = shell_exec($command);
        $aiResults = json_decode($output, true);

        if ($aiResults) {
            echo json_encode($aiResults);
        } else {
            echo json_encode([
                "error" => "AI processing failed.",
                "debug_raw" => $output 
            ]);
        }
    } else {
        echo json_encode(["error" => "Failed to move uploaded file."]);
    }
}
?>