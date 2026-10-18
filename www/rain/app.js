// ฟ้าฝน 3D — MapLibre 3D map + Open-Meteo forecast + Himawari-9 clouds (10-minute)

const DEFAULT_CENTER = [98.9853, 18.7883]; // Chiang Mai
const TZ = 'Asia/Bangkok';

// Himawari-9 AHI band 13 (10.4 µm clean IR) from NASA GIBS WMS, new image every 10 minutes
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
const HIMAWARI_LAYER = 'Himawari_AHI_Band13_Clean_Infrared';
const CLOUD_FRAMES = 12;        // 12 frames x 10 min = last 2 hours
const CLOUD_STEP_MIN = 10;
// IR grey levels: brighter = colder cloud top. Below CLOUD_MIN is treated as clear sky.
const CLOUD_MIN = 95;
const CLOUD_FULL = 200;

// LINE LIFF: no login needed; init lets LINE finish its redirect (liff.state) when opened via liff.line.me
const LIFF_ID = '1654067025-qbv7D0Bn';
if (window.liff) liff.init({ liffId: LIFF_ID }).catch((err) => console.warn('LIFF init failed', err));

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $('status').textContent = msg; };

const storage = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
};

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
const startView = storage.get('fahfon:view') || { center: DEFAULT_CENTER, zoom: 7.5 };

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: startView.center,
    zoom: startView.zoom,
    pitch: 55,
    bearing: -10,
    maxPitch: 80,
    attributionControl: { compact: true }
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showAccuracyCircle: true
});
map.addControl(geolocate, 'top-right');

let pointMarker = null;

// GPS tracking fires often; only refetch after moving ~1 km or every 10 minutes
let lastFix = null;
geolocate.on('geolocate', (e) => {
    const { longitude, latitude } = e.coords;
    const now = Date.now();
    if (lastFix) {
        const km = Math.hypot(longitude - lastFix.lng, latitude - lastFix.lat) * 111;
        if (km < 1 && now - lastFix.t < 10 * 60000) return;
    }
    lastFix = { lng: longitude, lat: latitude, t: now };
    if (pointMarker) { pointMarker.remove(); pointMarker = null; }
    loadForecast(longitude, latitude, 'ตำแหน่งของฉัน');
});
geolocate.on('error', () => setStatus('หาตำแหน่งไม่ได้ (ต้องอนุญาต GPS และเปิดผ่าน https)'));

map.on('click', (e) => {
    const { lng, lat } = e.lngLat;
    if (!pointMarker) pointMarker = new maplibregl.Marker({ color: '#4fc3f7' });
    pointMarker.setLngLat([lng, lat]).addTo(map);
    loadForecast(lng, lat);
});

map.on('moveend', () => {
    const c = map.getCenter();
    storage.set('fahfon:view', { center: [c.lng, c.lat], zoom: map.getZoom() });
});

// First symbol layer: weather layers go below it so place labels stay readable
function firstSymbolId() {
    const l = map.getStyle().layers.find((x) => x.type === 'symbol');
    return l ? l.id : undefined;
}

map.on('load', () => {
    addBaseLayers();
    initClouds();
    bindLayerToggles();

    const last = storage.get('fahfon:point');
    if (last) loadForecast(last[0], last[1], last[2]);
    else loadForecast(DEFAULT_CENTER[0], DEFAULT_CENTER[1], 'เชียงใหม่');

    // Ask for the user's location right away (browser shows a permission prompt).
    // The control finishes its setup asynchronously, so retry until trigger() accepts.
    let tries = 0;
    const tryLocate = () => { if (!geolocate.trigger() && ++tries < 20) setTimeout(tryLocate, 300); };
    tryLocate();
});

function addBaseLayers() {
    const below = firstSymbolId();

    // Satellite basemap (off by default)
    map.addSource('esri-sat', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri'
    });
    map.addLayer({ id: 'esri-sat', type: 'raster', source: 'esri-sat', layout: { visibility: 'none' } }, below);

    // Terrain (AWS Terrarium DEM, no key)
    const dem = {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
        attribution: 'Terrain: Mapzen/AWS'
    };
    map.addSource('dem', dem);
    map.addSource('dem-hill', dem); // separate source for hillshade avoids terrain artefacts
    map.addLayer({
        id: 'hillshade', type: 'hillshade', source: 'dem-hill',
        paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#1d2a3a' }
    }, below);
    map.setTerrain({ source: 'dem', exaggeration: 1.6 });
    map.setSky && map.setSky({
        'sky-color': '#5a8fd0', 'horizon-color': '#c7dcf2', 'fog-color': '#dfe9f5',
        'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4
    });
}

function setVisible(id, on) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

function bindLayerToggles() {
    $('lyr-terrain').onchange = (e) => {
        map.setTerrain(e.target.checked ? { source: 'dem', exaggeration: 1.6 } : null);
        setVisible('hillshade', e.target.checked);
    };
    $('lyr-sat').onchange = (e) => setVisible('esri-sat', e.target.checked);
    $('lyr-cloud').onchange = (e) => {
        cloud.visible = e.target.checked;
        $('cloudbar').style.display = e.target.checked ? '' : 'none';
        showFrame(cloud.index);
    };
    $('cloud-raw').onchange = (e) => { cloud.raw = e.target.checked; rebuildCloudLayers(); };
    $('lyr-radar').onchange = (e) => toggleRadar(e.target.checked);
    $('lyr-grid').onchange = (e) => toggleGrid(e.target.checked);
    $('grid-var').onchange = () => styleGrid();
}

// ---------------------------------------------------------------------------
// Himawari clouds: custom protocol turns IR greyscale into transparent clouds
// ---------------------------------------------------------------------------
// preload=false: only the shown frame fetches tiles; play/scrub turns on loading of all frames
const cloud = { times: [], index: 0, visible: true, raw: false, timer: null, preload: false };

const floorToStep = (d) => {
    const t = new Date(d);
    t.setUTCSeconds(0, 0);
    t.setUTCMinutes(Math.floor(t.getUTCMinutes() / CLOUD_STEP_MIN) * CLOUD_STEP_MIN);
    return t;
};
const isoMinute = (d) => d.toISOString().slice(0, 16) + ':00Z';

function wmsUrl(bbox, time, size = 256) {
    const p = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1',
        LAYERS: HIMAWARI_LAYER, SRS: 'EPSG:3857', STYLES: '',
        BBOX: bbox, WIDTH: size, HEIGHT: size,
        FORMAT: 'image/png', TRANSPARENT: 'TRUE', TIME: time
    });
    return `${GIBS_WMS}?${p}`;
}

function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

async function canvasToArrayBuffer(canvas) {
    const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise((res) => canvas.toBlob(res, 'image/png'));
    return blob.arrayBuffer();
}

// Map an IR grey value to an RGBA cloud pixel. Very cold tops (deep convection) get a blue/violet tint.
function cloudPixel(v) {
    if (v < CLOUD_MIN) return [0, 0, 0, 0];
    const a = Math.min(1, (v - CLOUD_MIN) / (CLOUD_FULL - CLOUD_MIN));
    if (v > 225) return [196, 160, 255, 240];
    if (v > 205) return [150, 205, 255, 235];
    const g = 200 + Math.round(55 * a);
    return [g, g, g, Math.round(40 + 190 * a)];
}
const CLOUD_LUT = Array.from({ length: 256 }, (_, v) => cloudPixel(v));

maplibregl.addProtocol('himawari', async (params, abortController) => {
    const u = new URL(params.url.replace('himawari://', 'https://x/'));
    const res = await fetch(wmsUrl(u.searchParams.get('bbox'), u.searchParams.get('time')),
        { signal: abortController.signal });
    if (!res.ok) throw new Error(`GIBS ${res.status}`);
    if (u.searchParams.get('raw') === '1') return { data: await res.arrayBuffer() };

    const bmp = await createImageBitmap(await res.blob());
    const cv = makeCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue; // no data
        const px = CLOUD_LUT[d[i]];
        d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = px[3];
    }
    ctx.putImageData(img, 0, 0);
    return { data: await canvasToArrayBuffer(cv) };
});

// GIBS publishes with some delay; probe a small image over SE Asia to find the newest frame that exists
async function findLatestCloudTime() {
    const bbox = '9900000,600000,12000000,2800000'; // ~89–108°E, 5–25°N
    let t = floorToStep(Date.now() - 10 * 60000);
    for (let i = 0; i < 12; i++) {
        try {
            const res = await fetch(wmsUrl(bbox, isoMinute(t), 32));
            if (res.ok && (res.headers.get('content-type') || '').startsWith('image')) {
                const bmp = await createImageBitmap(await res.blob());
                const cv = makeCanvas(32, 32);
                const ctx = cv.getContext('2d');
                ctx.drawImage(bmp, 0, 0);
                const d = ctx.getImageData(0, 0, 32, 32).data;
                let sum = 0;
                for (let k = 0; k < d.length; k += 4) sum += d[k] * (d[k + 3] > 0);
                if (sum > 0) return t;
            }
        } catch (err) {
            console.warn('cloud probe failed', err);
            break;
        }
        t = new Date(t.getTime() - CLOUD_STEP_MIN * 60000);
    }
    return floorToStep(Date.now() - 40 * 60000); // fallback guess
}

const cloudLayerId = (i) => `cloud-${i}`;

function rebuildCloudLayers() {
    const below = firstSymbolId();
    for (let i = 0; i < CLOUD_FRAMES; i++) {
        if (map.getLayer(cloudLayerId(i))) map.removeLayer(cloudLayerId(i));
        if (map.getSource(cloudLayerId(i))) map.removeSource(cloudLayerId(i));
    }
    cloud.times.forEach((t, i) => {
        map.addSource(cloudLayerId(i), {
            type: 'raster',
            tiles: [`himawari://tile?bbox={bbox-epsg-3857}&time=${isoMinute(t)}&raw=${cloud.raw ? 1 : 0}`],
            tileSize: 256,
            maxzoom: 6, // ~2 km data, overzoom beyond this
            attribution: 'Himawari-9 (JMA) via NASA GIBS'
        });
        map.addLayer({
            id: cloudLayerId(i), type: 'raster', source: cloudLayerId(i),
            layout: { visibility: 'none' },
            paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' }
        }, below);
    });
    showFrame(cloud.index);
}

function showFrame(i) {
    cloud.index = i;
    cloud.times.forEach((_, k) => {
        const id = cloudLayerId(k);
        if (!map.getLayer(id)) return;
        const current = k === i;
        // Hidden layers don't fetch tiles, so keep other frames hidden until animation is used
        setVisible(id, cloud.visible && (current || cloud.preload));
        map.setPaintProperty(id, 'raster-opacity', cloud.visible && current ? (cloud.raw ? 0.6 : 0.9) : 0);
    });
    const t = cloud.times[i];
    if (t) {
        $('frame').value = i;
        $('frame-time').textContent = t.toLocaleString('th-TH',
            { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
    }
}

async function initClouds() {
    setStatus('กำลังหาภาพเมฆล่าสุด…');
    const latest = await findLatestCloudTime();
    cloud.times = Array.from({ length: CLOUD_FRAMES },
        (_, k) => new Date(latest.getTime() - (CLOUD_FRAMES - 1 - k) * CLOUD_STEP_MIN * 60000));
    cloud.index = CLOUD_FRAMES - 1;
    $('frame').max = CLOUD_FRAMES - 1;
    rebuildCloudLayers();
    setStatus('ภาพเมฆล่าสุด ' + latest.toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }));

    $('frame').oninput = (e) => { stopPlay(); cloud.preload = true; showFrame(+e.target.value); };
    $('play').onclick = () => (cloud.timer ? stopPlay() : startPlay());

    // Refresh the frame list every 10 minutes
    setInterval(async () => {
        const t = await findLatestCloudTime();
        if (t.getTime() !== cloud.times.at(-1).getTime()) {
            cloud.times = Array.from({ length: CLOUD_FRAMES },
                (_, k) => new Date(t.getTime() - (CLOUD_FRAMES - 1 - k) * CLOUD_STEP_MIN * 60000));
            cloud.index = CLOUD_FRAMES - 1;
            rebuildCloudLayers();
        }
    }, 10 * 60000);
}

function startPlay() {
    cloud.preload = true;
    $('play').textContent = '❚❚';
    cloud.timer = setInterval(() => showFrame((cloud.index + 1) % cloud.times.length), 700);
}
function stopPlay() {
    $('play').textContent = '▶';
    clearInterval(cloud.timer);
    cloud.timer = null;
}

// ---------------------------------------------------------------------------
// RainViewer radar (latest frame)
// ---------------------------------------------------------------------------
async function toggleRadar(on) {
    if (!on) return setVisible('radar', false);
    if (map.getLayer('radar')) return setVisible('radar', true);
    try {
        const api = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
        const frame = api.radar.past.at(-1);
        map.addSource('radar', {
            type: 'raster',
            tiles: [`${api.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`],
            tileSize: 256,
            maxzoom: 7,
            attribution: 'Radar © RainViewer'
        });
        map.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.75 } }, firstSymbolId());
    } catch (err) {
        console.error(err);
        setStatus('โหลดเรดาร์ไม่สำเร็จ');
        $('lyr-radar').checked = false;
    }
}

// ---------------------------------------------------------------------------
// Open-Meteo: point forecast
// ---------------------------------------------------------------------------
const WMO = {
    0: ['ท้องฟ้าแจ่มใส', '☀️', '🌙'], 1: ['มีเมฆเล็กน้อย', '🌤️', '🌙'], 2: ['มีเมฆบางส่วน', '⛅', '☁️'],
    3: ['เมฆมาก', '☁️'], 45: ['หมอก', '🌫️'], 48: ['หมอกน้ำค้างแข็ง', '🌫️'],
    51: ['ฝนละอองเล็กน้อย', '🌦️'], 53: ['ฝนละออง', '🌦️'], 55: ['ฝนละอองหนาแน่น', '🌧️'],
    56: ['ฝนละอองเยือกแข็ง', '🌧️'], 57: ['ฝนละอองเยือกแข็ง', '🌧️'],
    61: ['ฝนเล็กน้อย', '🌦️'], 63: ['ฝนปานกลาง', '🌧️'], 65: ['ฝนหนัก', '🌧️'],
    66: ['ฝนเยือกแข็ง', '🌧️'], 67: ['ฝนเยือกแข็งหนัก', '🌧️'],
    71: ['หิมะเล็กน้อย', '🌨️'], 73: ['หิมะ', '🌨️'], 75: ['หิมะหนัก', '❄️'], 77: ['เกล็ดหิมะ', '🌨️'],
    80: ['ฝนตกเป็นช่วงๆ', '🌦️'], 81: ['ฝนตกเป็นช่วงปานกลาง', '🌧️'], 82: ['ฝนตกหนักเป็นช่วง', '⛈️'],
    85: ['หิมะเป็นช่วง', '🌨️'], 86: ['หิมะหนักเป็นช่วง', '❄️'],
    95: ['พายุฝนฟ้าคะนอง', '⛈️'], 96: ['พายุฝนฟ้าคะนอง ลูกเห็บ', '⛈️'], 99: ['พายุฝนฟ้าคะนอง ลูกเห็บหนัก', '⛈️']
};
const wmoText = (c) => (WMO[c] || ['ไม่ทราบ'])[0];
const wmoIcon = (c, isDay = 1) => {
    const w = WMO[c];
    if (!w) return '❔';
    return !isDay && w[2] ? w[2] : w[1];
};
const windDir = (deg) => ['เหนือ', 'ตอ.เฉียงเหนือ', 'ตะวันออก', 'ตอ.เฉียงใต้', 'ใต้', 'ตต.เฉียงใต้', 'ตะวันตก', 'ตต.เฉียงเหนือ'][Math.round(deg / 45) % 8];

let forecastReq = 0;

async function loadForecast(lng, lat, label) {
    const req = ++forecastReq;
    $('now-place').textContent = (label ? label + ' · ' : '') + `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
    $('now-desc').textContent = 'กำลังโหลดพยากรณ์…';
    storage.set('fahfon:point', [lng, lat, label || null]);

    const p = new URLSearchParams({
        latitude: lat.toFixed(4), longitude: lng.toFixed(4), timezone: 'auto', forecast_days: 7,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,is_day',
        hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,is_day',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max'
    });
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        const data = await res.json();
        if (req !== forecastReq) return; // a newer request superseded this one
        renderForecast(data);
    } catch (err) {
        console.error(err);
        if (req === forecastReq) $('now-desc').textContent = 'โหลดพยากรณ์ไม่สำเร็จ';
    }
}

function renderForecast(d) {
    const c = d.current;
    $('now-icon').textContent = wmoIcon(c.weather_code, c.is_day);
    $('now-temp').textContent = `${Math.round(c.temperature_2m)}°`;
    $('now-desc').textContent = `${wmoText(c.weather_code)} · รู้สึกเหมือน ${Math.round(c.apparent_temperature)}°`;

    const stat = (v, l) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`;
    $('stats').innerHTML =
        stat(`${c.relative_humidity_2m}%`, 'ความชื้น') +
        stat(`${(+c.precipitation).toFixed(1)} มม.`, 'ฝนตอนนี้') +
        stat(`${c.cloud_cover}%`, 'เมฆ') +
        stat(`${Math.round(c.wind_speed_10m)} กม./ชม.`, `ลม ${windDir(c.wind_direction_10m)}`) +
        stat(`${d.daily.precipitation_probability_max[0] ?? '-'}%`, 'โอกาสฝนวันนี้') +
        stat(`${d.elevation} ม.`, 'ความสูง');

    // Next 24 hours starting from the current hour
    const nowHour = c.time.slice(0, 13);
    const start = Math.max(0, d.hourly.time.findIndex((t) => t.slice(0, 13) === nowHour));
    const h = d.hourly;
    const rows = Array.from({ length: 24 }, (_, k) => start + k).filter((i) => i < h.time.length).map((i) => ({
        hour: h.time[i].slice(11, 13),
        temp: h.temperature_2m[i],
        pop: h.precipitation_probability[i] ?? 0,
        rain: h.precipitation[i],
        code: h.weather_code[i],
        day: h.is_day[i]
    }));
    $('hourly').innerHTML = hourlyChart(rows);

    $('daily').innerHTML = d.daily.time.map((t, i) => {
        const date = new Date(t + 'T00:00:00');
        const name = i === 0 ? 'วันนี้' : date.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric' });
        return `<div class="row">
            <div>${name}</div>
            <div title="${wmoText(d.daily.weather_code[i])}">${wmoIcon(d.daily.weather_code[i])}</div>
            <div class="rain">💧 ${d.daily.precipitation_probability_max[i] ?? '-'}% · ${d.daily.precipitation_sum[i]} มม.</div>
            <div class="temps">${Math.round(d.daily.temperature_2m_max[i])}° <span>${Math.round(d.daily.temperature_2m_min[i])}°</span></div>
        </div>`;
    }).join('');
}

// Inline SVG: rain-chance bars + temperature line
function hourlyChart(rows) {
    const W = 320, H = 150, top = 26, bottom = 118, n = rows.length;
    const step = W / n;
    const temps = rows.map((r) => r.temp);
    const tMin = Math.min(...temps) - 1, tMax = Math.max(...temps) + 1;
    const ty = (t) => top + (bottom - top) * (1 - (t - tMin) / (tMax - tMin));
    const bars = rows.map((r, i) => {
        const bh = (bottom - top) * r.pop / 100;
        return `<rect x="${i * step + 2}" y="${bottom - bh}" width="${step - 4}" height="${bh}" rx="2" fill="var(--rain)" opacity="0.55"><title>${r.hour}:00 โอกาสฝน ${r.pop}% · ${r.rain} มม.</title></rect>`;
    }).join('');
    const line = rows.map((r, i) => `${i ? 'L' : 'M'}${(i + 0.5) * step},${ty(r.temp)}`).join('');
    const labels = rows.map((r, i) => i % 3 ? '' : `
        <text x="${(i + 0.5) * step}" y="${ty(r.temp) - 8}" text-anchor="middle" font-size="10" fill="var(--warm)">${Math.round(r.temp)}°</text>
        <text x="${(i + 0.5) * step}" y="${bottom + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">${r.hour}</text>
        <text x="${(i + 0.5) * step}" y="${bottom + 28}" text-anchor="middle" font-size="11">${wmoIcon(r.code, r.day)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟพยากรณ์รายชั่วโมง">
        ${bars}
        <path d="${line}" fill="none" stroke="var(--warm)" stroke-width="2" stroke-linejoin="round"/>
        ${labels}
    </svg>`;
}

// ---------------------------------------------------------------------------
// Open-Meteo: 3D forecast grid over the current view
// ---------------------------------------------------------------------------
const GRID_N = 10; // 10 x 10 = 100 points per request
const GRID_VARS = {
    temperature_2m: { min: 10, max: 38, unit: '°C', colors: ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c'] },
    precipitation: { min: 0, max: 10, unit: 'มม.', colors: ['#e0f3f8', '#90caf9', '#3b82f6', '#1e3a8a', '#7c3aed'] },
    cloud_cover: { min: 0, max: 100, unit: '%', colors: ['#1e293b', '#475569', '#94a3b8', '#cbd5e1', '#f8fafc'] },
    relative_humidity_2m: { min: 30, max: 100, unit: '%', colors: ['#fef3c7', '#a7f3d0', '#5eead4', '#0ea5e9', '#1e40af'] }
};
let gridCellMeters = 10000;

async function toggleGrid(on) {
    $('grid-var').disabled = !on;
    $('grid-legend').hidden = !on;
    if (!on) return setVisible('grid', false);

    const b = map.getBounds();
    const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
    const dx = (east - west) / GRID_N, dy = (north - south) / GRID_N;
    const lats = [], lons = [], cells = [];
    for (let r = 0; r < GRID_N; r++) {
        for (let c = 0; c < GRID_N; c++) {
            const x0 = west + c * dx, y0 = south + r * dy;
            lats.push((y0 + dy / 2).toFixed(3));
            lons.push((x0 + dx / 2).toFixed(3));
            const pad = 0.08; // gap between columns
            cells.push([[x0 + dx * pad, y0 + dy * pad], [x0 + dx * (1 - pad), y0 + dy * pad],
                [x0 + dx * (1 - pad), y0 + dy * (1 - pad)], [x0 + dx * pad, y0 + dy * (1 - pad)], [x0 + dx * pad, y0 + dy * pad]]);
        }
    }
    gridCellMeters = dy * 111000;

    setStatus('กำลังโหลดกริดพยากรณ์…');
    try {
        const p = new URLSearchParams({
            latitude: lats.join(','), longitude: lons.join(','),
            current: Object.keys(GRID_VARS).join(','), timezone: 'auto'
        });
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        let data = await res.json();
        if (!Array.isArray(data)) data = [data];

        const fc = {
            type: 'FeatureCollection',
            features: data.map((d, i) => ({
                type: 'Feature',
                properties: Object.fromEntries(Object.keys(GRID_VARS).map((k) => [k, d.current[k]])),
                geometry: { type: 'Polygon', coordinates: [cells[i]] }
            }))
        };
        if (map.getSource('grid')) map.getSource('grid').setData(fc);
        else {
            map.addSource('grid', { type: 'geojson', data: fc, attribution: 'Forecast © Open-Meteo' });
            map.addLayer({ id: 'grid', type: 'fill-extrusion', source: 'grid', paint: { 'fill-extrusion-opacity': 0.7 } }, firstSymbolId());
        }
        setVisible('grid', true);
        styleGrid();
        setStatus('กริดพยากรณ์ ' + new Date().toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
        console.error(err);
        setStatus('โหลดกริดไม่สำเร็จ');
        $('lyr-grid').checked = false;
        $('grid-var').disabled = true;
        $('grid-legend').hidden = true;
    }
}

function styleGrid() {
    if (!map.getLayer('grid')) return;
    const key = $('grid-var').value;
    const v = GRID_VARS[key];
    const stops = v.colors.flatMap((col, i) => [v.min + (v.max - v.min) * i / (v.colors.length - 1), col]);
    const val = ['coalesce', ['get', key], v.min];
    map.setPaintProperty('grid', 'fill-extrusion-color', ['interpolate', ['linear'], val, ...stops]);
    // Column height scales with cell size so it looks right at any zoom
    map.setPaintProperty('grid', 'fill-extrusion-height',
        ['interpolate', ['linear'], val, v.min, gridCellMeters * 0.03, v.max, gridCellMeters * 0.4]);
    $('grid-legend').innerHTML = `<div class="bar" style="background:linear-gradient(90deg,${v.colors.join(',')})"></div>
        <div class="ticks"><span>${v.min}</span><span>${v.unit}</span><span>${v.max}+</span></div>`;
}

// ---------------------------------------------------------------------------
// Bottom sheet (phone)
// ---------------------------------------------------------------------------
if (window.matchMedia('(max-width: 720px)').matches) $('layers').open = false;

$('sheet-toggle').onclick = () => {
    const collapsed = $('sheet').classList.toggle('collapsed');
    document.body.classList.toggle('sheet-collapsed', collapsed);
};
