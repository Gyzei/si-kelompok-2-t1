<?php
declare(strict_types=1);

// Native transport keeps TLS validation active and avoids starting Node per request.
function native_api(array $input): ?array {
    if (!function_exists('curl_init') || !defined('CURLSSLOPT_NATIVE_CA')) return null;
    $action=$input['action']??'';
    if (!in_array($action,['pt','prodi','dosen','search'],true)) return null;
    $semester=$input['semester']??'20261';
    if (!is_string($semester)||!preg_match('/^\d{4}[12]$/',$semester)) return ['error'=>'Semester tidak valid.','status'=>400];
    $body=null;
    if ($action==='pt') {
        $page=filter_var($input['page']??1,FILTER_VALIDATE_INT);
        if ($page===false||$page<1||$page>1000) return ['error'=>'Halaman tidak valid.','status'=>400];
        $endpoint='/v2/pt/search/filter?limit=15&page='.$page.'&provinsi=Prov.%20Aceh';
    } elseif ($action==='search') {
        $query=$input['query']??'';
        if (!is_string($query)||strlen(trim($query))<3||strlen($query)>120) return ['error'=>'Ketik minimal 3 karakter untuk pencarian API.','status'=>400];
        $endpoint='/pencarian/dosen/'.rawurlencode(trim($query));
    } else {
        $id=$input['id']??'';
        if (!is_string($id)||!preg_match('/^[A-Za-z0-9_-]{20,180}={0,2}$/',$id)) return ['error'=>'ID sumber tidak valid.','status'=>400];
        $endpoint=$action==='prodi'?'/pt/prodi/'.$id.'/'.$semester:'/dosen/homebase?semester='.$semester;
        if ($action==='dosen') $body=json_encode(['id'=>$id]);
    }
    $retryAfter=null;
    $curl=curl_init('https://pddikti.kemdiktisaintek.go.id/api'.$endpoint);
    curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>20,
        CURLOPT_ENCODING=>'',CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_SSL_OPTIONS=>CURLSSLOPT_NATIVE_CA,
        CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/json','Origin: https://pddikti.kemdiktisaintek.go.id'],
        CURLOPT_REFERER=>'https://pddikti.kemdiktisaintek.go.id/perguruan-tinggi',CURLOPT_USERAGENT=>'Mozilla/5.0',
        CURLOPT_HEADERFUNCTION=>static function($handle,string $header)use(&$retryAfter):int{
            if (stripos($header,'Retry-After:')===0) $retryAfter=trim(substr($header,12));return strlen($header);
        }]);
    if ($body!==null) curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body]);
    $raw=curl_exec($curl);$errno=curl_errno($curl);$status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
    if (in_array($errno,[35,60,77],true)) return null; // Fall back to Node's Windows certificate store.
    if ($raw===false) return ['error'=>$errno===28?'PDDIKTI belum merespons dalam 20 detik. Coba lagi beberapa saat.':'Koneksi ke PDDIKTI terputus. Coba lagi beberapa saat.','status'=>502];
    if ($status<200||$status>=300) return ['error'=>'PDDIKTI merespons HTTP '.$status.'. Coba lagi beberapa saat.','status'=>$status>=400&&$status<=599?$status:502,'retryAfter'=>$retryAfter];
    $payload=json_decode($raw,true);
    if (!is_array($payload)||($payload['status']??'')!=='success') return ['error'=>'Format respons PDDIKTI tidak sesuai.','status'=>502];
    $data=$payload['data']??null;$fetched=gmdate('Y-m-d\TH:i:s\Z');
    if ($action==='pt') {
        if (!is_array($data)||!is_array($data['data']??null)||($data['page']??null)!==$page||!is_int($data['totalItems']??null)||!is_int($data['totalPages']??null)) return ['error'=>'Format pagination PDDIKTI tidak sesuai.','status'=>502];
        $items=[];
        foreach ($data['data'] as $pt) {
            if (empty($pt['id_sp'])||($pt['provinsi_pt']??'')!=='Prov. Aceh') return ['error'=>'Daftar PT tidak sesuai filter Aceh.','status'=>502];
            $items[]=['id'=>$pt['id_sp'],'nama'=>trim($pt['nama_pt']??''),'status'=>trim($pt['status_pt']??''),'kab_kota'=>trim($pt['kab_kota_pt']??''),'jenis'=>trim($pt['jenis_pt']??''),'jumlah_prodi_api'=>$pt['jumlah_prodi']??null];
        }
        return ['items'=>$items,'page'=>$page,'totalPages'=>$data['totalPages'],'totalItems'=>$data['totalItems'],'fetched_at'=>$fetched];
    }
    if ($data===null&&in_array($action,['dosen','search'],true)) $data=[];
    if (!is_array($data)||!array_is_list($data)) return ['error'=>'Format daftar PDDIKTI tidak sesuai.','status'=>502];
    $items=[];
    foreach ($data as $row) {
        if ($action==='prodi') {
            if (empty($row['id_sms'])||empty($row['nama_prodi'])) return ['error'=>'Identitas prodi tidak tersedia.','status'=>502];
            $items[]=['id'=>$row['id_sms'],'id_pt'=>$id,'nama'=>trim($row['nama_prodi']),'kode'=>(string)($row['kode_prodi']??''),'jenjang'=>(string)($row['jenjang_prodi']??''),'status'=>(string)($row['status_prodi']??''),'jumlah_dosen_api'=>$row['jumlah_dosen']??null];
        } else {
            $fields=$action==='search'?['id','nama','nidn','nuptk','nama_pt','nama_prodi']:['id_sdm','nama_dosen','nidn','nuptk','pendidikan','status_aktif','ikatan_kerja'];
            if (empty($row[$action==='search'?'nama':'nama_dosen'])) return ['error'=>'Nama dosen tidak tersedia dari sumber.','status'=>502];
            $item=[];foreach ($fields as $field) $item[$field]=trim((string)($row[$field]??''));$items[]=$item;
        }
    }
    return ['items'=>$items,'empty_response'=>($payload['data']??null)===null,'fetched_at'=>$fetched];
}
