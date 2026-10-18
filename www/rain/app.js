let userid;

function initializeLiff() {
  liff.init({
    liffId: "1654067025-qbv7D0Bn"
  }).then((e) => {
    if (!liff.isLoggedIn()) {
      liff.login();
    } else {
      getUserid();
      loadMap();
    }
  }).catch((err) => {
    console.log(err);
  });
}

async function getUserid() {
  const profile = await liff.getProfile();
  userid = await profile.userId;
  document.getElementById("statusMessage").value = await profile.statusMessage;
  document.getElementById("profile").src = await profile.pictureUrl;
  document.getElementById("displayName").innerHTML = await profile.displayName;
  // chkAdmin(profile.userId)
}

var map = L.map("map", {
  center: [16.769616, 100.198335],
  zoom: 8
});

var urlParams = new URLSearchParams(window.location.search);
var marker, gps, dataurl, tam, amp, pro, x, y;

// var url = "https://rti2dss.com:3200";
// var url = 'http://localhost:3200';

function loadMap() {
  var mapbox = L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=pk.eyJ1IjoiZG9va2RhIiwiYSI6ImNsZmxvenZsYzAzY3IzcW1tZmRyNTZiZDkifQ.m2CpYfFxxSZ0QriDK7s7Dw', {
        maxZoom: 20,
        id: 'mapbox/light-v9',
        tileSize: 512,
        zoomOffset: -1
    });

  const grod = L.tileLayer("https://{s}.google.com/vt/lyrs=r&x={x}&y={y}&z={z}", {
    maxZoom: 20,
    subdomains: ["mt0", "mt1", "mt2", "mt3"]
  });

  const gter = L.tileLayer('https://{s}.google.com/vt/lyrs=t,m&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
  });

  const ghyb = L.tileLayer("https://{s}.google.com/vt/lyrs=y,m&x={x}&y={y}&z={z}", {
    maxZoom: 20,
    subdomains: ["mt0", "mt1", "mt2", "mt3"]
  });

  const pro = L.tileLayer.wms("https://rti2dss.com/geoserver/th/wms?", {
    layers: "th:province_4326",
    format: "image/png",
    transparent: true
  });

  // const radar = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  //   attributions: 'Map data © <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
  // }).addTo(map);

  var baseMap = {
    'สีเทา': mapbox.addTo(map),
    'ภูมิประเทศ': gter,
    'แผนที่ถนน': grod,
    'ภาพดาวเทียม': ghyb
  };

  var overLayer = {
    '<img src="https://rti2dss.com/geoserver/wms?REQUEST=GetLegendGraphic&VERSION=1.0.0&FORMAT=image/png&WIDTH=20&HEIGHT=20&LAYER=th:province_4326" /> จังหวัด': pro
  }

  L.control.layers(baseMap, overLayer).addTo(map);
  // layerControl.addOverlay(pro.addTo(map), '<img src="https://rti2dss.com/geoserver/wms?REQUEST=GetLegendGraphic&VERSION=1.0.0&FORMAT=image/png&WIDTH=20&HEIGHT=20&LAYER=th:province_4326" /> จังหวัด');
  // layerControl.addOverlay(radar.addTo(map), '<img src="legend/ST_Amphoe_1.png" /> จังหวัด');
}

var place;
function onLocationFound(e) {
  // console.log(e)
  gps = L.marker(e.latlng);
}

function onLocationError(e) {
  console.log(e.message);
}

function refreshPage() {
  location.reload(true);
}

map.on("locationfound", onLocationFound);
// map.on('locationerror', onLocationError);
// map.locate({ setView: true, maxZoom: 18 });

var lc = L.control.locate({
  position: "topleft",
  strings: {
    title: "enable gps"
  },
  locateOptions: {
    maxZoom: 8,
    enableHighAccuracy: true
  }
}).addTo(map);

lc.start();

// var map = L.map('mapid').setView([40.633333, -73.716667], 7);

var timestamps = [];
var radarLayers = [];

var animationPosition = 0;
var animationTimer = false;


var apiRequest = new XMLHttpRequest();
apiRequest.open("GET", "https://api.rainviewer.com/public/maps.json", true);
apiRequest.onload = function (e) {

  // save available timestamps and show the latest frame: "-1" means "timestamp.lenght - 1"
  timestamps = JSON.parse(apiRequest.response);
  showFrame(-1);
};
apiRequest.send();

//  rain
function addLayer(ts) {
  if (!radarLayers[ts]) {
    radarLayers[ts] = new L.TileLayer('https://tilecache.rainviewer.com/v2/radar/' + ts + '/256/{z}/{x}/{y}/7/1_1.png', {
      tileSize: 256,
      opacity: 0.001,
      zIndex: ts
    });
  }
  if (!map.hasLayer(radarLayers[ts])) {
    map.addLayer(radarLayers[ts]);
  }
}
moment.locale('th')
function changeRadarPosition(position, preloadOnly) {
  while (position >= timestamps.length) {
    position -= timestamps.length;
  }
  while (position < 0) {
    position += timestamps.length;
  }

  var currentTimestamp = timestamps[animationPosition];
  var nextTimestamp = timestamps[position];

  addLayer(nextTimestamp);

  if (preloadOnly) {
    return;
  }

  animationPosition = position;

  if (radarLayers[currentTimestamp]) {
    radarLayers[currentTimestamp].setOpacity(0);
  }
  radarLayers[nextTimestamp].setOpacity(80);

  // document.getElementById("timestamp").innerHTML = (new Date(nextTimestamp * 1000)).toString();
  // console.log(nextTimestamp)
  $('#timestamp').text(moment(new Date(nextTimestamp * 1000)).format('LLL') + ' น.')
}


function showFrame(nextPosition) {
  var preloadingDirection = nextPosition - animationPosition > 0 ? 1 : -1;
  changeRadarPosition(nextPosition);
  changeRadarPosition(nextPosition + preloadingDirection, true);
}


function stop() {
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = false;
    return true;
  }
  return false;
}

function play() {
  showFrame(animationPosition + 1);
  animationTimer = setTimeout(play, 500);
}

function playStop() {
  if (!stop()) {
    play();
  }
}

/*Legend specific*/
var legend = L.control({ position: "bottomleft" });

function showLegend() {
  legend.onAdd = function (map) {
    var div = L.DomUtil.create("div", "legend");
    div.innerHTML += `<button class="btn btn-sm" onClick="hideLegend()">
      <span class="kanit">ซ่อนสัญลักษณ์</span><i class="fa fa-angle-double-down" aria-hidden="true"></i>
    </button><br>`;
    // div.innerHTML += "<h4>Tegnforklaring</h4>";
    div.innerHTML += '<i style="background: #008c4b"></i><span class="kanit">อาจจะมีฝน</span><br>';
    // div.innerHTML += '<i style="background: #008c4b"></i><span class="kanit">อาจจะมีฝนเล็กน้อย</span><br>';
    div.innerHTML += '<i style="background: #00d319"></i><span class="kanit">ฝนเล็กน้อย</span><br>';
    div.innerHTML += '<i style="background: #21fd22"></i><span class="kanit">ฝนเล็กน้อย</span><br>';
    div.innerHTML += '<i style="background: #fffd1b"></i><span class="kanit">ฝนปานกลาง</span><br>';
    div.innerHTML += '<i style="background: #ffd400"></i><span class="kanit">ฝนปานกลาง</span><br>';
    div.innerHTML += '<i style="background: #ffab00"></i><span class="kanit">ฝนตกหนัก</span><br>';
    div.innerHTML += '<i style="background: #ff6e00"></i><span class="kanit">ฝนตกหนัก</span><br>';
    div.innerHTML += '<i style="background: #d00523"></i><span class="kanit">พายุ</span><br>';
    div.innerHTML += '<i style="background: #ff00ff"></i><span class="kanit">ลูกเห็บ</span><br>';
    // div.innerHTML += '<i style="background: #bd0000"></i><span class="kanit">ฝนตกหนักมาก</span><br>';
    return div;
  };
  legend.addTo(map);
}

// showLegend = true; 
// var toggleLegend = function () {
//   if (showLegend === true) {
//     $('.legend').hide();
//     showLegend = false;
//   } else {
//     $('.legend').show();
//     showLegend = true;
//   }
// }

function hideLegend() {
  legend.onAdd = function (map) {
    var div = L.DomUtil.create('div', 'info legend')
    div.innerHTML += `<button class="btn btn-sm" onClick="showLegend()">
        <small class="prompt"><span class="kanit">แสดงสัญลักษณ์</span></small> 
        <i class="fa fa-angle-double-up" aria-hidden="true"></i>
    </button><br> `;
    return div;
  };
  legend.addTo(map);
}

hideLegend()
initializeLiff()