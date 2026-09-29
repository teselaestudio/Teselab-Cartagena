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
// PANEL LATERAL / BOTTOM-SHEET (INFORMACIÓN DEL ELEMENTO)
// Requirement 2: Aparece desde abajo ocupando solo 1/3 de pantalla, con opción de deslizarlo hasta arriba
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
    btnExportPdf.style.display = layerKey === "recintos" ? "inline-flex" : "none";
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

  // Inicializar SIEMPRE en modo 1/3 de pantalla (peek) al pinchar cualquier elemento
  drawer.classList.remove("expanded");
  drawer.classList.add("peek");
  drawer.classList.add("open");

  const txt = document.getElementById("drawerExpandTxt");
  if (txt) txt.textContent = "Expandir";
  const hint = document.getElementById("drawerSwipeHint");
  if (hint) {
    const hintTxt = hint.querySelector(".swipe-hint-txt");
    if (hintTxt) hintTxt.textContent = "Desliza hacia arriba para ver todos los datos";
  }

  // Cerrar dropdown de la barra superior si estaba abierto
  const topMenuDropdown = document.getElementById("topMenuDropdown");
  const btnTopMenuToggle = document.getElementById("btnTopMenuToggle");
  if (topMenuDropdown) topMenuDropdown.classList.remove("open");
  if (btnTopMenuToggle) btnTopMenuToggle.classList.remove("active");

  // En dispositivos móviles, colapsar panel izquierdo para dar foco al detalle
  const leftPanel = document.getElementById("leftPanel");
  const btnToggleLeft = document.getElementById("btnToggleLeftMenu");
  if (leftPanel && window.innerWidth <= 768) {
    leftPanel.classList.add("collapsed");
    if (btnToggleLeft) btnToggleLeft.classList.remove("active");
  }
}

function closeFeatureDrawer() {
  const drawer = document.getElementById("rightDrawer");
  if (drawer) {
    drawer.classList.remove("open");
    drawer.classList.remove("expanded");
    drawer.classList.add("peek");
  }
  state.selectedFeature = null;
}

function expandDrawer() {
  const drawer = document.getElementById("rightDrawer");
  if (!drawer) return;
  drawer.classList.remove("peek");
  drawer.classList.add("expanded");
  const txt = document.getElementById("drawerExpandTxt");
  if (txt) txt.textContent = "Reducir";
  const hint = document.getElementById("drawerSwipeHint");
  if (hint) {
    const hintTxt = hint.querySelector(".swipe-hint-txt");
    if (hintTxt) hintTxt.textContent = "Desliza hacia abajo o pulsa para reducir";
  }
}

function collapseDrawerToPeek() {
  const drawer = document.getElementById("rightDrawer");
  if (!drawer) return;
  drawer.classList.remove("expanded");
  drawer.classList.add("peek");
  const txt = document.getElementById("drawerExpandTxt");
  if (txt) txt.textContent = "Expandir";
  const hint = document.getElementById("drawerSwipeHint");
  if (hint) {
    const hintTxt = hint.querySelector(".swipe-hint-txt");
    if (hintTxt) hintTxt.textContent = "Desliza hacia arriba para ver todos los datos";
  }
}

function toggleDrawerExpand() {
  const drawer = document.getElementById("rightDrawer");
  if (!drawer) return;
  if (drawer.classList.contains("expanded")) {
    collapseDrawerToPeek();
  } else {
    expandDrawer();
  }
}

function setupDrawerGestures() {
  const drawer = document.getElementById("rightDrawer");
  const dragHandle = document.getElementById("drawerDragHandle");
  const header = document.getElementById("drawerHeader");
  const swipeHint = document.getElementById("drawerSwipeHint");
  const btnExpand = document.getElementById("btnToggleDrawerExpand");

  if (btnExpand) {
    btnExpand.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDrawerExpand();
    });
  }
  if (swipeHint) {
    swipeHint.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDrawerExpand();
    });
  }
  if (dragHandle) {
    dragHandle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDrawerExpand();
    });
  }

  // Detección táctil de deslizamiento (Swipe up / down)
  const gestureTargets = [dragHandle, header, swipeHint].filter(Boolean);
  let touchStartY = null;
  let touchStartX = null;

  gestureTargets.forEach(el => {
    el.addEventListener("touchstart", (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
      }
    }, { passive: true });

    el.addEventListener("touchend", (e) => {
      if (touchStartY === null) return;
      const touchEndY = e.changedTouches[0].clientY;
      const touchEndX = e.changedTouches[0].clientX;
      const deltaY = touchEndY - touchStartY;
      const deltaX = touchEndX - touchStartX;

      // Asegurar que el gesto es vertical y supera el umbral
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 30) {
        if (deltaY < -30) {
          // Deslizó hacia ARRIBA -> expandir a 85vh
          expandDrawer();
        } else if (deltaY > 30) {
          // Deslizó hacia ABAJO -> si está expandido, reducir a 1/3 peek; si ya está en 1/3, cerrar
          if (drawer.classList.contains("expanded")) {
            collapseDrawerToPeek();
          } else {
            closeFeatureDrawer();
          }
        }
      }
      touchStartY = null;
      touchStartX = null;
    }, { passive: true });
  });
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

  // Plegar / Desplegar panel izquierdo (Requirement 1)
  const leftPanel = document.getElementById("leftPanel");
  const btnToggleLeft = document.getElementById("btnToggleLeftMenu");

  if (btnToggleLeft) {
    btnToggleLeft.addEventListener("click", () => {
      const isCollapsed = leftPanel.classList.toggle("collapsed");
      btnToggleLeft.classList.toggle("active", !isCollapsed);
    });
  }

  document.getElementById("btnCollapsePanel").addEventListener("click", () => {
    leftPanel.classList.add("collapsed");
    if (btnToggleLeft) btnToggleLeft.classList.remove("active");
  });

  document.getElementById("openPanelFab").addEventListener("click", () => {
    leftPanel.classList.remove("collapsed");
    if (btnToggleLeft) btnToggleLeft.classList.add("active");
  });

  // Menú Desplegable Integrado de la Barra Superior (Requirement 3)
  const btnTopMenuToggle = document.getElementById("btnTopMenuToggle");
  const topMenuDropdown = document.getElementById("topMenuDropdown");
  const btnCloseTopMenu = document.getElementById("btnCloseTopMenu");

  if (btnTopMenuToggle && topMenuDropdown) {
    btnTopMenuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = topMenuDropdown.classList.toggle("open");
      btnTopMenuToggle.classList.toggle("active", isOpen);
    });

    if (btnCloseTopMenu) {
      btnCloseTopMenu.addEventListener("click", (e) => {
        e.stopPropagation();
        topMenuDropdown.classList.remove("open");
        btnTopMenuToggle.classList.remove("active");
      });
    }

    document.addEventListener("click", (e) => {
      if (!topMenuDropdown.contains(e.target) && !btnTopMenuToggle.contains(e.target)) {
        topMenuDropdown.classList.remove("open");
        btnTopMenuToggle.classList.remove("active");
      }
    });
  }

  // Cerrar Drawer de Elemento
  document.getElementById("btnCloseDrawer").addEventListener("click", closeFeatureDrawer);

  // Configurar gestos y botones para deslizar/expandir el drawer (Requirement 2)
  setupDrawerGestures();

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
  // Sincronizar estado visual de todos los botones (escritorio y móvil)
  document.querySelectorAll(".basemap-btn").forEach(btn => {
    if (btn.dataset.base === baseKey) btn.classList.add("active");
    else btn.classList.remove("active");
  });
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
  const satSlider = document.getElementById("satSlider");

  // Valor por defecto: 30% (Requirement: satélite cargado al 30% de saturación)
  setSaturation(30);

  if (satSlider) {
    satSlider.value = 30;
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
  if (satValDisplay) satValDisplay.textContent = `Sat: ${value}%`;
  if (satValPopover) satValPopover.textContent = `${value}%`;
}

// ==============================================================================
// EXPORTACIÓN DE RECINTO A PDF (2 PÁGINAS: DATOS + PLANO A PÁGINA COMPLETA)
// ==============================================================================

function computeFeatureBbox(feature) {
  if (feature.bbox && feature.bbox.length === 4) {
    return feature.bbox.join(",");
  }
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function processCoords(coords) {
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(processCoords);
    }
  }
  if (feature.geometry && feature.geometry.coordinates) {
    processCoords(feature.geometry.coordinates);
  }
  if (minLng === Infinity) return null;
  return `${minLng.toFixed(6)},${minLat.toFixed(6)},${maxLng.toFixed(6)},${maxLat.toFixed(6)}`;
}

async function exportRecintoPDF(feature) {
  if (!feature) return;

  // Abrir ventana inmediatamente en el hilo síncrono del click para evitar bloqueo de pop-ups
  const printWindow = window.open("", "_blank", "width=1250,height=900");
  if (!printWindow) {
    alert("Por favor, permita las ventanas emergentes (pop-ups) en su navegador para exportar el documento PDF.");
    return;
  }

  // Pantalla temporal de carga estilizada
  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Generando Documento Oficial...</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
      <style>
        body {
          margin: 0; padding: 0; background: #0b0f17; color: #f8fafc;
          font-family: 'Inter', system-ui, sans-serif; height: 100vh;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
        }
        .loading-card {
          text-align: center; background: rgba(24, 24, 28, 0.9);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
          padding: 2.5rem 3rem; box-shadow: 0 20px 40px rgba(0,0,0,0.6);
        }
        .spinner {
          width: 38px; height: 38px; border: 3px solid rgba(56, 189, 248, 0.2);
          border-top-color: #38bdf8; border-radius: 50%;
          animation: spin 0.8s linear infinite; margin: 0 auto 1.25rem;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        h2 { font-family: 'Montserrat', sans-serif; font-size: 1.15rem; margin-bottom: 0.4rem; letter-spacing: 0.05em; color: #ffffff; }
        p { font-size: 0.82rem; color: #94a3b8; margin: 0; }
      </style>
    </head>
    <body>
      <div class="loading-card">
        <div class="spinner"></div>
        <h2>TESELAB CARTAGENA</h2>
        <p>Consultando inventario y preparando informe técnico oficial (2 páginas)...</p>
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();

  const p = feature.properties || {};
  const recintoCod = p.CODIGO || p.COD_recinto || p.COD_recint || "—";
  const recintoNombre = p.Nombre || p.NOM_recinto || p.COD_recinto || `Recinto #${feature.id}`;
  const recintoEstado = p.Estado || "—";
  const recintoSupNum = Number(p.SUP) || 0;
  const recintoSup = recintoSupNum > 0 ? recintoSupNum.toLocaleString("es-ES") + " m²" : "—";
  const recintoZona = p.Zona || "—";
  const recintoNucleo = p.NucleoUrb || "—";
  const recintoTitularidad = p.TITULARIDA || "Municipal";
  const recintoContrato = p.Contrato || "—";
  const fechaGeneracion = new Date().toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  // Consultar en OGC API los elementos de Arbolado y Superficies contenidos en este recinto
  const bbox = computeFeatureBbox(feature);
  let arboladoUrl = `${OGC_API_BASE}/collections/CT_Arbolado_y_palmeras/items?limit=2000`;
  let superficiesUrl = `${OGC_API_BASE}/collections/CT_Superficies/items?limit=1000`;

  if (recintoCod && recintoCod !== "—") {
    arboladoUrl += `&COD_recinto=${encodeURIComponent(recintoCod)}`;
    superficiesUrl += `&COD_recint=${encodeURIComponent(recintoCod)}`;
  } else if (bbox) {
    arboladoUrl += `&bbox=${bbox}`;
    superficiesUrl += `&bbox=${bbox}`;
  }

  let arboladoFeatures = [];
  let superficiesFeatures = [];

  try {
    const [arbRes, supRes] = await Promise.all([
      fetch(arboladoUrl).then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] })),
      fetch(superficiesUrl).then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] }))
    ]);
    arboladoFeatures = arbRes.features || [];
    superficiesFeatures = supRes.features || [];

    // Fallback a BBOX si por código no devuelve elementos pero existe bbox
    if (arboladoFeatures.length === 0 && bbox && recintoCod && recintoCod !== "—") {
      try {
        const fbArb = await fetch(`${OGC_API_BASE}/collections/CT_Arbolado_y_palmeras/items?bbox=${bbox}&limit=1000`).then(r => r.json());
        if (fbArb.features && fbArb.features.length > 0) arboladoFeatures = fbArb.features;
      } catch (_) {}
    }
    if (superficiesFeatures.length === 0 && bbox && recintoCod && recintoCod !== "—") {
      try {
        const fbSup = await fetch(`${OGC_API_BASE}/collections/CT_Superficies/items?bbox=${bbox}&limit=1000`).then(r => r.json());
        if (fbSup.features && fbSup.features.length > 0) superficiesFeatures = fbSup.features;
      } catch (_) {}
    }
  } catch (err) {
    console.error("Error al recopilar elementos para el informe de recinto:", err);
  }

  // Agregación de Arbolado y Palmeras para la Página 1
  const speciesMap = {};
  let countPalmeras = 0;
  let countArboles = 0;
  let countSingulares = 0;
  let countOtrosArb = 0;

  arboladoFeatures.forEach(f => {
    const ap = f.properties || {};
    const esp = (ap.Especie && ap.Especie !== "<NULL>") ? ap.Especie.trim() : (ap.Tipo ? ap.Tipo.trim() : "Especie no determinada");
    const tipo = (ap.Tipo || "").toLowerCase().trim();
    const tam = ap.Tamano || "—";

    if (tipo === "palmera") countPalmeras++;
    else if (tipo === "arbol") countArboles++;
    else if (tipo === "arbol singular") countSingulares++;
    else countOtrosArb++;

    if (!speciesMap[esp]) {
      speciesMap[esp] = {
        nombre: esp,
        tipo: ap.Tipo || "Árbol",
        tamano: tam,
        count: 0
      };
    }
    speciesMap[esp].count++;
  });

  const speciesList = Object.values(speciesMap).sort((a, b) => b.count - a.count);
  const totalArbolado = arboladoFeatures.length;
  const totalEspecies = speciesList.length;

  // Construir filas de la tabla de arbolado (con límite de 5 para evitar desborde en Página 1)
  let arboladoTableRows = "";
  if (totalArbolado === 0) {
    arboladoTableRows = `<tr><td colspan="5" class="empty-cell">No se registran ejemplares de arbolado o palmeras inventariados en este recinto.</td></tr>`;
  } else {
    const maxArbRows = 5;
    const displayedSpecies = speciesList.slice(0, maxArbRows);
    displayedSpecies.forEach(sp => {
      const pct = ((sp.count / totalArbolado) * 100).toFixed(1) + "%";
      arboladoTableRows += `
        <tr>
          <td><strong style="color: #0f172a;">${sp.nombre}</strong></td>
          <td><span class="badge-tag">${sp.tipo}</span></td>
          <td style="color: #475569;">${sp.tamano}</td>
          <td class="text-right"><strong>${sp.count}</strong></td>
          <td class="text-right" style="color: #64748b;">${pct}</td>
        </tr>
      `;
    });

    if (speciesList.length > maxArbRows) {
      const remainingSpecies = speciesList.slice(maxArbRows);
      const remainingCount = remainingSpecies.reduce((acc, cur) => acc + cur.count, 0);
      const pctRest = ((remainingCount / totalArbolado) * 100).toFixed(1) + "%";
      arboladoTableRows += `
        <tr class="rest-row">
          <td colspan="3" style="font-style: italic; color: #64748b;">Otras especies (${remainingSpecies.length} especies adicionales)...</td>
          <td class="text-right"><strong>${remainingCount}</strong></td>
          <td class="text-right" style="color: #64748b;">${pctRest}</td>
        </tr>
      `;
    }
  }

  // Agregación de Superficies para la Página 1
  const supMap = {};
  let totalSuperficiesM2 = 0;

  superficiesFeatures.forEach(f => {
    const sp = f.properties || {};
    const elem = (sp.Elemento || "otros").toLowerCase().trim();
    const supVal = Number(sp.SUP) || 0;
    totalSuperficiesM2 += supVal;

    if (!supMap[elem]) {
      supMap[elem] = {
        elemento: elem,
        count: 0,
        m2: 0
      };
    }
    supMap[elem].count++;
    supMap[elem].m2 += supVal;
  });

  const supList = Object.values(supMap).sort((a, b) => b.m2 - a.m2);
  const totalSuperficies = superficiesFeatures.length;
  const superficiesM2Text = totalSuperficiesM2 > 0 ? totalSuperficiesM2.toLocaleString("es-ES") + " m²" : "0 m²";
  const porcentajeSuperficie = (recintoSupNum > 0 && totalSuperficiesM2 > 0)
    ? ((totalSuperficiesM2 / recintoSupNum) * 100).toFixed(1)
    : "—";

  // Mapeo de colores QGIS para superficies
  const COLOR_SUPERFICIES_MAP = {
    silvestre: "#7454b4",
    jardin: "#30de30",
    cesped: "#70b552",
    "pavimento duro": "#b2bba1",
    "pavimento blando": "#f6ec7b",
    "tierra desnuda": "#eec261",
    "zona de juegos": "#8be1cc",
    "zona deportiva": "#5479b4",
    pergola: "#838383",
    construccion: "#5e5177",
    fuente: "#7ecef3",
    otros: "#888888"
  };

  // Construir filas de la tabla de superficies
  let superficiesTableRows = "";
  if (totalSuperficies === 0) {
    superficiesTableRows = `<tr><td colspan="4" class="empty-cell">No se registran polígonos de superficie inventariados en este recinto.</td></tr>`;
  } else {
    supList.forEach(s => {
      const color = COLOR_SUPERFICIES_MAP[s.elemento] || "#94a3b8";
      const pctRecinto = recintoSupNum > 0 ? ((s.m2 / recintoSupNum) * 100).toFixed(1) + "%" : "—";
      superficiesTableRows += `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="display: inline-block; width: 12px; height: 12px; border-radius: 3px; background-color: ${color}; border: 1px solid rgba(0,0,0,0.2);"></span>
              <strong style="text-transform: capitalize; color: #0f172a;">${s.elemento}</strong>
            </div>
          </td>
          <td class="text-center"><strong>${s.count}</strong></td>
          <td class="text-right"><strong>${s.m2.toLocaleString("es-ES")} m²</strong></td>
          <td class="text-right" style="color: #64748b;">${pctRecinto}</td>
        </tr>
      `;
    });
  }

  // Construcción de la leyenda dinámica para la Página 2
  let legendSuperficiesItems = "";
  supList.forEach(s => {
    const color = COLOR_SUPERFICIES_MAP[s.elemento] || "#94a3b8";
    legendSuperficiesItems += `
      <div class="legend-row">
        <span class="legend-swatch" style="background-color: ${color};"></span>
        <span class="legend-txt" style="text-transform: capitalize;">${s.elemento}</span>
      </div>
    `;
  });

  let legendArbItems = "";
  if (countPalmeras > 0) {
    legendArbItems += `
      <div class="legend-row">
        <span class="legend-circle" style="background-color: #7d9e29;"></span>
        <span class="legend-txt">Palmera (${countPalmeras})</span>
      </div>
    `;
  }
  if (countArboles > 0) {
    legendArbItems += `
      <div class="legend-row">
        <span class="legend-circle" style="background-color: #216322;"></span>
        <span class="legend-txt">Árbol (${countArboles})</span>
      </div>
    `;
  }
  if (countSingulares > 0) {
    legendArbItems += `
      <div class="legend-row">
        <span class="legend-circle" style="background-color: #5a6e44; border-color: #f59e0b;"></span>
        <span class="legend-txt">Árbol Singular (${countSingulares})</span>
      </div>
    `;
  }
  if (countOtrosArb > 0) {
    legendArbItems += `
      <div class="legend-row">
        <span class="legend-circle" style="background-color: #b7484b;"></span>
        <span class="legend-txt">Alcorque / Marra (${countOtrosArb})</span>
      </div>
    `;
  }

  const featureJson = JSON.stringify(feature);
  const superficiesJson = JSON.stringify({ type: "FeatureCollection", features: superficiesFeatures });
  const arboladoJson = JSON.stringify({ type: "FeatureCollection", features: arboladoFeatures });

  const documentHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>TESELAB Cartagena - Ficha Técnica: ${recintoNombre} (${recintoCod})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      color: #0f172a;
      -webkit-font-smoothing: antialiased;
    }

    /* Barra Superior para pantalla (oculta en PDF) */
    .screen-toolbar {
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      background: #0f172a;
      color: #ffffff;
      padding: 0.75rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 9999;
      box-shadow: 0 4px 15px rgba(0,0,0,0.4);
    }
    .toolbar-info {
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .toolbar-badge {
      background: #0284c7;
      color: #ffffff;
      font-weight: 700;
      font-size: 0.72rem;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
    }
    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .btn-tool {
      border: none;
      cursor: pointer;
      font-weight: 700;
      font-size: 0.82rem;
      padding: 0.55rem 1.1rem;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      transition: all 0.2s;
    }
    .btn-tool.primary {
      background: #0284c7;
      color: #ffffff;
    }
    .btn-tool.primary:hover {
      background: #0369a1;
    }
    .btn-tool.secondary {
      background: rgba(255,255,255,0.12);
      color: #f1f5f9;
    }
    .btn-tool.secondary:hover {
      background: rgba(255,255,255,0.22);
    }

    /* Estructura A4 de las dos páginas */
    @media screen {
      body {
        background: #1e293b;
        padding-bottom: 3rem;
      }
      .page-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2rem;
        margin-top: 1.5rem;
      }
      .print-page {
        width: 210mm;
        height: 297mm;
        background: #ffffff;
        box-shadow: 0 10px 35px rgba(0,0,0,0.5);
        border-radius: 6px;
        padding: 10mm 12mm;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        position: relative;
        overflow: hidden;
      }
    }

    @media print {
      @page {
        size: A4 portrait;
        margin: 8mm 10mm;
      }
      html, body {
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .screen-toolbar {
        display: none !important;
      }
      .page-container {
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .print-page {
        width: 100% !important;
        height: 275mm !important;
        max-height: 275mm !important;
        padding: 0 !important;
        margin: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: space-between !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        overflow: hidden !important;
      }
      .page-1 {
        page-break-after: always !important;
        break-after: page !important;
      }
      .page-2 {
        page-break-before: always !important;
        break-before: page !important;
        page-break-after: auto !important;
        break-after: auto !important;
      }
      .print-tile-pane {
        filter: saturate(30%) !important;
      }
    }

    /* Encabezados y Secciones */
    .page-header {
      background: #0f172a;
      color: #ffffff;
      padding: 10px 14px;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .brand-title {
      font-family: 'Montserrat', sans-serif;
      font-size: 1.15rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .brand-accent {
      color: #38bdf8;
    }
    .brand-sub {
      font-size: 0.65rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-top: 2px;
    }
    .doc-badge {
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #38bdf8;
      font-weight: 700;
      font-size: 0.68rem;
      padding: 0.2rem 0.6rem;
      border-radius: 4px;
      text-align: right;
    }
    .doc-date {
      font-size: 0.65rem;
      color: #94a3b8;
      margin-top: 2px;
      text-align: right;
    }

    .section-wrap {
      margin-bottom: 9px;
    }
    .section-header-title {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.76rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #0f172a;
      border-bottom: 1.5px solid #cbd5e1;
      padding-bottom: 3px;
      margin-bottom: 6px;
    }

    /* Grid de Datos del Recinto */
    .recinto-meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 5px 8px;
    }
    .meta-box.span-2 {
      grid-column: span 2;
    }
    .meta-box.span-4 {
      grid-column: span 4;
    }
    .meta-lbl {
      font-size: 0.62rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
    }
    .meta-val {
      font-size: 0.8rem;
      font-weight: 700;
      color: #0f172a;
      margin-top: 1px;
      word-break: break-word;
    }
    .meta-val.code {
      color: #0284c7;
    }
    .meta-val.highlight {
      color: #059669;
    }

    /* KPIs de Resumen */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .kpi-card {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      padding: 6px 10px;
      text-align: center;
    }
    .kpi-val {
      font-family: 'Montserrat', sans-serif;
      font-size: 1.15rem;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.1;
    }
    .kpi-card.trees .kpi-val { color: #059669; }
    .kpi-card.surfaces .kpi-val { color: #d97706; }
    .kpi-card.ratio .kpi-val { color: #0284c7; }
    .kpi-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      color: #334155;
      margin-top: 2px;
    }
    .kpi-sub {
      font-size: 0.58rem;
      color: #64748b;
    }

    /* Tablas de Inventario */
    .inventory-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.7rem;
    }
    .inventory-table th {
      background: #f1f5f9;
      color: #475569;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-size: 0.62rem;
      padding: 4px 6px;
      border: 1px solid #cbd5e1;
      text-align: left;
    }
    .inventory-table td {
      padding: 4px 6px;
      border: 1px solid #e2e8f0;
      color: #334155;
    }
    .inventory-table tr:nth-child(even) td {
      background-color: #f8fafc;
    }
    .badge-tag {
      background: #e2e8f0;
      color: #1e293b;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.6rem;
      font-weight: 600;
      text-transform: capitalize;
    }
    .empty-cell {
      text-align: center;
      padding: 10px !important;
      color: #94a3b8;
      font-style: italic;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }

    /* Footer de Página */
    .page-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.64rem;
      color: #64748b;
    }

    /* PÁGINA 2: MAPA A PÁGINA COMPLETA */
    .map-page-wrapper {
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 238mm;
      position: relative;
      border-radius: 6px;
      overflow: hidden;
      border: 1.5px solid #cbd5e1;
    }
    #printMap {
      width: 100%;
      height: 100%;
      min-height: 238mm;
      background: #121212;
    }
    .print-tile-pane {
      filter: saturate(30%);
    }

    /* Leyenda Cartográfica Flotante en Página 2 */
    .map-floating-legend {
      position: absolute;
      bottom: 12px;
      left: 12px;
      z-index: 1000;
      background: rgba(15, 23, 42, 0.9);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      padding: 8px 12px;
      color: #ffffff;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      max-width: 280px;
    }
    .legend-title {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #38bdf8;
      border-bottom: 1px solid rgba(255,255,255,0.15);
      padding-bottom: 3px;
      margin-bottom: 5px;
    }
    .legend-row {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 3px;
    }
    .legend-row:last-child {
      margin-bottom: 0;
    }
    .legend-line {
      display: inline-block;
      width: 16px;
      height: 3px;
      background-color: #0284c7;
      border-radius: 1px;
    }
    .legend-swatch {
      display: inline-block;
      width: 12px;
      height: 10px;
      border-radius: 2px;
      border: 1px solid rgba(255,255,255,0.3);
    }
    .legend-circle {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 1.5px solid #ffffff;
    }
    .legend-txt {
      font-size: 0.65rem;
      color: #f1f5f9;
      font-weight: 500;
    }

    /* Norte Cartográfico */
    .north-arrow-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 1000;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 5px 8px;
      color: #ffffff;
      text-align: center;
      box-shadow: 0 4px 15px rgba(0,0,0,0.4);
    }
    .north-arrow-symbol {
      font-size: 0.85rem;
      line-height: 1;
      color: #38bdf8;
    }
    .north-arrow-text {
      font-family: 'Montserrat', sans-serif;
      font-size: 0.62rem;
      font-weight: 800;
      margin-top: 1px;
    }
  </style>
</head>
<body>
  <!-- Barra de Herramientas de Pantalla -->
  <div class="screen-toolbar no-print">
    <div class="toolbar-info">
      <span class="toolbar-badge">INFORME OFICIAL</span>
      <span><strong>${recintoNombre}</strong> (${recintoCod}) &bull; Documento de 2 Páginas</span>
    </div>
    <div class="toolbar-actions">
      <button class="btn-tool secondary" onclick="window.close()">Cerrar</button>
      <button class="btn-tool primary" onclick="window.print()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
        <span>Imprimir / Guardar como PDF (2 Páginas)</span>
      </button>
    </div>
  </div>

  <div class="page-container">
    <!-- ======================================================================= -->
    <!-- PÁGINA 1: DATOS GENERALES DEL RECINTO Y TODOS LOS ELEMENTOS CONTENIDOS -->
    <!-- ======================================================================= -->
    <section class="print-page page-1">
      <div>
        <header class="page-header">
          <div>
            <div class="brand-title">TESELAB <span class="brand-accent">CARTAGENA</span></div>
            <div class="brand-sub">TESELA GESTIÓN CULTURAL Y PATRIMONIO S.L. &bull; INVENTARIO DE INFRAESTRUCTURA VERDE</div>
          </div>
          <div>
            <div class="doc-badge">FICHA TÉCNICA OFICIAL</div>
            <div class="doc-date">Emisión: ${fechaGeneracion}</div>
          </div>
        </header>

        <!-- Bloque 1: Identificación y Datos Generales del Recinto -->
        <div class="section-wrap">
          <div class="section-header-title">1. Identificación y Datos Generales del Recinto</div>
          <div class="recinto-meta-grid">
            <div class="meta-box span-2">
              <div class="meta-lbl">Nombre / Denominación Oficial</div>
              <div class="meta-val">${recintoNombre}</div>
            </div>
            <div class="meta-box">
              <div class="meta-lbl">Código Oficial</div>
              <div class="meta-val code">${recintoCod}</div>
            </div>
            <div class="meta-box">
              <div class="meta-lbl">Estado / Clasificación</div>
              <div class="meta-val">${recintoEstado}</div>
            </div>

            <div class="meta-box">
              <div class="meta-lbl">Superficie Total Registrada</div>
              <div class="meta-val highlight">${recintoSup}</div>
            </div>
            <div class="meta-box">
              <div class="meta-lbl">Zona Territorial</div>
              <div class="meta-val">${recintoZona}</div>
            </div>
            <div class="meta-box">
              <div class="meta-lbl">Núcleo Urbano</div>
              <div class="meta-val">${recintoNucleo}</div>
            </div>
            <div class="meta-box">
              <div class="meta-lbl">Titularidad</div>
              <div class="meta-val">${recintoTitularidad}</div>
            </div>

            <div class="meta-box span-4">
              <div class="meta-lbl">Contrato / Lote Asignado</div>
              <div class="meta-val">${recintoContrato}</div>
            </div>
          </div>
        </div>

        <!-- Bloque 2: Resumen Cuantitativo de Elementos Contenidos -->
        <div class="section-wrap">
          <div class="section-header-title">2. Resumen Cuantitativo de Elementos Contenidos</div>
          <div class="kpi-grid">
            <div class="kpi-card trees">
              <div class="kpi-val">${totalArbolado}</div>
              <div class="kpi-label">Arbolado y Palmeras</div>
              <div class="kpi-sub">${totalEspecies} especies botánicas inventariadas</div>
            </div>
            <div class="kpi-card surfaces">
              <div class="kpi-val">${superficiesM2Text}</div>
              <div class="kpi-label">Superficie Delimitada</div>
              <div class="kpi-sub">${totalSuperficies} zonas poligonales clasificadas</div>
            </div>
            <div class="kpi-card ratio">
              <div class="kpi-val">${porcentajeSuperficie}%</div>
              <div class="kpi-label">Cobertura de Superficies</div>
              <div class="kpi-sub">Respecto al área total del recinto</div>
            </div>
          </div>
        </div>

        <!-- Bloque 3: Inventario de Vegetación: Arbolado y Palmeras -->
        <div class="section-wrap">
          <div class="section-header-title">3. Inventario de Vegetación: Arbolado y Palmeras Contenidas</div>
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Especie Botánica</th>
                <th>Tipo</th>
                <th>Tamaño Predominante</th>
                <th class="text-right">Ejemplares</th>
                <th class="text-right">% Total</th>
              </tr>
            </thead>
            <tbody>
              ${arboladoTableRows}
            </tbody>
          </table>
        </div>

        <!-- Bloque 4: Inventario de Superficies por Tipología -->
        <div class="section-wrap">
          <div class="section-header-title">4. Inventario de Superficies Contenidas por Tipología</div>
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Elemento de Superficie</th>
                <th class="text-center">Polígonos</th>
                <th class="text-right">Superficie (m²)</th>
                <th class="text-right">% Recinto</th>
              </tr>
            </thead>
            <tbody>
              ${superficiesTableRows}
            </tbody>
          </table>
        </div>
      </div>

      <footer class="page-footer">
        <div>TESELAB Cartagena &bull; TESELA Gestión Cultural y Patrimonio S.L. &bull; www.teselaestudio.es</div>
        <div>Página 1 de 2</div>
      </footer>
    </section>

    <!-- ======================================================================= -->
    <!-- PÁGINA 2: PLANO CARTOGRÁFICO A PÁGINA COMPLETA CON ELEMENTOS DIBUJADOS  -->
    <!-- ======================================================================= -->
    <section class="print-page page-2">
      <header class="page-header" style="margin-bottom: 6px; padding: 7px 12px;">
        <div>
          <div class="brand-title" style="font-size: 0.95rem;">TESELAB <span class="brand-accent">CARTAGENA</span> &bull; <span style="font-size: 0.8rem; font-weight: 600;">PLANO CARTOGRÁFICO DE RECINTO</span></div>
        </div>
        <div style="font-size: 0.72rem; color: #cbd5e1; text-align: right;">
          <strong>${recintoNombre}</strong> (${recintoCod}) &bull; ${recintoSup}
        </div>
      </header>

      <div class="map-page-wrapper">
        <div id="printMap"></div>

        <!-- Leyenda Cartográfica Flotante -->
        <div class="map-floating-legend">
          <div class="legend-title">Leyenda Cartográfica</div>
          <div class="legend-row">
            <span class="legend-line"></span>
            <span class="legend-txt">Perímetro del Recinto (${recintoCod})</span>
          </div>
          ${legendSuperficiesItems}
          ${legendArbItems}
        </div>

        <!-- Flecha Norte -->
        <div class="north-arrow-badge">
          <div class="north-arrow-symbol">▲</div>
          <div class="north-arrow-text">N</div>
        </div>
      </div>

      <footer class="page-footer" style="margin-top: 6px;">
        <div>Fondo: Ortofoto Google Satélite (30% Saturación) &bull; OGC API Features &bull; Mergin Maps</div>
        <div>Página 2 de 2</div>
      </footer>
    </section>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const recintoData = ${featureJson};
    const superficiesData = ${superficiesJson};
    const arboladoData = ${arboladoJson};

    const map = L.map('printMap', {
      zoomControl: false,
      attributionControl: false
    });

    // Fondo Satélite con saturación al 30%
    const satLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 21,
      className: 'print-tile-pane'
    }).addTo(map);

    // Paneles para apilamiento exacto
    map.createPane('recintosPane');
    map.getPane('recintosPane').style.zIndex = 410;

    map.createPane('superficiesPane');
    map.getPane('superficiesPane').style.zIndex = 420;

    map.createPane('arboladoPane');
    map.getPane('arboladoPane').style.zIndex = 430;

    // 1. Recinto (Límite perimetral)
    const recintoLayer = L.geoJSON(recintoData, {
      pane: 'recintosPane',
      style: {
        color: '#0284c7',
        weight: 3.5,
        fillColor: 'rgba(2, 132, 199, 0.08)',
        fillOpacity: 1,
        dashArray: '5, 5'
      }
    }).addTo(map);

    // 2. Superficies (con colores exactos de QGIS)
    const COLOR_SUPERFICIES_MAP = {
      silvestre: 'rgba(116, 84, 180, 0.85)',
      jardin: 'rgba(48, 222, 48, 0.70)',
      cesped: 'rgba(112, 181, 82, 0.75)',
      'pavimento duro': 'rgba(178, 187, 161, 0.75)',
      'pavimento blando': 'rgba(246, 236, 123, 0.75)',
      'tierra desnuda': 'rgba(238, 194, 97, 0.75)',
      'zona de juegos': 'rgba(139, 225, 204, 0.75)',
      'zona deportiva': 'rgba(84, 121, 180, 0.75)',
      pergola: 'rgba(131, 131, 131, 0.85)',
      construccion: 'rgba(94, 81, 119, 0.85)',
      fuente: 'rgba(126, 206, 243, 0.85)',
      otros: 'rgba(136, 136, 136, 0.75)'
    };

    if (superficiesData.features && superficiesData.features.length > 0) {
      L.geoJSON(superficiesData, {
        pane: 'superficiesPane',
        style: function(f) {
          const elem = (f.properties?.Elemento || 'otros').toLowerCase().trim();
          return {
            fillColor: COLOR_SUPERFICIES_MAP[elem] || 'rgba(167, 167, 167, 0.7)',
            fillOpacity: 0.85,
            color: '#0f172a',
            weight: 1.2,
            opacity: 1
          };
        }
      }).addTo(map);
    }

    // 3. Arbolado y Palmeras (con simbología exacta de QGIS)
    if (arboladoData.features && arboladoData.features.length > 0) {
      arboladoData.features.forEach(f => {
        if (f.geometry && f.geometry.type === 'Point') {
          const [lng, lat] = f.geometry.coordinates;
          const p = f.properties || {};
          const tipo = (p.Tipo || '').toLowerCase().trim();
          const tamano = (p.Tamano || '').trim();

          let radius = 5.5;
          let fillColor = '#216322';
          let strokeColor = '#ffffff';
          let weight = 1.2;

          if (tipo === 'palmera') {
            fillColor = '#7d9e29';
            if (tamano === 'Mas de 6 m') radius = 8;
            else if (tamano === 'De 3 a 6 m') radius = 6;
            else radius = 4.5;
          } else if (tipo === 'arbol') {
            fillColor = '#216322';
            if (tamano === 'Mas de 6 m') radius = 8.5;
            else if (tamano === 'De 3 a 6 m') radius = 6;
            else radius = 4.5;
          } else if (tipo === 'arbol singular') {
            fillColor = '#5a6e44';
            radius = 10;
            strokeColor = '#f59e0b';
            weight = 2;
          } else if (tipo === 'm' || tipo === 'mr') {
            fillColor = '#7b5c2a';
            radius = 4;
          } else if (tipo === 't' || tipo === 'tr') {
            fillColor = '#312a1e';
            radius = 3.5;
          } else if (tipo === 'a' || tipo === 'ar') {
            fillColor = 'rgba(183, 72, 75, 0.2)';
            strokeColor = '#b7484b';
            weight = 1.5;
            radius = 4;
          }

          L.circleMarker([lat, lng], {
            pane: 'arboladoPane',
            radius: radius,
            fillColor: fillColor,
            color: strokeColor,
            weight: weight,
            opacity: 1,
            fillOpacity: 0.95
          }).addTo(map);
        }
      });
    }

    // Ajuste de cámara centrado en el recinto
    const bounds = recintoLayer.getBounds();
    map.fitBounds(bounds, { padding: [40, 40] });

    let printTriggered = false;
    function doPrint() {
      if (printTriggered) return;
      printTriggered = true;
      setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [40, 40] });
        setTimeout(() => {
          window.print();
        }, 500);
      }, 300);
    }

    satLayer.on('load', doPrint);
    setTimeout(doPrint, 1800);
  </script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(documentHtml);
  printWindow.document.close();
}

// Iniciar al cargar
window.addEventListener("DOMContentLoaded", initVisor);
