<?php
// audio/list.php - Optional API endpoint for listing audio files
// This provides a cleaner way to get the file list than parsing HTML

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Get all WAV files in the current directory
$files = glob('*.wav');

// Sort alphabetically
sort($files);

// Return as JSON
echo json_encode($files);