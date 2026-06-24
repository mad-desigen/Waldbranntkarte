<?php
declare(strict_types=1);

const DWD_BASE = 'https://www.dwd.de/DWD/warnungen/agrar/wbx/';

function fetchUrl(string $url): string {
    $ua = 'Mozilla/5.0 (compatible; WBI-GeoJSON/1.0)';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_USERAGENT => $ua,
            CURLOPT_HTTPHEADER => ['Referer: https://www.wettergefahren.de/'],
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $data = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($data === false || $status < 200 || $status >= 300) {
            throw new RuntimeException('DWD-Abruf fehlgeschlagen: HTTP '.$status.' '.$error);
        }
        return $data;
    }
    $ctx = stream_context_create(['http'=>['timeout'=>25,'header'=>"User-Agent: $ua\r\nReferer: https://www.wettergefahren.de/\r\n"]]);
    $data = @file_get_contents($url, false, $ctx);
    if ($data === false) throw new RuntimeException('DWD-Abruf fehlgeschlagen. PHP-cURL oder allow_url_fopen wird benötigt.');
    return $data;
}

if (($_GET['action'] ?? '') === 'image') {
    try {
        $day = max(0, min(4, (int)($_GET['day'] ?? 0)));
        $names = $day === 0 ? ['wbx_stationen.png'] : ["wbx_stationen{$day}.png", "wbx_stationen{$day}kl.png"];
        $last = null;
        foreach ($names as $name) {
            try {
                $data = fetchUrl(DWD_BASE.$name);
                if (substr($data,0,8) === "\x89PNG\r\n\x1a\n") {
                    header('Content-Type: image/png');
                    header('Cache-Control: public, max-age=900');
                    echo $data;
                    exit;
                }
            } catch (Throwable $e) { $last = $e; }
        }
        throw $last ?? new RuntimeException('Keine gültige PNG-Datei gefunden.');
    } catch (Throwable $e) {
        http_response_code(502);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
        exit;
    }
}
?><!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waldbrandgefahrenindex Deutschland</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font:14px system-ui,-apple-system,Segoe UI,sans-serif;color:#17342a;background:#e8efeb}.app{display:grid;grid-template-columns:340px 1fr;height:100%}.side{background:#fff;padding:20px;overflow:auto;border-right:1px solid #ccd8d1}.side h1{font-size:24px;margin:0 0 4px}.sub{color:#62736b;margin-bottom:18px}.group{padding:16px 0;border-top:1px solid #dce4df}.group label{display:block;font-weight:700;margin-bottom:7px}select,input[type=file],button{width:100%;padding:11px;border:1px solid #cbd7d0;border-radius:9px;background:#fff}button{background:#17613f;color:#fff;font-weight:700;cursor:pointer;margin-top:8px}button.secondary{background:#eef5f1;color:#174b35}.legend{display:grid;gap:8px}.legend div{display:flex;align-items:center;gap:9px}.sw{width:18px;height:18px;border-radius:4px;border:1px solid #aaa}.status{padding:10px;border-radius:8px;background:#f2f5f3;line-height:1.45}.mapwrap{position:relative}.map{height:100%}.loading{position:absolute;inset:0;background:#ffffffd9;display:grid;place-items:center;z-index:999}.loading[hidden]{display:none}.card{background:#fff;padding:18px 22px;border-radius:12px;box-shadow:0 8px 30px #0002}.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.stat{padding:10px;border:1px solid #dce4df;border-radius:8px}.stat b{display:block;font-size:19px}@media(max-width:800px){.app{grid-template-columns:1fr;grid-template-rows:auto 65vh}.side{border-right:0;border-bottom:1px solid #ccd8d1}}
</style>
</head>
<body>
<div class="app">
<aside class="side">
<h1>Waldbrandgefahrenindex</h1><div class="sub">DWD-Flächenkarte als Heatmap und GeoJSON</div>
<div class="group"><label for="day">Vorhersagetag</label><select id="day"></select></div>
<div class="group"><label>Datenquelle</label><div class="status">Die DWD-PNG wird über diese PHP-Datei serverseitig geladen. Dadurch entfällt die Browser-CORS-Sperre.</div><input id="file" type="file" accept="image/png"></div>
<div class="group"><label for="grid">GeoJSON-Auflösung</label><select id="grid"><option value="55,80">Grob · kleine Datei</option><option value="75,110" selected>Standard</option><option value="105,150">Fein · größere Datei</option></select><button id="create">GeoJSON erzeugen</button><button id="download" class="secondary" disabled>GeoJSON herunterladen</button><div class="stats"><div class="stat"><b id="count">0</b>Flächen</div><div class="stat"><b id="size">–</b>Dateigröße</div></div></div>
<div class="group"><label>Gefahrenstufen</label><div class="legend" id="legend"></div></div>
<div class="group"><div class="status" id="status">Bereit.</div></div>
</aside>
<main class="mapwrap"><div id="map" class="map"></div><div id="loading" class="loading"><div class="card">DWD-Karte wird geladen …</div></div></main>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const LEVELS={1:{c:'#fff6b3',t:'Sehr geringe Gefahr'},2:{c:'#ffd06a',t:'Geringe Gefahr'},3:{c:'#ff8b35',t:'Mittlere Gefahr'},4:{c:'#ec2626',t:'Hohe Gefahr'},5:{c:'#9d002f',t:'Sehr hohe Gefahr'}};
const BOUNDS=[[47.2,5.8],[55.1,15.1]];
const map=L.map('map',{zoomControl:true,attributionControl:false}).fitBounds(BOUNDS);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,opacity:.35}).addTo(map);
let image=null,overlay=null,vector=null,geojson=null;
const $=id=>document.getElementById(id);
Object.entries(LEVELS).forEach(([n,v])=>$('legend').insertAdjacentHTML('beforeend',`<div><span class="sw" style="background:${v.c}"></span>${n} · ${v.t}</div>`));
function dates(){let h='';for(let i=0;i<5;i++){const d=new Date();d.setDate(d.getDate()+i);h+=`<option value="${i}">${i?'+'+i+' Tag'+(i>1?'e':''):'Heute'} · ${new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(d)}</option>`}$('day').innerHTML=h}dates();
function status(t){$('status').textContent=t}function loadImage(src){$('loading').hidden=false;const im=new Image();im.onload=()=>{image=im;showImage(im);$('loading').hidden=true;status('DWD-Flächenkarte geladen.');};im.onerror=()=>{$('loading').hidden=true;status('Bild konnte nicht geladen werden.');};im.src=src}
function showImage(im){const c=document.createElement('canvas'),ctx=c.getContext('2d');const sx=Math.round(im.width*.015),sy=Math.round(im.height*.075),sw=Math.round(im.width*.965),sh=Math.round(im.height*.825);c.width=sw;c.height=sh;ctx.drawImage(im,sx,sy,sw,sh,0,0,sw,sh);const url=c.toDataURL('image/png');if(overlay)map.removeLayer(overlay);overlay=L.imageOverlay(url,BOUNDS,{opacity:.85}).addTo(map);map.fitBounds(BOUNDS)}
async function loadDay(){loadImage(`?action=image&day=${$('day').value}&t=${Date.now()}`)}
$('day').onchange=loadDay;$('file').onchange=e=>{const f=e.target.files[0];if(f)loadImage(URL.createObjectURL(f))};
function rgb(hex){return[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]}function nearest(r,g,b){let best=null,dist=1e9;for(const[n,v]of Object.entries(LEVELS)){const q=rgb(v.c),d=Math.hypot(r-q[0],g-q[1],b-q[2]);if(d<dist){dist=d;best=+n}}return dist<85?best:null}
function build(){if(!image){status('Zuerst eine DWD-Grafik laden.');return}const [cols,rows]=$('grid').value.split(',').map(Number);const c=document.createElement('canvas'),ctx=c.getContext('2d');const sx=Math.round(image.width*.015),sy=Math.round(image.height*.075),sw=Math.round(image.width*.965),sh=Math.round(image.height*.825);c.width=cols;c.height=rows;ctx.drawImage(image,sx,sy,sw,sh,0,0,cols,rows);const p=ctx.getImageData(0,0,cols,rows).data,features=[];const west=5.8,east=15.1,south=47.2,north=55.1;for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const i=(y*cols+x)*4,l=nearest(p[i],p[i+1],p[i+2]);if(!l)continue;const x1=west+(east-west)*x/cols,x2=west+(east-west)*(x+1)/cols,y1=north-(north-south)*y/rows,y2=north-(north-south)*(y+1)/rows;features.push({type:'Feature',properties:{wbi_stufe:l,wbi_text:LEVELS[l].t,farbe:LEVELS[l].c,prognosetag:+$('day').value},geometry:{type:'Polygon',coordinates:[[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]]]}})}geojson={type:'FeatureCollection',metadata:{titel:'Waldbrandgefahrenindex Deutschland',quelle:'Deutscher Wetterdienst – aus PNG-Flächenkarte vektorisiert',koordinatensystem:'WGS 84 / EPSG:4326',hinweis:'Abgeleitete Rasterpolygone, kein originärer amtlicher Vektordatensatz.'},features};if(vector)map.removeLayer(vector);vector=L.geoJSON(geojson,{style:f=>({stroke:false,fillColor:f.properties.farbe,fillOpacity:.72})}).addTo(map);const text=JSON.stringify(geojson);$('count').textContent=features.length.toLocaleString('de-DE');$('size').textContent=(new Blob([text]).size/1024).toLocaleString('de-DE',{maximumFractionDigits:1})+' KB';$('download').disabled=!features.length;status(features.length+' GeoJSON-Flächen erzeugt.')} $('create').onclick=build;
$('download').onclick=()=>{if(!geojson)return;const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(geojson,null,2)],{type:'application/geo+json'}));a.href=u;a.download='waldbrandgefahrenindex_'+new Date().toISOString().slice(0,10)+'.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
loadDay();
</script>
</body></html>