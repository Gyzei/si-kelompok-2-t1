<?php
declare(strict_types=1);
require __DIR__.'/bridge.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($_SERVER['REQUEST_METHOD']!=='POST') {http_response_code(405);echo json_encode(['error'=>'Gunakan POST.']);exit;}
$raw=file_get_contents('php://input',false,null,0,4097);
$input=strlen($raw)<=4096?json_decode($raw,true):null;
if (!is_array($input)) {http_response_code(400);echo json_encode(['error'=>'Permintaan tidak valid.']);exit;}
$result=upstream($input);
if (isset($result['error'])) http_response_code($result['status']??502);
echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
