import { requireAuth, logout } from "./auth.js";

// ==============================================================================
// CONFIGURACIÓN Y ESTADO DEL VISOR OGC API
// ==============================================================================
const OGC_API_BASE = "https://app.merginmaps.com/v2/ogc/-0a3-KaqP2Qu9wvmwx8JKXZZ5Vw/api";

const COLLECTIONS = {
  arbolado: "CT_Arbolado_y_palmeras",
  recintos: "CT_Recintos",
  superficies: "CT_Superficies"
};

// Estado global de la aplicación
const state = {
  map: null,
  activeBasemap: "googleSat",
  basemaps: {},
  layers: {
    arbolado: null,
    recintos: null,
    superficies: null
  },
  visibility: {
    arbolado: true,
    recintos: true,
    superficies: true
  },
  filters: {
    arbolado: { tipo: "", zona: "", tamano: "", especie: "", search: "" },
    recintos: { zona: "", estado: "", search: "" },
    superficies: { elemento: "", zona: "", contrato: "" }
  },
  activeTab: "arbolado",
  selectedFeature: null,
  isLoading: false,
  visibleCounts: { arbolado: 0, recintos: 0, superficies: 0 }
};

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
async function initVisor() {
  const session = await requireAuth();
  if (!session) return;

  const userEmailEl = document.getElementById("userEmail");
  if (userEmailEl && session.user) {
    userEmailEl.textContent = session.user.email || "Usuario autenticado";
  }

  initMap();
  setupUIEventListeners();
  loadAllLayersForCurrentBbox();
}

// ==============================================================================
// MAPA Y CAPAS BASE (Google Satélite como fondo principal)
// ==============================================================================
function initMap() {
  state.map = L.map("map", {
    center: [37.602, -0.986],
    zoom: 15,
    minZoom: 11,
    maxZoom: 21,
    zoomControl: false
  });

  L.control.zoom({ position: "bottomright" }).addTo(state.map);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(state.map);

  // Catálogo de capas base
  state.basemaps = {
    googleSat: L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
      maxZoom: 21,
      attribution: "&copy; Google Satélite"
    }),
    googleHybrid: L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      maxZoom: 21,
      attribution: "&copy; Google Híbrido"
    }),
    dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
    }),
    pnoa: L.tileLayer("https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg", {
      maxZoom: 20,
      attribution: "&copy; IGN España - PNOA"
    })
  };

  // Activar Google Satélite por defecto
  state.basemaps.googleSat.addTo(state.map);

  // Agrupación de clústeres para arbolado: a partir de zoom 16 se desactiva para ver la simbología exacta de QGIS
  state.layers.arbolado = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    disableClusteringAtZoom: 16
  }).addTo(state.map);

  state.layers.recintos = L.geoJSON(null, {
    style: styleRecinto,
    onEachFeature: onEachFeatureRecinto
  }).addTo(state.map);

  state.layers.superficies = L.geoJSON(null, {
    style: styleSuperficie,
    onEachFeature: onEachFeatureSuperficie
  }).addTo(state.map);

  // Recarga al mover el mapa (con debounce)
  let moveTimeout = null;
  state.map.on("moveend", () => {
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      loadAllLayersForCurrentBbox();
    }, 350);
  });
}

// ==============================================================================
// ESTILOS ORIGINALES DE QGIS (CT_inventario.qgz)
// ==============================================================================

/**
 * Simbología exacta de CT_Superficies según el atributo 'Elemento'
 */
function styleSuperficie(feature) {
  const p = feature.properties || {};
  const elemento = (p.Elemento || "").toLowerCase().trim();

  const colorMap = {
    silvestre: "rgba(116, 84, 180, 0.85)",
    jardin: "rgba(48, 222, 48, 0.56)",
    cesped: "rgba(112, 181, 82, 0.70)",
    "pavimento duro": "rgba(178, 187, 161, 0.64)",
    "pavimento blando": "rgba(246, 236, 123, 0.60)",
    "tierra desnuda": "rgba(238, 194, 97, 0.58)",
    "zona de juegos": "rgba(139, 225, 204, 0.62)",
    "zona deportiva": "rgba(84, 121, 180, 0.64)",
    pergola: "rgba(131, 131, 131, 0.75)",
    construccion: "rgba(94, 81, 119, 0.85)",
    fuente: "rgba(126, 206, 243, 0.85)",
    otros: "rgba(76, 76, 76, 0.75)"
  };

  return {
    fillColor: colorMap[elemento] || "rgba(167, 167, 167, 0.65)",
    fillOpacity: 1,
    color: "#000000",
    weight: 1,
    opacity: 0.9
  };
}

/**
 * Simbología exacta de CT_Recintos según el atributo 'Estado'
 */
function styleRecinto(feature) {
  const p = feature.properties || {};
  const estado = (p.Estado || "").trim();

  const styleMap = {
    "Zona Verde": { fill: "rgba(150, 157, 58, 0.59)", stroke: "#000000", weight: 1.5 },
    "Viario": { fill: "rgba(106, 203, 241, 0.10)", stroke: "rgb(72, 137, 169)", weight: 1.5 },
    "edu": { fill: "rgba(228, 190, 107, 0.40)", stroke: "rgb(233, 153, 119)", weight: 2 },
    "Equipamiento": { fill: "rgba(210, 228, 107, 0.40)", stroke: "rgb(233, 209, 119)", weight: 2 },
    "Infraestructura": { fill: "rgba(107, 162, 228, 0.40)", stroke: "rgb(67, 120, 177)", weight: 2 },
    "sin desarrollar": { fill: "rgba(137, 106, 28, 0.65)", stroke: "rgb(161, 113, 55)", weight: 1.5 },
    "no existe": { fill: "rgba(214, 48, 26, 0.08)", stroke: "rgb(201, 29, 29)", weight: 1.5 }
  };

  const st = styleMap[estado] || { fill: "rgba(114, 155, 111, 0.50)", stroke: "#353535", weight: 1.5 };

  return {
    fillColor: st.fill,
    fillOpacity: 1,
    color: st.stroke,
    weight: st.weight,
    opacity: 0.95
  };
}

/**
 * Simbología exacta de CT_Arbolado_y_palmeras según reglas de QGIS
 */
function createArboladoMarker(feature, latlng) {
  const p = feature.properties || {};
  const tipo = (p.Tipo || "").toLowerCase().trim();
  const tamano = (p.Tamano || "").trim();

  let radius = 5;
  let fillColor = "rgba(33, 99, 34, 0.75)";
  let strokeColor = "#000000";
  let weight = 1;
  let fillOpacity = 0.85;

  if (tipo === "palmera") {
    fillColor = "rgba(125, 158, 41, 0.75)"; // Verde oliva QGIS
    if (tamano === "Mas de 6 m") radius = 7;
    else if (tamano === "De 3 a 6 m") radius = 5;
    else radius = 3.5;
  } else if (tipo === "arbol") {
    fillColor = "rgba(33, 99, 34, 0.78)"; // Verde bosque profundo QGIS
    if (tamano === "Mas de 6 m") radius = 8;
    else if (tamano === "De 3 a 6 m") radius = 5.5;
    else radius = 3.5;
  } else if (tipo === "arbol singular") {
    fillColor = "rgba(90, 110, 68, 0.85)";
    strokeColor = "#356445";
    weight = 2;
    radius = 10;
  } else if (tipo === "macetero") {
    fillColor = "rgba(133, 182, 111, 1)";
    radius = 3;
  } else if (tipo === "m" || tipo === "mr") { // Marra
    fillColor = "rgba(123, 92, 42, 1)";
    radius = 3;
  } else if (tipo === "t" || tipo === "tr") { // Tocón
    fillColor = "rgba(49, 42, 30, 1)";
    radius = 2.5;
  } else if (tipo === "a" || tipo === "ar") { // Alcorque vacío
    fillColor = "rgba(183, 72, 75, 0.1)";
    strokeColor = "rgba(183, 72, 75, 1)";
    weight = 1.5;
    radius = 3;
  } else if (tipo === "at" || tipo === "atr") { // Alcorque con tocón
    fillColor = "rgba(49, 42, 30, 0.8)";
    strokeColor = "rgba(183, 72, 75, 1)";
    weight = 1.5;
    radius = 3;
  } else if (tipo === "h") { // Hueco disponible
    fillColor = "transparent";
    strokeColor = "rgba(144, 101, 27, 1)";
    weight = 1.5;
    radius = 3;
  } else if (!p.Especie) {
    fillColor = "transparent";
    strokeColor = "rgba(208, 72, 72, 1)";
    weight = 1.5;
    radius = 4;
  }

  const marker = L.circleMarker(latlng, {
    radius: radius,
    fillColor: fillColor,
    color: strokeColor,
    weight: weight,
    opacity: 0.95,
    fillOpacity: fillOpacity
  });

  marker.on("click", () => {
    openFeatureDrawer(feature, "arbolado");
  });

  return marker;
}

function onEachFeatureRecinto(feature, layer) {
  layer.on({
    mouseover: (e) => {
      e.target.setStyle({ fillOpacity: 0.65, weight: 3 });
    },
    mouseout: (e) => {
      state.layers.recintos.resetStyle(e.target);
    },
    click: () => {
      openFeatureDrawer(feature, "recintos");
    }
  });
}

function onEachFeatureSuperficie(feature, layer) {
  layer.on({
    mouseover: (e) => {
      e.target.setStyle({ fillOpacity: 0.75, weight: 2.5 });
    },
    mouseout: (e) => {
      state.layers.superficies.resetStyle(e.target);
    },
    click: () => {
      openFeatureDrawer(feature, "superficies");
    }
  });
}

// ==============================================================================
// CARGA Y FILTRADO ROBUSTO DE DATOS OGC API
// ==============================================================================
async function loadAllLayersForCurrentBbox() {
  if (!state.map) return;

  const bounds = state.map.getBounds();
  const bbox = [
    bounds.getWest().toFixed(6),
    bounds.getSouth().toFixed(6),
    bounds.getEast().toFixed(6),
    bounds.getNorth().toFixed(6)
  ].join(",");

  showLoader(true);

  try {
    const promises = [];

    if (state.visibility.arbolado) {
      promises.push(fetchCollectionItems("arbolado", bbox, state.filters.arbolado));
    } else {
      state.layers.arbolado.clearLayers();
      state.visibleCounts.arbolado = 0;
    }

    if (state.visibility.recintos) {
      promises.push(fetchCollectionItems("recintos", bbox, state.filters.recintos));
    } else {
      state.layers.recintos.clearLayers();
      state.visibleCounts.recintos = 0;
    }

    if (state.visibility.superficies) {
      promises.push(fetchCollectionItems("superficies", bbox, state.filters.superficies));
    } else {
      state.layers.superficies.clearLayers();
      state.visibleCounts.superficies = 0;
    }

    await Promise.all(promises);
    updateVisibleCounters();
  } catch (err) {
    console.error("Error al consultar OGC API:", err);
  } finally {
    showLoader(false);
  }
}

async function fetchCollectionItems(layerKey, bbox, filters = {}) {
  const collectionName = COLLECTIONS[layerKey];
  let url = `${OGC_API_BASE}/collections/${collectionName}/items?bbox=${bbox}&limit=1500`;

  // Construir parámetros de consulta OGC API
  if (layerKey === "arbolado") {
    if (filters.tipo) url += `&Tipo=${encodeURIComponent(filters.tipo)}`;
    if (filters.zona) url += `&Zona=${encodeURIComponent(filters.zona)}`;
    if (filters.tamano) url += `&Tamano=${encodeURIComponent(filters.tamano)}`;
    if (filters.especie) url += `&Especie=${encodeURIComponent(filters.especie)}`;
  } else if (layerKey === "recintos") {
    if (filters.zona) url += `&Zona=${encodeURIComponent(filters.zona)}`;
    if (filters.estado) url += `&Estado=${encodeURIComponent(filters.estado)}`;
  } else if (layerKey === "superficies") {
    if (filters.elemento) url += `&Elemento=${encodeURIComponent(filters.elemento)}`;
    if (filters.zona) url += `&Zona=${encodeURIComponent(filters.zona)}`;
    if (filters.contrato) url += `&Contrato=${encodeURIComponent(filters.contrato)}`;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${collectionName}`);

  const data = await response.json();
  let features = data.features || [];

  // Filtrado adicional de búsqueda libre (búsqueda insensible a mayúsculas y acentos)
  if (filters.search && filters.search.trim()) {
    const q = cleanString(filters.search.trim());
    features = features.filter(f => {
      const p = f.properties || {};
      return (
        cleanString(p.COD_ARB).includes(q) ||
        cleanString(p.Especie).includes(q) ||
        cleanString(p.Nombre).includes(q) ||
        cleanString(p.CODIGO).includes(q) ||
        cleanString(p.NOM_recinto).includes(q) ||
        cleanString(p.Distrito).includes(q)
      );
    });
  }

  // Filtrado de seguridad cliente para tipo de arbolado si aplica
  if (layerKey === "arbolado" && filters.tipo) {
    const targetTipo = filters.tipo.toLowerCase();
    features = features.filter(f => {
      const t = (f.properties?.Tipo || "").toLowerCase();
      return t === targetTipo;
    });
  }

  // Renderizar en las capas de Leaflet
  if (layerKey === "arbolado") {
    state.layers.arbolado.clearLayers();
    const markers = [];
    features.forEach(f => {
      if (f.geometry && f.geometry.type === "Point") {
        const [lng, lat] = f.geometry.coordinates;
        markers.push(createArboladoMarker(f, [lat, lng]));
      }
    });
    state.layers.arbolado.addLayers(markers);
    state.visibleCounts.arbolado = features.length;
  } else if (layerKey === "recintos") {
    state.layers.recintos.clearLayers();
    state.layers.recintos.addData({ type: "FeatureCollection", features });
    state.visibleCounts.recintos = features.length;
  } else if (layerKey === "superficies") {
    state.layers.superficies.clearLayers();
    state.layers.superficies.addData({ type: "FeatureCollection", features });
    state.visibleCounts.superficies = features.length;
  }
}

function cleanString(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ==============================================================================
// PANEL LATERAL DERECHO (INFORMACIÓN DEL ELEMENTO)
// ==============================================================================
function openFeatureDrawer(feature, layerKey) {
  state.selectedFeature = feature;
  const drawer = document.getElementById("rightDrawer");
  const layerBadge = document.getElementById("drawerLayerBadge");
  const titleEl = document.getElementById("drawerTitle");
  const tableBody = document.getElementById("featureAttributesBody");

  layerBadge.className = `drawer-layer-badge ${layerKey}`;
  layerBadge.textContent = layerKey === "arbolado" ? "Arbolado y Palmeras" : layerKey === "recintos" ? "Recinto" : "Superficie";

  const p = feature.properties || {};
  titleEl.textContent = p.COD_ARB || p.Nombre || p.CODIGO || p.COD_recinto || `Elemento #${feature.id}`;

  tableBody.innerHTML = "";
  const excludeKeys = ["auxiliar", "bbox"];

  Object.entries(p).forEach(([key, val]) => {
    if (excludeKeys.includes(key)) return;

    const row = document.createElement("tr");
    const keyCell = document.createElement("td");
    keyCell.className = "attr-key";
    keyCell.textContent = formatAttributeKey(key);

    const valCell = document.createElement("td");
    valCell.className = "attr-val";
    valCell.textContent = val !== null && val !== undefined && val !== "" ? val : "—";

    row.appendChild(keyCell);
    row.appendChild(valCell);
    tableBody.appendChild(row);
  });

  drawer.classList.add("open");
}

function closeFeatureDrawer() {
  const drawer = document.getElementById("rightDrawer");
  drawer.classList.remove("open");
  state.selectedFeature = null;
}

function formatAttributeKey(key) {
  const map = {
    COD_ARB: "Código Árbol",
    COD_recinto: "Cód. Recinto",
    CODIGO: "Código",
    NOM_recinto: "Nombre Recinto",
    Especie: "Especie Botánica",
    Tamano: "Tamaño",
    Tipo: "Tipo de Vegetación",
    SUP: "Superficie (m²)",
    NucleoUrb: "Núcleo Urbano",
    Elemento: "Elemento",
    Contrato: "Contrato / Lote",
    Estado: "Estado",
    TITULARIDA: "Titularidad",
    fid: "ID Registro"
  };
  return map[key] || key.replace(/_/g, " ");
}

// ==============================================================================
// EVENTOS DE INTERFAZ Y REACTIVIDAD INSTANTÁNEA
// ==============================================================================
function setupUIEventListeners() {
  // Pestañas
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));

      btn.classList.add("active");
      const tabName = btn.dataset.tab;
      state.activeTab = tabName;
      document.getElementById(`tab-${tabName}`).classList.add("active");
    });
  });

  // Visibilidad de Capas
  document.getElementById("toggleArbolado").addEventListener("change", (e) => {
    state.visibility.arbolado = e.target.checked;
    loadAllLayersForCurrentBbox();
  });

  document.getElementById("toggleRecintos").addEventListener("change", (e) => {
    state.visibility.recintos = e.target.checked;
    loadAllLayersForCurrentBbox();
  });

  document.getElementById("toggleSuperficies").addEventListener("change", (e) => {
    state.visibility.superficies = e.target.checked;
    loadAllLayersForCurrentBbox();
  });

  // FILTRADO INSTANTÁNEO AL CAMBIAR CUALQUIER SELECT O INPUT
  const filterInputs = [
    "filterArboladoTipo", "filterArboladoZona", "filterArboladoTamano", "filterArboladoEspecie",
    "filterRecintosZona", "filterRecintosEstado",
    "filterSuperficiesElemento", "filterSuperficiesZona", "filterSuperficiesContrato"
  ];

  filterInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        readFiltersFromUI();
        loadAllLayersForCurrentBbox();
      });
    }
  });

  // Búsqueda de texto con debounce
  let searchTimeout = null;
  ["filterArboladoSearch", "filterRecintosSearch"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          readFiltersFromUI();
          loadAllLayersForCurrentBbox();
        }, 300);
      });
    }
  });

  // Botón Aplicar Filtros
  document.getElementById("btnApplyFilters").addEventListener("click", () => {
    readFiltersFromUI();
    loadAllLayersForCurrentBbox();
  });

  // Botón Limpiar Filtros
  document.getElementById("btnResetFilters").addEventListener("click", () => {
    resetFiltersUI();
    loadAllLayersForCurrentBbox();
  });

  // Plegar / Desplegar panel izquierdo
  const leftPanel = document.getElementById("leftPanel");
  document.getElementById("btnCollapsePanel").addEventListener("click", () => {
    leftPanel.classList.add("collapsed");
  });

  document.getElementById("openPanelFab").addEventListener("click", () => {
    leftPanel.classList.remove("collapsed");
  });

  // Cerrar Drawer
  document.getElementById("btnCloseDrawer").addEventListener("click", closeFeatureDrawer);

  // Centrar elemento
  document.getElementById("btnZoomFeature").addEventListener("click", () => {
    if (!state.selectedFeature || !state.map) return;
    const geom = state.selectedFeature.geometry;
    if (geom.type === "Point") {
      const [lng, lat] = geom.coordinates;
      state.map.flyTo([lat, lng], 19, { duration: 1.2 });
    } else if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
      const tempLayer = L.geoJSON(state.selectedFeature);
      state.map.fitBounds(tempLayer.getBounds(), { maxZoom: 19, padding: [60, 60] });
    }
  });

  // Conmutador de Capas Base
  document.querySelectorAll(".basemap-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".basemap-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const baseKey = btn.dataset.base;
      setBasemap(baseKey);
    });
  });

  // Logout
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await logout();
    });
  }
}

function setBasemap(baseKey) {
  Object.values(state.basemaps).forEach(l => {
    if (state.map.hasLayer(l)) state.map.removeLayer(l);
  });
  if (state.basemaps[baseKey]) {
    state.basemaps[baseKey].addTo(state.map);
    state.basemaps[baseKey].bringToBack();
    state.activeBasemap = baseKey;
  }
}

function readFiltersFromUI() {
  state.filters.arbolado = {
    tipo: document.getElementById("filterArboladoTipo").value,
    zona: document.getElementById("filterArboladoZona").value,
    tamano: document.getElementById("filterArboladoTamano").value,
    especie: document.getElementById("filterArboladoEspecie").value,
    search: document.getElementById("filterArboladoSearch").value
  };

  state.filters.recintos = {
    zona: document.getElementById("filterRecintosZona").value,
    estado: document.getElementById("filterRecintosEstado").value,
    search: document.getElementById("filterRecintosSearch").value
  };

  state.filters.superficies = {
    elemento: document.getElementById("filterSuperficiesElemento").value,
    zona: document.getElementById("filterSuperficiesZona").value,
    contrato: document.getElementById("filterSuperficiesContrato").value
  };
}

function resetFiltersUI() {
  document.getElementById("filterArboladoTipo").value = "";
  document.getElementById("filterArboladoZona").value = "";
  document.getElementById("filterArboladoTamano").value = "";
  document.getElementById("filterArboladoEspecie").value = "";
  document.getElementById("filterArboladoSearch").value = "";

  document.getElementById("filterRecintosZona").value = "";
  document.getElementById("filterRecintosEstado").value = "";
  document.getElementById("filterRecintosSearch").value = "";

  document.getElementById("filterSuperficiesElemento").value = "";
  document.getElementById("filterSuperficiesZona").value = "";
  document.getElementById("filterSuperficiesContrato").value = "";

  readFiltersFromUI();
}

function showLoader(isLoading) {
  state.isLoading = isLoading;
  const loader = document.getElementById("mapLoader");
  if (loader) {
    if (isLoading) loader.classList.add("visible");
    else loader.classList.remove("visible");
  }
}

function updateVisibleCounters() {
  const counterEl = document.getElementById("visibleCountText");
  if (counterEl) {
    const totalVisible = state.visibleCounts.arbolado + state.visibleCounts.recintos + state.visibleCounts.superficies;
    counterEl.textContent = `Mostrando ${totalVisible.toLocaleString("es-ES")} elementos filtrados en pantalla`;
  }
}

// Iniciar al cargar
window.addEventListener("DOMContentLoaded", initVisor);
