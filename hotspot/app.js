function initializeLiff() {
    liff.init({
        liffId: "1654067025-PEA4doYl"
    }).then((e) => {
        if (!liff.isLoggedIn()) {
            liff.login();
        } else {
            getUserid();
            loadMap();
            myModal.show()
        }
    }).catch((err) => {
        console.log(err);
    });
}

async function getUserid() {
    const profile = await liff.getProfile();
    userid = await profile.userId;
    document.getElementById("statusMessage").innerHTML = await profile.statusMessage;
    document.getElementById("pictureUrl").src = await profile.pictureUrl;
    document.getElementById("displayName").innerHTML = await profile.displayName;
    // chkAdmin(profile.userId)
    // console.log(profile);
}

var map = L.map("map", {
    center: [16.769616, 100.198335],
    zoom: 8
});

var fc = L.featureGroup()

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

    // const pro = L.tileLayer.wms("https://rti2dss.com/geoserver/th/wms?", {
    //     layers: "th:province_4326",
    //     format: "image/png",
    //     transparent: true
    // });

    var baseMap = {
        'สีเทา': mapbox.addTo(map),
        'ภูมิประเทศ': gter,
        'แผนที่ถนน': grod,
        'ภาพดาวเทียม': ghyb
    };

    var overLayer = {
        "จุดความร้อน": fc.addTo(map),
        // '<img src="https://rti2dss.com/geoserver/wms?REQUEST=GetLegendGraphic&VERSION=1.0.0&FORMAT=image/png&WIDTH=20&HEIGHT=20&LAYER=th:province_4326" /> จังหวัด': pro
    }

    L.control.layers(baseMap, overLayer).addTo(map);
    loadHotspot();
}

function onLocationFound(e) {
    // console.log(e)
    // gps = L.marker(e.latlng);
}

function onLocationError(e) {
    console.log(e.message);
}

function refreshPage() {
    location.reload(true);
}

map.on("locationfound", onLocationFound);

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


let hpData = axios.get("https://firms.modaps.eosdis.nasa.gov/mapserver/wfs/SouthEast_Asia/c56f7d70bc06160e3c443a592fd9c87e/?SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0&TYPENAME=ms:fires_snpp_24hrs&STARTINDEX=0&COUNT=10000&SRSNAME=urn:ogc:def:crs:EPSG::4326&BBOX=-90,-180,90,180,urn:ogc:def:crs:EPSG::4326&outputformat=geojson");
let onEachFeatureHotspot = (feature, layer) => {
    if (feature.properties) {
        layer.bindPopup(
            `<span class="kanit"><b>ตำแหน่งจุดความร้อน</b>
            <br/>ข้อมูลจาก VIIRS
            <br/>ตำแหน่งที่พบ : ${feature.properties.latitude}, ${feature.properties.longitude} 
            <br/>ค่า Brightness temperature: ${feature.properties.brightness} Kelvin
            <br/>วันที่: ${feature.properties.acq_datetime} UTC`
        );
    }
}

let loadHotspot = async () => {
    let hp = await hpData;
    const fs = hp.data.features;
    var geojsonMarkerOptions = {
        radius: 6,
        fillColor: "#ff5100",
        color: "#a60b00",
        weight: 0,
        opacity: 1,
        fillOpacity: 0.8
    };

    await L.geoJSON(fs, {
        filter: function (feature) {
            if (feature.geometry.coordinates[0] > 96.295861 && feature.geometry.coordinates[0] < 106.113154) {
                if (feature.geometry.coordinates[1] > 5.157973 && feature.geometry.coordinates[1] < 20.221918) {
                    myModal.hide();
                    return feature
                }
            }
        },
        pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng, geojsonMarkerOptions);
        },
        name: "lyr",
        onEachFeature: onEachFeatureHotspot
    }).addTo(fc)
}

var myModal = new bootstrap.Modal(document.getElementById('myModal'), {
    keyboard: false,
})


initializeLiff()  