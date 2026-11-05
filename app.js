if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registrado con éxito', reg))
      .catch(err => console.error('Error al registrar Service Worker', err));
  });
}

let sentidoActual = 'ida';
let tipoDiaActual = 'regular';
let datosLinea4 = null;

let marcadorUsuario = null;
let circuloPrecision = null;
let centradoInicial = false;
let panelCerranoCerradoManualmente = false;
let lineaActiva = 'linea4_4';
let capaGeometria = null;

const map = L.map('map').setView([39.9615, -4.8312], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let capaMarcadores = L.layerGroup().addTo(map);

const iconoBusIda = L.icon({
  iconUrl: 'iconos/autobus_ida.png',
  iconSize: [32, 32], 
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const iconoBusVuelta = L.icon({
  iconUrl: 'iconos/autobus_vuelta.png',
  iconSize: [32, 32], 
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
}

async function cargarDatosLinea() {
  try {
    const archivoJson = `${lineaActiva}.json`;
    const respuesta = await fetch(`./${archivoJson}`);
    
    if (!respuesta.ok) {
      throw new Error(`No se pudo cargar el JSON (${archivoJson}): ${respuesta.status}`);
    }
    
    datosLinea4 = await respuesta.json();
    actualizarVista();
    
  } catch (error) {
    console.error("Error crítico al inicializar los datos de la línea:", error);
    const listaContainer = document.getElementById('lista-paradas');
    if (listaContainer) {
      listaContainer.innerHTML = '<p class="text-red-500 text-center p-4">Error al cargar los datos de esta línea.</p>';
    }
  }
}

function actualizarVista() {
  if (!datosLinea4) return;

  const coloresLineas = {
    'linea4': 'bg-yellow-300', 
    'linea1': 'bg-red-400', 
    'linea2': 'bg-amber-600'
  };

  const nombreFormateado = lineaActiva.toUpperCase().replace('LINEA', 'Línea ');

  document.title = `${nombreFormateado} - Autobuses Urbanos`;

  const headerTitulo = document.getElementById('titulo-header');
  if (headerTitulo) {
    headerTitulo.textContent = `${nombreFormateado} Urbanos`;
  }

  const contenedorHeader = document.getElementById('main-header');
  if (contenedorHeader) {
    Object.values(coloresLineas).forEach(claseColor => {
      contenedorHeader.classList.remove(claseColor);
    });
    const colorAsignado = coloresLineas[lineaActiva] || 'bg-blue-900';
    contenedorHeader.classList.add(colorAsignado);
  }

  capaMarcadores.clearLayers();
  const listaContainer = document.getElementById('lista-paradas');
  if (!listaContainer) return;
  listaContainer.innerHTML = '';

  if (!datosLinea4[sentidoActual] || !datosLinea4[sentidoActual][tipoDiaActual]) {
    listaContainer.innerHTML = '<p class="text-gray-500 text-center p-4">No hay horarios registrados para esta combinación.</p>';
    return;
  }

  const paradas = datosLinea4[sentidoActual][tipoDiaActual];
  const iconoSeleccionado = (sentidoActual === 'ida') ? iconoBusIda : iconoBusVuelta;

  const marcadoresArray = [];

  paradas.forEach((parada, index) => {
    const marcador = L.marker(parada.coords, { icon: iconoSeleccionado })
      .bindPopup(`
        <div class="font-sans">
          <h3 class="font-bold text-gray-900 text-sm border-b pb-1 mb-1">${parada.name}</h3>
          <p class="text-xs text-gray-500 mb-2">Código: ${parada.cod}</p>
          <div class="text-xs font-semibold text-blue-700 bg-blue-50 p-1.5 rounded">
            <strong>Horarios:</strong><br>${parada.horas || "Sin servicio"}
          </div>
        </div>
      `);

    marcador.addTo(capaMarcadores);
    marcadoresArray.push(marcador);

    const item = document.createElement('div');
    item.className = "parada-card p-2 bg-gray-50 rounded-lg shadow-sm border border-gray-200 hover:bg-blue-50 transition cursor-pointer mb-1.5";
    item.innerHTML = `
      <div class="flex justify-between items-start">
        <span class="font-bold text-gray-800 text-xs">${index + 1}. ${parada.name}</span>
        <span class="bg-gray-200 text-gray-700 text-[10px] px-1 py-0.2 rounded font-mono">#${parada.cod}</span>
      </div>
      <p class="text-[11px] text-blue-700 mt-1 font-semibold">Horarios:</p>
      <p class="text-[11px] text-gray-600 font-mono">${parada.horas || "Sin servicio"}</p>
    `;
    
    item.addEventListener('click', () => {
      map.setView(parada.coords, 16);
      marcador.openPopup();
    });
    
    listaContainer.appendChild(item);
  });

  cargarGeometriaLinea(paradas);
}

async function cargarGeometriaLinea(paradas) {
  try {
    if (capaGeometria) {
      map.removeLayer(capaGeometria);
      capaGeometria = null;
    }

    if (!paradas || paradas.length === 0) return;

    const coordsString = paradas
      .map(p => `${p.coords[1]},${p.coords[0]}`)
      .join(';');

    const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`;
    const respuesta = await fetch(url);
    const data = await respuesta.json();

    if (data.routes && data.routes.length > 0) {
      const trazadoGeoJSON = data.routes[0].geometry;

      capaGeometria = L.geoJSON(trazadoGeoJSON, {
        style: {
          color: '#2563eb',
          weight: 5,
          opacity: 0.8
        }
      }).addTo(map);

      capaMarcadores.bringToFront();
    }
  } catch (error) {
    console.error("Error al calcular la ruta por calles:", error);
  }
}

function mostrarParadaMasCercana(miLat, miLng) {
  if (!datosLinea4 || panelCerranoCerradoManualmente) return;

  if (!datosLinea4[sentidoActual] || !datosLinea4[sentidoActual][tipoDiaActual]) return;
  const paradas = datosLinea4[sentidoActual][tipoDiaActual];
  if (!paradas || paradas.length === 0) return;

  let paradaCercana = null;
  let distanciaMinima = Infinity;

  paradas.forEach(parada => {
    const dist = calcularDistancia(miLat, miLng, parada.coords[0], parada.coords[1]);
    if (dist < distanciaMinima) {
      distanciaMinima = dist;
      paradaCercana = parada;
    }
  });

  if (paradaCercana) {
    const distanciaTexto = distanciaMinima < 1 
      ? `${Math.round(distanciaMinima * 1000)}m` 
      : `${distanciaMinima.toFixed(1)}km`;

    let contenedorInfo = document.getElementById('info-cercana');
    if (!contenedorInfo) {
      contenedorInfo = document.createElement('div');
      contenedorInfo.id = 'info-cercana';
      
      contenedorInfo.style.position = 'fixed';
      contenedorInfo.style.bottom = '24px';
      contenedorInfo.style.left = '50%';
      contenedorInfo.style.transform = 'translateX(-50%)';
      contenedorInfo.style.zIndex = '9999';
      contenedorInfo.style.width = '280px'; 
      contenedorInfo.style.boxSizing = 'border-box';

      contenedorInfo.className = "bg-white px-3 py-2.5 rounded-xl shadow-2xl border border-gray-200 flex flex-col gap-2 text-xs text-left";
      document.body.appendChild(contenedorInfo);
    }

    contenedorInfo.innerHTML = `
      <button id="btn-cerrar-info" class="absolute top-1 right-2 text-gray-400 hover:text-red-500 transition focus:outline-none text-base font-bold p-0.5 leading-none z-10 bg-transparent border-0 cursor-pointer">
        &times;
      </button>
      <div class="flex items-center gap-2 pr-4 text-left justify-start">
        <span class="flex h-2 w-2 relative shrink-0">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
        </span>
        <p class="text-gray-700 leading-tight m-0">
          Cercana: <strong class="text-gray-900">${paradaCercana.name}</strong> a <strong class="text-blue-600">${distanciaTexto}</strong>
        </p>
      </div>
      <button id="btn-ir-parada" class="w-full text-[11px] bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 rounded-lg transition text-center shadow-sm border-0 cursor-pointer block">
        Ver en mapa
      </button>
    `;

    document.getElementById('btn-ir-parada').addEventListener('click', () => {
      map.setView(paradaCercana.coords, 16);
      capaMarcadores.eachLayer((layer) => {
        if (layer instanceof L.Marker && layer.getLatLng().lat === paradaCercana.coords[0]) {
          layer.openPopup();
        }
      });
    });

    document.getElementById('btn-cerrar-info').addEventListener('click', () => {
      contenedorInfo.remove();
      panelCerranoCerradoManualmente = true;
    });
  }
}

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const precision = position.coords.accuracy;
      renderizarUbicacionUsuario(lat, lng, precision);
    },
    (error) => {
      console.warn("Aviso de Geolocalización: " + error.message);
      if (!centradoInicial) {
        renderizarUbicacionUsuario(39.9600, -4.8250, 30);
      }
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

function renderizarUbicacionUsuario(lat, lng, precision) {
  if (marcadorUsuario) map.removeLayer(marcadorUsuario);
  if (circuloPrecision) map.removeLayer(circuloPrecision);

  circuloPrecision = L.circle([lat, lng], {
    radius: precision,
    color: '#1d4ed8',
    fillColor: '#3b82f6',
    fillOpacity: 0.15,
    weight: 1
  }).addTo(map);

  marcadorUsuario = L.circleMarker([lat, lng], {
    radius: 8,
    color: '#ffffff',
    fillColor: '#1d4ed8',
    fillOpacity: 1,
    weight: 2
  }).addTo(map).bindPopup("<b>Estás aquí</b>");

  if (!centradoInicial) {
    map.setView([lat, lng], 15);
    centradoInicial = true;
  }

  mostrarParadaMasCercana(lat, lng);
}

document.getElementById('btn-ida').addEventListener('click', (e) => {
  cambiarPestana(e.target, 'btn-vuelta');
  sentidoActual = 'ida';
  actualizarVista();
  volverACalcular();
});

document.getElementById('btn-vuelta').addEventListener('click', (e) => {
  cambiarPestana(e.target, 'btn-ida');
  sentidoActual = 'vuelta';
  actualizarVista();
  volverACalcular();
});

document.getElementById('selector-dia').addEventListener('change', (e) => {
  tipoDiaActual = e.target.value;
  actualizarVista();
  volverACalcular();
});

document.getElementById('selector-linea').addEventListener('change', (e) => {
  lineaActiva = e.target.value;
  cargarDatosLinea();
});

function cambiarPestana(activo, inactivoId) {
  const inactivo = document.getElementById(inactivoId);
  activo.className = "w-1/2 sm:w-24 py-1.5 px-2 text-center font-medium border-b-2 border-blue-600 text-blue-600 bg-white focus:outline-none text-[11px] transition-all";
  inactivo.className = "w-1/2 sm:w-24 py-1.5 px-2 text-center font-medium text-gray-500 hover:text-gray-700 focus:outline-none text-[11px] transition-all";
}

function volverACalcular() {
  panelCerranoCerradoManualmente = false;
  if (marcadorUsuario) {
    const miPos = marcadorUsuario.getLatLng();
    mostrarParadaMasCercana(miPos.lat, miPos.lng);
  }
}

cargarDatosLinea();