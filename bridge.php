<?php
declare(strict_types=1);
require_once __DIR__.'/native-api.php';
function upstream(array $request): array {
    $native=native_api($request);
    if ($native!==null) return $native;
    $node = 'C:\Program Files\nodejs\node.exe';
    if (!is_file($node)) $node = 'node';
    if (!function_exists('proc_open')) return ['error'=>'PHP belum dapat menjalankan koneksi API.', 'status'=>503];
    $process = @proc_open([$node,'--use-system-ca',__DIR__.'/scripts/live-api.mjs'],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,__DIR__,null,['bypass_shell'=>true]);
    if (!is_resource($process)) return ['error'=>'Koneksi API belum dapat dijalankan.', 'status'=>503];
    fwrite($pipes[0],json_encode($request));fclose($pipes[0]);
    $output=stream_get_contents($pipes[1]);fclose($pipes[1]);
    stream_get_contents($pipes[2]);fclose($pipes[2]);proc_close($process);
    $result=json_decode(trim($output),true);
    return is_array($result)?$result:['error'=>'API tidak mengembalikan respons yang valid.','status'=>502];
}
