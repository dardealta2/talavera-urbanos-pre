// =========================================================================
// 1. REGISTRO DEL SERVICE WORKER (Soporte Offline PWA)
// =========================================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registrado con éxito', reg))
      .catch(err => console.error('Error al registrar Service Worker', err));
  });
}

// =========================================================================
// 2. VARIABLES GLOBALES DE ESTADO
// =========================================================================
let sentidoActual = 'ida';
let tipoDiaActual = 'regular';
let datosLinea4 = null; // Almacenará los datos que leamos del JSON

let marcadorUsuario = null;
let circuloPrecision = null;
let centradoInicial = false;
let panelCerranoCerradoManualmente = false;
let controlRuta = null; // Almacenará la línea que une las paradas
let lineaActiva = 'linea4'; // Línea por defecto al cargar


// =========================================================================
// 3. INICIALIZACIÓN DEL MAPA
// =========================================================================
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

// =========================================================================
// 4. FUNCIÓN MATEMÁTICA (DISTANCIA)
// =========================================================================
function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio de la Tierra en kilómetros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
}

// =========================================================================
// 5. CARGA ASÍNCRONA DEL ARCHIVO JSON
// =========================================================================
async function cargarDatosLinea() {
  try {
    // Cargamos dinámicamente el JSON según la línea seleccionada (ej: './linea4.json' o './linea1.json')
    const respuesta = await fetch(`./${lineaActiva}.json`);

    if (!respuesta.ok) {
      throw new Error(`No se pudo cargar el JSON de la ${lineaActiva}: ${respuesta.status}`);
    }

    datosLinea4 = await respuesta.json(); // Reutiliza la misma variable de estado para no cambiar el resto del código

    actualizarVista();

  } catch (error) {
    console.error("Error crítico al inicializar los datos de la línea:", error);
  }
}

// =========================================================================
// 6. TRAZADO DE RECORRIDO CONTINUO (100% LOCAL Y FIABLE)
// =========================================================================
function trazarRutaPorCalles() {
  try {
    // Si ya existe una línea dibujada en el mapa, la eliminamos antes de trazar de nuevo
    if (controlRuta) {
      map.removeLayer(controlRuta);
      controlRuta = null;
    }

    const paradas = datosLinea4[sentidoActual][tipoDiaActual];
    if (!paradas || paradas.length < 2) return;

    // Extraemos las coordenadas de las paradas ordenadas
    const puntosRuta = paradas.map(parada => parada.coords);

    // Dibujamos una línea azul discontinua elegante que unirá las paradas de manera inmediata
    controlRuta = L.polyline(puntosRuta, {
      color: '#1d4ed8',       // Azul corporativo
      weight: 5,             // Grosor
      opacity: 0.8,          // Opacidad
      dashArray: '10, 8',    // Efecto de línea discontinua (tipo ruta)
      lineJoin: 'round'      // Esquinas suavizadas
    }).addTo(map);

  } catch (error) {
    console.error("Error al trazar la línea continua:", error);
  }
}

// =========================================================================
// 7. ACTUALIZACIÓN DE LA VISTA (Mapa, Listado y Rutas)
// =========================================================================
function actualizarVista() {
  if (!datosLinea4) return;

  // 1. Diccionario de colores según la línea seleccionada
  const coloresLineas = {
    'linea4': 'bg-yellow-300', // Azul oscuro original para la Línea 4
    'linea1': 'bg-red-400', // Verde esmeralda para la Línea 1 (cámbialo por el que prefieras, ej: bg-red-600)
    'linea2': 'bg-amber-600'  // Por si en el futuro añades una Línea 2 (Naranja)
  };

  const nombreFormateado = lineaActiva.toUpperCase().replace('LINEA', 'Línea ');

  // Actualiza el título de la pestaña
  document.title = `${nombreFormateado} - Autobuses Urbanos`;

  // Actualiza el texto del <h1>
  const headerTitulo = document.getElementById('titulo-header');
  if (headerTitulo) {
    headerTitulo.textContent = `${nombreFormateado} Urbanos`;
  }

  // NUEVO: Cambia el color de fondo del contenedor del Header
  const contenedorHeader = document.getElementById('main-header');
  if (contenedorHeader) {
    // Eliminamos cualquier color previo del listado para que no se pisen entre sí
    Object.values(coloresLineas).forEach(claseColor => {
      contenedorHeader.classList.remove(claseColor);
    });
    
    // Aplicamos el color correspondiente a la línea actual (si no existe, usa bg-blue-900 por defecto)
    const colorAsignado = coloresLineas[lineaActiva] || 'bg-blue-900';
    contenedorHeader.classList.add(colorAsignado);
  }




  capaMarcadores.clearLayers();
  const listaContainer = document.getElementById('lista-paradas');
  listaContainer.innerHTML = '';

  const paradas = datosLinea4[sentidoActual][tipoDiaActual];
  const iconoSeleccionado = (sentidoActual === 'ida') ? iconoBusIda : iconoBusVuelta;

  if (!paradas || paradas.length === 0) {
    listaContainer.innerHTML = '<p class="text-gray-500 text-center p-4">No hay horarios registrados para esta selección.</p>';
    return;
  }

  // Dibujamos marcadores y creamos lista lateral
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
      `)
      .addTo(capaMarcadores);

    const item = document.createElement('div');
    item.className = "p-3 bg-gray-50 rounded-lg shadow-sm border border-gray-200 hover:bg-blue-50 transition cursor-pointer mb-2";
    item.innerHTML = `
      <div class="flex justify-between items-start">
        <span class="font-bold text-gray-800 text-sm">${index + 1}. ${parada.name}</span>
        <span class="bg-gray-200 text-gray-700 text-xs px-1.5 py-0.5 rounded font-mono">#${parada.cod}</span>
      </div>
      <p class="text-xs text-blue-700 mt-1.5 font-semibold">Horarios del trayecto:</p>
      <p class="text-xs text-gray-600 font-mono">${parada.horas || "Sin servicio"}</p>
    `;
    
    item.addEventListener('click', () => {
      map.setView(parada.coords, 16);
      marcador.openPopup();
    });
    
    listaContainer.appendChild(item);
  });

  // Pintamos el recorrido de manera inmediata y autónoma
  trazarRutaPorCalles();
}

// =========================================================================
// 8. GESTIÓN DEL GLOBO DE INFORMACIÓN DE PARADA MÁS CERCANA
// =========================================================================
function mostrarParadaMasCercana(miLat, miLng) {
  if (!datosLinea4 || panelCerranoCerradoManualmente) return;

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
      <div class="flex items-center gap-2 pr-4 text-left justify-start" style="text-align: left !important;">
        <span class="flex h-2 w-2 relative shrink-0">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
        </span>
        <p class="text-gray-700 leading-tight m-0" style="text-align: left !important;">
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

// =========================================================================
// 9. GEOLOCALIZACIÓN REAL CON PLAN B INTEGRADO
// =========================================================================
if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const precision = position.coords.accuracy;

      renderizarUbicacionUsuario(lat, lng, precision);
    },
    (error) => {
      console.warn("Aviso de Geolocalización (Se activa ubicación simulada de pruebas en Talavera): " + error.message);
      
      // PLAN B: Ubicación fija en Talavera para pruebas en PC local
      if (!centradoInicial) {
        renderizarUbicacionUsuario(39.9600, -4.8250, 30);
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0
    }
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

// =========================================================================
// 10. CONTROLADORES DE EVENTOS (LISTENERS)
// =========================================================================
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
  lineaActiva = e.target.value; // Guarda si ha seleccionado 'linea4' o 'linea1'
  cargarDatosLinea();           // Vuelve a hacer el fetch del nuevo JSON y redibuja todo automáticamente
});

function cambiarPestana(activo, inactivoId) {
  const inactivo = document.getElementById(inactivoId);
  activo.className = "w-1/2 py-3 text-center font-medium border-b-2 border-blue-600 text-blue-600 bg-white focus:outline-none text-xs";
  inactivo.className = "w-1/2 py-3 text-center font-medium text-gray-500 hover:text-gray-700 focus:outline-none text-xs";
}

function volverACalcular() {
  panelCerranoCerradoManualmente = false;
  if (marcadorUsuario) {
    const miPos = marcadorUsuario.getLatLng();
    mostrarParadaMasCercana(miPos.lat, miPos.lng);
  }
}

document.getElementById('selector-linea').addEventListener('change', (e) => {
  lineaActiva = e.target.value; // Guarda si ha seleccionado 'linea4' o 'linea1'
  cargarDatosLinea();           // Vuelve a hacer el fetch del nuevo JSON y redibuja todo automáticamente
});



// =========================================================================
// 11. DISPARO INICIAL
// =========================================================================
cargarDatosLinea();