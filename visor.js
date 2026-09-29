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

  // Panes con orden de capas estricto:
  // Recintos (abajo, 410) < Superficies (centro, 420) < Arbolado (arriba, 430)
  state.map.createPane("recintosPane");
  state.map.getPane("recintosPane").style.zIndex = 410;

  state.map.createPane("superficiesPane");
  state.map.getPane("superficiesPane").style.zIndex = 420;

  state.map.createPane("arboladoPane");
  state.map.getPane("arboladoPane").style.zIndex = 430;

  state.layers.recintos = L.geoJSON(null, {
    pane: "recintosPane",
    style: styleRecinto,
    onEachFeature: onEachFeatureRecinto
  }).addTo(state.map);

  state.layers.superficies = L.geoJSON(null, {
    pane: "superficiesPane",
    style: styleSuperficie,
    onEachFeature: onEachFeatureSuperficie
  }).addTo(state.map);

  // Agrupación de clústeres para arbolado: a partir de zoom 16 se desactiva para ver la simbología exacta de QGIS
  state.layers.arbolado = L.markerClusterGroup({
    clusterPane: "arboladoPane",
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    disableClusteringAtZoom: 16
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
    pane: "arboladoPane",
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
      // Auto-centrar la cámara en la geometría del recinto
      if (layer.getBounds) {
        state.map.fitBounds(layer.getBounds(), {
          padding: [70, 70],
          maxZoom: 18,
          duration: 0.8
        });
      }
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
  titleEl.textContent = p.NOM_recinto || p.Nombre || p.COD_recinto || p.COD_ARB || p.CODIGO || `Elemento #${feature.id}`;

  // Mostrar el botón de exportar a PDF exclusivamente para recintos
  const btnExportPdf = document.getElementById("btnExportRecintoPDF");
  if (btnExportPdf) {
    btnExportPdf.style.display = layerKey === "recintos" ? "flex" : "none";
  }

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

  // Control de Saturación del Mapa Base
  initSaturationControl();

  // Exportar Recinto a PDF
  const btnExportPdf = document.getElementById("btnExportRecintoPDF");
  if (btnExportPdf) {
    btnExportPdf.addEventListener("click", () => {
      if (state.selectedFeature) {
        exportRecintoPDF(state.selectedFeature);
      }
    });
  }

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

// ==============================================================================
// CONTROL DE SATURACIÓN DEL FONDO SATÉLITE
// ==============================================================================
function initSaturationControl() {
  const satToggle = document.getElementById("btnSatToggle");
  const satPopover = document.getElementById("satPopover");
  const satSlider = document.getElementById("satSlider");

  // Valor por defecto: 30%
  setSaturation(30);

  if (satToggle && satPopover) {
    satToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      satPopover.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!satPopover.contains(e.target) && !satToggle.contains(e.target)) {
        satPopover.classList.remove("open");
      }
    });
  }

  if (satSlider) {
    satSlider.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      setSaturation(val);
    });
  }

  document.querySelectorAll(".sat-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = parseInt(btn.dataset.val, 10);
      if (satSlider) satSlider.value = val;
      setSaturation(val);
    });
  });
}

function setSaturation(value) {
  document.documentElement.style.setProperty("--map-saturation", `${value}%`);
  const satValDisplay = document.getElementById("satValDisplay");
  const satValPopover = document.getElementById("satValPopover");
  if (satValDisplay) satValDisplay.textContent = `${value}%`;
  if (satValPopover) satValPopover.textContent = `${value}%`;
}

// ==============================================================================
// EXPORTACIÓN DE RECINTO A PDF / INFORME TÉCNICO
// ==============================================================================
function exportRecintoPDF(feature) {
  if (!feature) return;

  const p = feature.properties || {};
  const recintoNombre = p.NOM_recinto || p.Nombre || p.COD_recinto || `Recinto #${feature.id}`;
  const recintoCod = p.COD_recinto || p.CODIGO || "—";
  const recintoEstado = p.Estado || "—";
  const recintoSup = p.SUP ? Number(p.SUP).toLocaleString("es-ES") + " m²" : "—";
  const recintoZona = p.Zona || "—";
  const recintoNucleo = p.NucleoUrb || "—";
  const recintoTitularidad = p.TITULARIDA || "—";
  const recintoContrato = p.Contrato || "—";
  const fechaGeneracion = new Date().toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const printWindow = window.open("", "_blank", "width=1200,height=850");
  if (!printWindow) {
    alert("Por favor, permita las ventanas emergentes (pop-ups) en su navegador para exportar el PDF.");
    return;
  }

  const featureJsonString = JSON.stringify(feature);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>TESELAB - Ficha Técnica: ${recintoNombre}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      color: #1e293b;
      background: #f8fafc;
      padding: 1.5rem;
      -webkit-font-smoothing: antialiased;
    }
    .print-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .btn-action {
      background: #0f172a;
      color: #ffffff;
      border: none;
      padding: 0.6rem 1.2rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    .btn-action.secondary {
      background: #e2e8f0;
      color: #334155;
    }
    .report-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
    }
    .report-header {
      background: #0f172a;
      color: #ffffff;
      padding: 1.25rem 1.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .report-brand {
      font-family: 'Montserrat', sans-serif;
      font-size: 1.15rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .report-brand span { color: #38bdf8; }
    .report-subtitle {
      font-size: 0.8rem;
      color: #94a3b8;
      margin-top: 0.15rem;
    }
    .report-date {
      text-align: right;
      font-size: 0.75rem;
      color: #94a3b8;
    }
    .report-body {
      padding: 1.5rem 1.75rem;
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 1.5rem;
    }
    .map-container-wrap {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .map-title {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.82rem;
      font-weight: 700;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    #printMap {
      width: 100%;
      height: 380px;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      overflow: hidden;
    }
    .print-tile-pane {
      filter: saturate(30%);
    }
    .info-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .section-heading {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.82rem;
      font-weight: 700;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 0.4rem;
    }
    .attr-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
    }
    .attr-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 0.65rem 0.85rem;
    }
    .attr-label {
      font-size: 0.68rem;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 600;
      letter-spacing: 0.03em;
    }
    .attr-value {
      font-size: 0.92rem;
      font-weight: 700;
      color: #0f172a;
      margin-top: 0.2rem;
    }
    .attr-box.full-width {
      grid-column: span 2;
    }
    .report-footer {
      background: #f1f5f9;
      padding: 0.85rem 1.75rem;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.72rem;
      color: #64748b;
    }
    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }
      .print-actions {
        display: none !important;
      }
      .report-card {
        border: none;
        box-shadow: none;
        border-radius: 0;
      }
      @page {
        size: A4 landscape;
        margin: 10mm;
      }
      #printMap {
        height: 380px;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .print-tile-pane {
        filter: saturate(30%) !important;
      }
    }
  </style>
</head>
<body>
  <div class="print-actions">
    <button class="btn-action secondary" onclick="window.close()">Cerrar</button>
    <button class="btn-action" onclick="window.print()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
      <span>Imprimir / Guardar como PDF</span>
    </button>
  </div>

  <div class="report-card">
    <header class="report-header">
      <div>
        <div class="report-brand">TESELAB <span>CARTAGENA</span></div>
        <div class="report-subtitle">Ficha Técnica Oficial de Recinto Cartográfico</div>
      </div>
      <div class="report-date">
        <div>Fecha de emisión:</div>
        <strong>${fechaGeneracion}</strong>
      </div>
    </header>

    <div class="report-body">
      <div class="map-container-wrap">
        <h4 class="map-title">Delimitación Espacial (Google Satélite 30% Sat.)</h4>
        <div id="printMap"></div>
      </div>

      <div class="info-container">
        <h4 class="section-heading">Atributos e Información del Recinto</h4>
        <div class="attr-grid">
          <div class="attr-box full-width">
            <div class="attr-label">Nombre del Recinto</div>
            <div class="attr-value">${recintoNombre}</div>
          </div>
          <div class="attr-box">
            <div class="attr-label">Código Oficial</div>
            <div class="attr-value">${recintoCod}</div>
          </div>
          <div class="attr-box">
            <div class="attr-label">Estado / Uso</div>
            <div class="attr-value">${recintoEstado}</div>
          </div>
          <div class="attr-box">
            <div class="attr-label">Superficie Total</div>
            <div class="attr-value">${recintoSup}</div>
          </div>
          <div class="attr-box">
            <div class="attr-label">Zona Territorial</div>
            <div class="attr-value">${recintoZona}</div>
          </div>
          <div class="attr-box">
            <div class="attr-label">Núcleo Urbano</div>
            <div class="attr-value">${recintoNucleo}</div>
          </div>
          <div class="attr-box">
            <div class="attr-label">Titularidad</div>
            <div class="attr-value">${recintoTitularidad}</div>
          </div>
          <div class="attr-box full-width">
            <div class="attr-label">Contrato / Lote Asignado</div>
            <div class="attr-value">${recintoContrato}</div>
          </div>
        </div>
      </div>
    </div>

    <footer class="report-footer">
      <div>Tesela Gestión Cultural y Patrimonio S.L. &bull; www.teselaestudio.es</div>
      <div>Fuente de datos: OGC API Features &bull; Mergin Maps</div>
    </footer>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const featureData = ${featureJsonString};
    const map = L.map('printMap', {
      zoomControl: false,
      attributionControl: false
    });

    const satLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      className: 'print-tile-pane'
    }).addTo(map);

    const geoLayer = L.geoJSON(featureData, {
      style: {
        color: '#0284c7',
        weight: 3.5,
        fillColor: '#38bdf8',
        fillOpacity: 0.45
      }
    }).addTo(map);

    const bounds = geoLayer.getBounds();
    map.fitBounds(bounds, { padding: [35, 35] });

    let printed = false;
    function triggerPrint() {
      if (!printed) {
        printed = true;
        setTimeout(() => {
          window.print();
        }, 600);
      }
    }

    satLayer.on('load', triggerPrint);
    setTimeout(triggerPrint, 1500);
  </script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

// Iniciar al cargar
window.addEventListener("DOMContentLoaded", initVisor);
