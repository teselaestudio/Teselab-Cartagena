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
  activeBasemap: "dark",
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
    arbolado: { tipo: "", zona: "", tamano: "", search: "" },
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
  // Guardia de autenticación
  const session = await requireAuth();
  if (!session) return;

  // Mostrar correo del usuario
  const userEmailEl = document.getElementById("userEmail");
  if (userEmailEl && session.user) {
    userEmailEl.textContent = session.user.email || "Usuario autenticado";
  }

  // Inicializar Leaflet Map
  initMap();

  // Configurar eventos de la interfaz
  setupUIEventListeners();

  // Carga inicial de datos para la vista actual
  loadAllLayersForCurrentBbox();
}

// ==============================================================================
// MAPA Y CAPAS BASE
// ==============================================================================
function initMap() {
  // Centro inicial: Término Municipal de Cartagena
  state.map = L.map("map", {
    center: [37.602, -0.986],
    zoom: 15,
    minZoom: 11,
    maxZoom: 20,
    zoomControl: false
  });

  // Control de zoom en esquina inferior derecha
  L.control.zoom({ position: "bottomright" }).addTo(state.map);

  // Escala métrica
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(state.map);

  // Capas Base
  state.basemaps = {
    dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap',
      subdomains: "abcd",
      maxZoom: 20
    }),
    sat: L.tileLayer("https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg", {
      attribution: '&copy; <a href="https://www.ign.es/">IGN - PNOA</a>',
      maxZoom: 20
    }),
    light: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; CARTO &copy; OpenStreetMap',
      subdomains: "abcd",
      maxZoom: 20
    })
  };

  // Añadir la capa oscura por defecto
  state.basemaps.dark.addTo(state.map);

  // Inicializar grupos de capas vectoriales
  state.layers.arbolado = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    disableClusteringAtZoom: 17
  }).addTo(state.map);

  state.layers.recintos = L.geoJSON(null, {
    style: styleRecinto,
    onEachFeature: onEachFeatureRecinto
  }).addTo(state.map);

  state.layers.superficies = L.geoJSON(null, {
    style: styleSuperficie,
    onEachFeature: onEachFeatureSuperficie
  }).addTo(state.map);

  // Escuchar eventos de movimiento en el mapa (Debounce para no saturar)
  let moveTimeout = null;
  state.map.on("moveend", () => {
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      loadAllLayersForCurrentBbox();
    }, 400);
  });
}

// ==============================================================================
// ESTILOS DE ELEMENTOS VECTORIALES
// ==============================================================================
function styleRecinto() {
  return {
    color: "#38bdf8",
    weight: 2,
    opacity: 0.85,
    fillColor: "#0284c7",
    fillOpacity: 0.15
  };
}

function styleSuperficie() {
  return {
    color: "#f59e0b",
    weight: 1.5,
    opacity: 0.8,
    fillColor: "#d97706",
    fillOpacity: 0.25,
    dashArray: "3, 4"
  };
}

function createArboladoMarker(feature, latlng) {
  const isPalmera = (feature.properties.Tipo || "").toLowerCase().includes("palmera");
  const markerClass = isPalmera ? "custom-palm-marker" : "custom-tree-marker";
  const iconHtml = isPalmera ? "🌴" : "🌳";

  const customIcon = L.divIcon({
    className: markerClass,
    html: `<span style="font-size: 11px;">${iconHtml}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  const marker = L.marker(latlng, { icon: customIcon });
  marker.on("click", () => {
    openFeatureDrawer(feature, "arbolado");
  });
  return marker;
}

function onEachFeatureRecinto(feature, layer) {
  layer.on({
    mouseover: (e) => {
      const l = e.target;
      l.setStyle({ fillOpacity: 0.45, weight: 3, color: "#7dd3fc" });
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
      const l = e.target;
      l.setStyle({ fillOpacity: 0.5, weight: 2.5, color: "#fde68a" });
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
// CARGA DE DATOS DESDE OGC API FEATURES (MERGIN MAPS)
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
    console.error("Error al cargar capas OGC API:", err);
  } finally {
    showLoader(false);
  }
}

async function fetchCollectionItems(layerKey, bbox, filters = {}) {
  const collectionName = COLLECTIONS[layerKey];
  let url = `${OGC_API_BASE}/collections/${collectionName}/items?bbox=${bbox}&limit=1200`;

  // Añadir parámetros de filtros soportados por la API
  if (layerKey === "arbolado") {
    if (filters.tipo) url += `&Tipo=${encodeURIComponent(filters.tipo)}`;
    if (filters.zona) url += `&Zona=${encodeURIComponent(filters.zona)}`;
    if (filters.tamano) url += `&Tamano=${encodeURIComponent(filters.tamano)}`;
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

  // Filtro de búsqueda en cliente (búsqueda de texto libre por código, especie o nombre)
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    features = features.filter(f => {
      const p = f.properties || {};
      return (
        (p.COD_ARB && p.COD_ARB.toLowerCase().includes(q)) ||
        (p.Especie && p.Especie.toLowerCase().includes(q)) ||
        (p.Nombre && p.Nombre.toLowerCase().includes(q)) ||
        (p.CODIGO && p.CODIGO.toLowerCase().includes(q)) ||
        (p.COD_recinto && p.COD_recinto.toLowerCase().includes(q))
      );
    });
  }

  // Renderizar en mapa
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

// ==============================================================================
// PANEL LATERAL DERECHO (INFORMACIÓN DEL ELEMENTO SELECCIONADO)
// ==============================================================================
function openFeatureDrawer(feature, layerKey) {
  state.selectedFeature = feature;
  const drawer = document.getElementById("rightDrawer");
  const layerBadge = document.getElementById("drawerLayerBadge");
  const titleEl = document.getElementById("drawerTitle");
  const tableBody = document.getElementById("featureAttributesBody");

  // Configurar badge de capa
  layerBadge.className = `drawer-layer-badge ${layerKey}`;
  layerBadge.textContent = layerKey === "arbolado" ? "Arbolado y Palmeras" : layerKey === "recintos" ? "Recinto" : "Superficie";

  // Título
  const p = feature.properties || {};
  titleEl.textContent = p.COD_ARB || p.Nombre || p.CODIGO || p.COD_recinto || `Elemento #${feature.id}`;

  // Construir tabla de atributos
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
    valCell.textContent = val !== null && val !== undefined ? val : "—";

    row.appendChild(keyCell);
    row.appendChild(valCell);
    tableBody.appendChild(row);
  });

  // Mostrar Drawer
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
// EVENTOS DE INTERFAZ DE USUARIO
// ==============================================================================
function setupUIEventListeners() {
  // Pestañas de Filtros
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

  // Conmutador de Visibilidad de Capas (Switches)
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

  // Botón Aplicar Filtros
  document.getElementById("btnApplyFilters").addEventListener("click", () => {
    readFiltersFromUI();
    loadAllLayersForCurrentBbox();
  });

  // Botón Restablecer Filtros
  document.getElementById("btnResetFilters").addEventListener("click", () => {
    resetFiltersUI();
    loadAllLayersForCurrentBbox();
  });

  // Panel Izquierdo: Colapsar / Abrir
  const leftPanel = document.getElementById("leftPanel");
  document.getElementById("btnCollapsePanel").addEventListener("click", () => {
    leftPanel.classList.add("collapsed");
  });

  document.getElementById("openPanelFab").addEventListener("click", () => {
    leftPanel.classList.remove("collapsed");
  });

  // Drawer Derecho: Cerrar
  document.getElementById("btnCloseDrawer").addEventListener("click", closeFeatureDrawer);

  // Botón Centrar / Zoom al elemento seleccionado
  document.getElementById("btnZoomFeature").addEventListener("click", () => {
    if (!state.selectedFeature || !state.map) return;
    const geom = state.selectedFeature.geometry;
    if (geom.type === "Point") {
      const [lng, lat] = geom.coordinates;
      state.map.flyTo([lat, lng], 18, { duration: 1.2 });
    } else if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
      const tempLayer = L.geoJSON(state.selectedFeature);
      state.map.fitBounds(tempLayer.getBounds(), { maxZoom: 18, padding: [50, 50] });
    }
  });

  // Conmutador de Capas Base (Oscuro / Satélite / Claro)
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
  Object.values(state.basemaps).forEach(l => state.map.removeLayer(l));
  if (state.basemaps[baseKey]) {
    state.basemaps[baseKey].addTo(state.map);
    state.activeBasemap = baseKey;
  }
}

function readFiltersFromUI() {
  state.filters.arbolado = {
    tipo: document.getElementById("filterArboladoTipo").value,
    zona: document.getElementById("filterArboladoZona").value,
    tamano: document.getElementById("filterArboladoTamano").value,
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
    counterEl.textContent = `Mostrando ${totalVisible.toLocaleString("es-ES")} elementos en la vista actual`;
  }
}

// Iniciar al cargar el DOM
window.addEventListener("DOMContentLoaded", initVisor);
