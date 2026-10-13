<?php
declare(strict_types=1);
require __DIR__.'/bridge.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($_SERVER['REQUEST_METHOD']!=='GET') {http_response_code(405);echo json_encode(['error'=>'Metode tidak didukung.']);exit;}
$id=is_string($_GET['id']??null)?$_GET['id']:'';
$request=['action'=>'profile','nidn'=>str_starts_with($id,'nidn:')?substr($id,5):($_GET['nidn']??''),
 'nuptk'=>str_starts_with($id,'nuptk:')?substr($id,6):($_GET['nuptk']??''),'nama'=>$_GET['nama']??''];
foreach (['nidn','nuptk','nama'] as $field) {
 if (!is_string($request[$field])||strlen($request[$field])>200) {http_response_code(400);echo json_encode(['error'=>'Identitas tidak valid.']);exit;}
}
$result=upstream($request);
if (isset($result['url'])&&str_starts_with($result['url'],'https://pddikti.kemdiktisaintek.go.id/')&&($_GET['redirect']??'')==='1') {
 header('Location: '.$result['url'],true,302);exit;
}
if (isset($result['error'])) http_response_code($result['status']??502);
echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
