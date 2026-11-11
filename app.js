if ('serviceWorker' in navigator) {
  // En local (Live Server) no usamos service worker para evitar ver versiones antiguas en caché.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
  else navigator.serviceWorker.register('./sw.js').catch(console.error);
}

let LINEAS = [], todas = {}, idx = {};
// Festivos fijos (MM-DD). Añade aquí los locales y los móviles (Semana Santa, etc.).
const FESTIVOS = ['01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'];

const $ = id => document.getElementById(id);
const leer = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function tipoDiaHoy(d = new Date()) {
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (d.getDay() === 0 || FESTIVOS.includes(md)) return 'festivo';
  const m = d.getMonth(), n = d.getDate();
  if (d.getDay() === 6) return 'sabado';
  if (m === 7 || (m === 11 && n >= 23) || (m === 0 && n <= 5)) return 'agosto';
  return 'regular';
}

const st = { linea: null, sentido: 'ida', dia: tipoDiaHoy(), datos: null, paradas: [], pos: null, cercana: null, dist: 0, favs: leer('favs', []) };
let markers = [], capaRuta = null, yo = null, centrado = false;

const map = L.map('map').setView([39.9615, -4.8312], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
map.attributionControl.setPosition('topright');
const capaMarcadores = L.layerGroup().addTo(map);
const icono = s => L.icon({ iconUrl: `iconos/autobus_${s}.png`, iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });

const rad = x => x * Math.PI / 180;
function dist(a, b) {
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}
const txtDist = d => d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`;
const aMin = h => { const [a, b] = h.split(':'); const m = +a * 60 + +b; return m < 240 ? m + 1440 : m; };

function proximo(horas) {
  const n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
  const lista = horas || [];
  const sig = lista.find(h => aMin(h) >= nm);
  return { lista, sig, min: sig ? aMin(sig) - nm : null, nm };
}

function refrescarLista() {
  const cont = $('lista'), sc = cont.scrollTop;
  if (!st.paradas.length) { cont.innerHTML = '<p class="vacio">Sin servicio para este tipo de día.</p>'; return; }
  const esHoy = st.dia === tipoDiaHoy();
  const orden = st.paradas.map((p, i) => ({ p, i }))
    .sort((a, b) => st.favs.includes(b.p.cod) - st.favs.includes(a.p.cod) || a.i - b.i);
  cont.innerHTML = orden.map(({ p, i }) => {
    const { lista, sig, min, nm } = proximo(p.horas);
    const cerca = p.cod === st.cercana, fav = st.favs.includes(p.cod);
    return `<article class="card ${cerca ? 'cerca' : ''} ${i === st.sel ? 'sel' : ''}" data-i="${i}">
      <div class="fila"><b>${i + 1}. ${p.name}</b>
        <button class="fav" data-cod="${p.cod}" aria-label="Marcar favorita" title="Marcar como favorita">${fav ? '★' : '☆'}</button></div>${chips(p)}<button class="vb ver" data-k="${norm(p.name)}">Ver todas las líneas</button>
      ${cerca ? `<span class="tag">Más cercana · ${txtDist(st.dist)}</span>` : ''}
      ${esHoy ? `<div class="prox">${sig ? `Próximo: ${min < 1 ? 'ahora' : min + ' min'} · ${sig}` : 'Sin más servicios hoy'}</div>` : ''}
      <div class="horas">${lista.length ? lista.map(h => `<span class="${esHoy && aMin(h) < nm ? 'pasada' : ''}">${h}</span>`).join('') : 'Sin servicio'}</div>
    </article>`;
  }).join('');
  cont.scrollTop = sc;
}

const claveRuta = () => `ruta2:${st.linea}:${st.sentido}:${(st.paradas || []).filter(p => p.coords).length}`;
let TRAZ = {};
const estiloRuta = { color: '#2563eb', weight: 5, opacity: .8 };
async function osrm(pts, curb) {
  let j;
  try {
    const q = curb ? `&approaches=${pts.map(() => 'curb').join(';')}&continue_straight=true` : '';
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${pts.map(p => `${p[1]},${p[0]}`).join(';')}?overview=full&geometries=geojson${q}`);
    if (r.status === 429 || r.status >= 500) throw 0;
    j = await r.json();
  } catch { throw { fatal: true }; }
  if (j.code !== 'Ok') throw new Error(j.code);
  return j.routes[0].geometry.coordinates;
}
// Prueba por la acera correcta; si falla, sin acera; si falla, parte el tramo; un tramo imposible queda en línea recta.
async function tramo(pts) {
  for (const curb of [true, false]) { try { return await osrm(pts, curb); } catch (e) { if (e.fatal) throw e; } }
  if (pts.length <= 2) return pts.map(p => [p[1], p[0]]);
  const m = pts.length >> 1;
  return [...await tramo(pts.slice(0, m + 1)), ...await tramo(pts.slice(m))];
}
async function ruta(paradas) {
  const key = claveRuta();
  if (capaRuta) map.removeLayer(capaRuta);
  const pts = paradas.filter(p => p.coords).map(p => p.coords);
  if (pts.length < 2) { capaRuta = null; return; }
  const dib = c => {
    if (key !== claveRuta()) return;
    if (capaRuta) map.removeLayer(capaRuta);
    capaRuta = L.polyline(c.map(x => [x[1], x[0]]), estiloRuta).addTo(map);
  };
  const fijo = TRAZ[st.linea] && TRAZ[st.linea][st.sentido];
  if (fijo) return dib(fijo);
  capaRuta = L.polyline(pts, estiloRuta).addTo(map); // provisional
  let geo = leer(key, null);
  if (!geo) { try { geo = await tramo(pts); guardar(key, geo); } catch (e) { console.error('ruta', e); } }
  if (geo) dib(geo);
}

function popup(p) {
  const { lista, sig, min, nm } = proximo(p.horas), hoy = st.dia === tipoDiaHoy();
  return `<b>${p.name}</b> <small>#${p.cod}</small>${chips(p)}<div><button class="vb" data-ficha="${norm(p.name)}">Ver todas las líneas</button></div>
    ${hoy ? `<div style="color:#1d4ed8;font-weight:600;margin:4px 0">${sig ? `Próximo: ${min < 1 ? 'ahora' : min + ' min'} · ${sig}` : 'Sin más servicios hoy'}</div>` : ''}
    <div style="font:600 .85rem ui-monospace,monospace;line-height:1.6">${lista.map(h => hoy && aMin(h) < nm ? `<span style="opacity:.35">${h}</span>` : h).join(' · ') || 'Sin servicio'}</div>`;
}

function seleccionar(i) {
  st.sel = i;
  document.querySelectorAll('.card.sel').forEach(c => c.classList.remove('sel'));
  const c = document.querySelector(`.card[data-i="${i}"]`);
  if (c) { c.classList.add('sel'); c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

function pintar() {
  if (!st.datos) return;
  const L_ = LINEAS.find(l => l.id === st.linea);
  document.documentElement.style.setProperty('--c', L_.color);
  document.documentElement.style.setProperty('--t', L_.texto);
  document.documentElement.style.setProperty('--f', L_.texto === '#ffffff' ? 'invert(1)' : 'none');
  document.querySelector('meta[name=theme-color]').content = L_.color;
  $('titulo').textContent = `${L_.nombre} · ${st.datos.nombre}`;
  document.title = `${L_.nombre} - Autobuses Urbanos de Talavera`;
  document.querySelectorAll('#lineas button').forEach(b => {
    const on = b.dataset.l === st.linea; b.classList.toggle('on', on);
    b.style.background = on ? L_.color : '#fff'; b.style.color = on ? L_.texto : 'inherit';
  });
  const sents = ['ida', 'vuelta'].filter(s => Object.values(st.datos[s] || {}).some(l => l.length));
  if (!sents.includes(st.sentido)) st.sentido = sents[0] || 'ida';
  $('sent').hidden = sents.length < 2;
  document.querySelectorAll('.sent button').forEach(b => {
    b.classList.toggle('on', b.dataset.s === st.sentido);
    const d = st.datos.destinos && st.datos.destinos[b.dataset.s];
    if (d) b.textContent = (b.dataset.s === 'ida' ? '→ ' : '← ') + d;
  });
  const dd = st.datos[st.sentido] || {};
  st.paradas = dd[st.dia] || (st.dia === 'agosto' ? dd.sabado : null) || [];
  capaMarcadores.clearLayers();
  st.sel = null;
  markers = st.paradas.map((p, i) => !p.coords ? null : L.marker(p.coords, { icon: icono(st.sentido) }).addTo(capaMarcadores)
    .bindPopup(() => popup(p), { maxHeight: 220 }).on('click', () => seleccionar(i)));
  refrescarLista();
  if (st.paradas.length) ruta(st.paradas);
  actualizarCercana();
}

function actualizarCercana() {
  if (!st.pos || !st.paradas.length) return;
  let best = null, d = Infinity;
  st.paradas.forEach(p => { if (!p.coords) return; const x = dist(st.pos, p.coords); if (x < d) { d = x; best = p; } });
  if (!best) return;
  const cambio = best.cod !== st.cercana || Math.abs(d - st.dist) > 50;
  st.cercana = best.cod; if (cambio) { st.dist = d; refrescarLista(); }
}

function expandir(d) {
  if (!d.paradas) return d;
  const o = { linea: d.linea, nombre: d.nombre, destinos: d.destinos, circular: d.circular };
  for (const s of ['ida', 'vuelta']) {
    o[s] = {};
    for (const [dia, l] of Object.entries(d[s] || {})) o[s][dia] = l.map(e => ({ ...d.paradas[e.cod], cod: e.cod, horas: e.horas }));
  }
  return o;
}

const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function chips(p) {
  const a = idx['c' + p.cod] || {}, b = idx['n' + norm(p.name)] || {};
  const get = l => a[l.id] || b[l.id], ls = LINEAS.filter(get);
  if (ls.length < 2) return '';
  return `<div class="corr">Correspondencia: ${ls.map(l => `<button class="chip${l.id === st.linea ? ' act' : ''}" data-l="${l.id}" data-cod="${get(l)}" style="background:${l.color};color:${l.texto}">${l.nombre}</button>`).join('')}</div>`;
}
function irALinea(b) { if (b.dataset.l !== st.linea) { st.linea = b.dataset.l; activar(false, b.dataset.cod); } }

function activar(ajustar, irA) {
  st.datos = todas[st.linea]; st.cercana = null; pintar();
  const pc = st.paradas.filter(p => p.coords).map(p => p.coords);
  if (ajustar && pc.length) map.fitBounds(pc, { paddingTopLeft: [30, 30], paddingBottomRight: [30, esMovil() && panel.classList.contains('abierto') ? panel.offsetHeight + 10 : 30] });
  const i = st.paradas.findIndex(p => p.cod === irA);
  if (i >= 0) { if (markers[i]) { centrar(st.paradas[i].coords, 16); markers[i].openPopup(); } seleccionar(i); }
}

async function iniciar() {
  $('lista').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    LINEAS = await (await fetch('./lineas.json')).json();
    await Promise.all(LINEAS.map(async l => {
      try { const r = await fetch('./' + l.archivo); if (!r.ok) throw new Error(r.status); todas[l.id] = expandir(await r.json()); }
      catch (e) { console.error(l.archivo, e); }
    }));
    LINEAS = LINEAS.filter(l => todas[l.id]);
    if (!LINEAS.length) throw new Error('sin datos');
    for (const l of LINEAS) for (const s of ['ida', 'vuelta']) for (const lst of Object.values(todas[l.id][s] || {}))
      for (const p of lst) { (idx['c' + p.cod] ||= {})[l.id] ||= p.cod; (idx['n' + norm(p.name)] ||= {})[l.id] ||= p.cod; }
    construirGrupos();
    try { const r = await fetch('./trazados.json'); if (r.ok) TRAZ = await r.json(); } catch {}
    $('lineas').innerHTML = LINEAS.map(l => `<button data-l="${l.id}" aria-label="${l.nombre}">L${l.corta}</button>`).join('');
    st.linea = LINEAS[0].id; activar(false);
  } catch (e) {
    console.error(e);
    $('lista').innerHTML = '<p class="vacio">No se pudieron cargar los horarios. Comprueba tu conexión e inténtalo de nuevo.</p>';
  }
}

// Controles
$('lineas').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { st.linea = b.dataset.l; activar(true); } });
document.querySelector('.sent').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { st.sentido = b.dataset.s; pintar(); } });
$('dia').addEventListener('change', e => { st.dia = e.target.value; pintar(); if (st.ficha) pintarFicha(); });
[...$('dia').options].forEach(o => { if (o.value === st.dia) o.textContent += ' · hoy'; });
$('dia').value = st.dia;
$('lista').addEventListener('click', e => {
  const v = e.target.closest('.ver');
  if (v) return abrirFicha(v.dataset.k);
  const ch = e.target.closest('.chip');
  if (ch) return irALinea(ch);
  const fav = e.target.closest('.fav'), card = e.target.closest('.card');
  if (fav) {
    const c = fav.dataset.cod; st.favs = st.favs.includes(c) ? st.favs.filter(x => x !== c) : [...st.favs, c];
    guardar('favs', st.favs); refrescarLista();
  } else if (card) { const i = +card.dataset.i; if (markers[i]) { centrar(st.paradas[i].coords, 16); markers[i].openPopup(); } seleccionar(i); }
});
setInterval(() => { if (st.datos) { refrescarLista(); if (st.ficha) pintarFicha(); } }, 30000);

// Ubicación (si se deniega, simplemente no se muestra la parada cercana)
if ('geolocation' in navigator) navigator.geolocation.watchPosition(p => {
  st.pos = [p.coords.latitude, p.coords.longitude];
  if (!yo) yo = L.circleMarker(st.pos, { radius: 8, color: '#fff', fillColor: '#1d4ed8', fillOpacity: 1, weight: 2 }).addTo(map).bindPopup('Estás aquí');
  else yo.setLatLng(st.pos);
  if (!centrado) { map.setView(st.pos, 15); centrado = true; }
  actualizarCercana();
}, () => {}, { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 });

// ---- Buscador, ficha de parada y paradas cercanas ----
const panel = document.querySelector('.panel');
const plano = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let GRP = [], capaFicha = null;
function construirGrupos() {
  const m = {};
  for (const l of LINEAS) for (const s of ['ida', 'vuelta']) for (const [dia, lst] of Object.entries(todas[l.id][s] || {})) for (const p of lst) {
    const k = norm(p.name), g = m[k] ||= { k, name: p.name, cods: new Set(), cm: {}, lineas: new Set(), serv: {} };
    g.cods.add(p.cod); g.lineas.add(l.id); if (p.coords) g.cm[p.cod] = p.coords;
    ((g.serv[l.id + '|' + s] ||= { l: l.id, s, dias: {} }).dias[dia] ||= []).push(...p.horas);
  }
  GRP = Object.values(m).map(g => {
    const cs = Object.values(g.cm);
    g.coords = cs.length ? [cs.reduce((a, c) => a + c[0], 0) / cs.length, cs.reduce((a, c) => a + c[1], 0) / cs.length] : null;
    g.p = plano(g.name); g.txt = g.p + ' ' + [...g.cods].join(' ');
    return g;
  });
}
function buscar(q) {
  const t = plano(q).split(' ').filter(Boolean);
  if (!t.length) return [];
  return GRP.filter(g => t.every(w => g.txt.includes(w)))
    .sort((a, b) => (a.p.startsWith(t[0]) ? 0 : 1) - (b.p.startsWith(t[0]) ? 0 : 1) || a.name.length - b.name.length).slice(0, 8);
}
const horasDe = v => [...new Set(v.dias[st.dia] || (st.dia === 'agosto' ? v.dias.sabado : null) || [])].sort((a, b) => aMin(a) - aMin(b));
function resumen(g) {
  const hoy = st.dia === tipoDiaHoy();
  return LINEAS.filter(l => g.lineas.has(l.id)).map(l => {
    let t = '';
    if (hoy) {
      const m = Object.values(g.serv).filter(v => v.l === l.id).map(v => proximo(horasDe(v)).min).filter(x => x != null);
      t = m.length ? ' ' + (Math.min(...m) < 1 ? 'ahora' : Math.min(...m) + ' min') : ' —';
    }
    return `<i class="ch" style="background:${l.color};color:${l.texto}">L${l.corta}${t}</i>`;
  }).join('');
}
const item = (g, extra = '') => `<button class="item" data-k="${g.k}"><span><b>${g.name}</b>${extra ? ` <small>${extra}</small>` : ''}</span><span class="ars">${resumen(g)}</span></button>`;

function listarInicio() {
  const fav = GRP.filter(g => [...g.cods].some(c => st.favs.includes(c)));
  const rec = leer('rec', []).map(k => GRP.find(g => g.k === k)).filter(Boolean);
  $('res').innerHTML = (fav.length ? '<h2>Favoritas</h2>' + fav.map(g => item(g)).join('') : '') +
    (rec.length ? '<h2>Recientes</h2>' + rec.map(g => item(g)).join('') : '') || '<p class="vacio">Escribe el nombre o el código de una parada.</p>';
}
function abrirBusca(modo) {
  cerrarFicha(); panelAbrir(true); panel.classList.add('buscando');
  if (modo !== 'cerca') { $('q').focus(); listarInicio(); }
}
function cerrarBusca() { panel.classList.remove('buscando'); }

function cerca() {
  abrirBusca('cerca'); $('q').value = '';
  const lista = () => {
    const c = GRP.filter(g => g.coords).map(g => ({ g, d: dist(st.pos, g.coords) })).sort((a, b) => a.d - b.d).slice(0, 8);
    $('res').innerHTML = '<h2>Paradas cerca de ti</h2>' + c.map(x => item(x.g, txtDist(x.d))).join('');
  };
  if (st.pos) return lista();
  const fallo = () => { $('res').innerHTML = '<p class="vacio">No he podido obtener tu ubicación. Activa el permiso de ubicación del navegador.</p>'; };
  $('res').innerHTML = '<p class="vacio">Buscando tu ubicación…</p>';
  if (!navigator.geolocation) return fallo();
  navigator.geolocation.getCurrentPosition(p => { st.pos = [p.coords.latitude, p.coords.longitude]; lista(); }, fallo, { timeout: 15000 });
}

function abrirFicha(k) {
  const g = GRP.find(x => x.k === k); if (!g) return;
  cerrarBusca(); panelAbrir(true); st.ficha = k; panel.classList.add('enFicha');
  guardar('rec', [k, ...leer('rec', []).filter(x => x !== k)].slice(0, 5));
  if (capaFicha) map.removeLayer(capaFicha);
  capaFicha = null;
  if (g.coords) { capaFicha = L.circleMarker(g.coords, { radius: 11, color: '#fff', weight: 3, fillColor: '#dc2626', fillOpacity: 1 }).addTo(map); centrar(g.coords, 17); }
  pintarFicha();
}
function cerrarFicha() {
  st.ficha = null; panel.classList.remove('enFicha'); $('ficha').dataset.k = '';
  if (capaFicha) { map.removeLayer(capaFicha); capaFicha = null; }
}
function pintarFicha() {
  const g = GRP.find(x => x.k === st.ficha); if (!g) return;
  const f = $('ficha'), ya = f.dataset.k === g.k, abiertos = new Set([...document.querySelectorAll('#ficha details[open]')].map(d => d.dataset.sv));
  const hoy = st.dia === tipoDiaHoy(); f.dataset.k = g.k;
  const filas = Object.entries(g.serv).map(([id, v]) => {
    const l = LINEAS.find(x => x.id === v.l), hs = horasDe(v), pr = proximo(hs); return { id, l, v, hs, pr };
  }).sort((a, b) => (hoy ? (a.pr.min ?? 1e9) - (b.pr.min ?? 1e9) : 0) || +a.l.corta - +b.l.corta).map(({ id, l, v, hs, pr }) => {
    const d = todas[v.l], dest = d.circular ? '↻ Circular' : '→ ' + ((d.destinos || {})[v.s] || '');
    const txt = !hs.length ? 'Sin servicio' : hoy ? (pr.sig ? (pr.min < 1 ? 'ahora' : pr.min + ' min') + ' · ' + pr.sig : 'Sin más servicios hoy') : hs.length + ' salidas';
    return `<details data-sv="${id}" ${(ya ? abiertos.has(id) : v.l === st.linea) ? 'open' : ''}><summary><i class="ch" style="background:${l.color};color:${l.texto}">${l.nombre}</i> <b>${dest}</b> <span class="prox">${txt}</span></summary>
      <div class="horas">${hs.map(h => `<span class="${hoy && aMin(h) < pr.nm ? 'pasada' : ''}">${h}</span>`).join('')}</div></details>`;
  }).join('');
  f.innerHTML = `<button class="vb volver">← Volver</button><h2>${g.name}</h2>
    <div>${LINEAS.filter(l => g.lineas.has(l.id)).map(l => `<i class="ch" style="background:${l.color};color:${l.texto}">${l.nombre}</i>`).join(' ')}</div>
    ${hoy ? '' : '<p class="aviso2">Mostrando horarios de otro tipo de día.</p>'}${filas}
    <p class="aviso2">Códigos de parada: ${[...g.cods].join(', ')}</p>`;
}
$('btnBusca').onclick = () => panel.classList.contains('buscando') ? cerrarBusca() : abrirBusca();
$('cierraB').onclick = cerrarBusca; $('btnCerca').onclick = cerca;
$('q').addEventListener('input', e => {
  if (!e.target.value.trim()) return listarInicio();
  const r = buscar(e.target.value); $('res').innerHTML = r.length ? r.map(g => item(g)).join('') : '<p class="vacio">Sin resultados.</p>';
});
$('res').addEventListener('click', e => { const b = e.target.closest('.item'); if (b) abrirFicha(b.dataset.k); });
$('ficha').addEventListener('click', e => { if (e.target.closest('.volver')) cerrarFicha(); });

// ---- Panel inferior desplegable (móvil) ----
const esMovil = () => matchMedia('(max-width:799px)').matches;
const panelAbrir = v => { panel.classList.toggle('abierto', v); $('btnPanel').setAttribute('aria-expanded', v); };
function centrar(c, z) {   // deja la parada en la parte visible del mapa, por encima del panel
  map.setView(c, z, { animate: false });
  if (esMovil() && panel.classList.contains('abierto')) map.panBy([0, panel.offsetHeight / 2], { animate: false });
}
$('cab').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (esMovil() && (!b || b.id === 'btnPanel')) panelAbrir(!panel.classList.contains('abierto'));
});
let y0 = null;
$('cab').addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
$('cab').addEventListener('touchend', e => {
  if (y0 == null) return;
  const dy = e.changedTouches[0].clientY - y0; y0 = null;
  if (Math.abs(dy) > 30) panelAbrir(dy < 0);
}, { passive: true });
map.on('click', () => { if (esMovil()) panelAbrir(false); });
if (typeof ResizeObserver === 'function') new ResizeObserver(() => panel.style.setProperty('--hc', $('cab').offsetHeight + 'px')).observe($('cab'));

map.on('popupopen', e => {
  const el = e.popup.getElement();
  el.querySelectorAll('.chip').forEach(b => { b.onclick = () => irALinea(b); });
  el.querySelectorAll('[data-ficha]').forEach(b => { b.onclick = () => { map.closePopup(); abrirFicha(b.dataset.ficha); }; });
});
iniciar();
