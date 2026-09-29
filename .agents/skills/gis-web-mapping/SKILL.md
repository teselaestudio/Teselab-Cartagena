---
name: gis-web-mapping
description: Spatial data visualization, web GIS architecture, and map viewer integration (Leaflet, MapLibre, OpenLayers, WMS/WMTS, GeoJSON). Use when building map view interfaces, handling geospatial data, configuring spatial layers for Cartagena / Spain (PNOA, IGN, CARM), or adding interactive GIS tools.
license: MIT
---

# GIS Web Mapping Skill

Guide and standard practices for building high-performance, lightweight web mapping viewers and spatial data portals for the Cartagena region.

## 1. Map Engine Selection
- **Leaflet.js**: Best for lightweight, mobile-responsive, zero-build 2D web viewers. Ideal for GitHub Pages deployment via CDN.
- **MapLibre GL JS**: Best for vector tiles, 3D terrain, smooth tilting/rotation, and large spatial datasets.
- **OpenLayers**: Best for complex OGC standards, advanced reprojections, and CAD/WFS-T editing.

## 2. Spanish Spatial Data Infrastructure (IDEE) Resources
For Cartagena and Región de Murcia:
- **PNOA Ortofoto (IGN)**: WMTS / WMS aerial imagery:
  `https://www.ign.es/wmts/pnoa-ma?request=GetCapabilities&service=WMTS`
- **Cartografía Raster IGN**:
  `https://www.ign.es/wmts/mapa-raster?request=GetCapabilities&service=WMTS`
- **Catastro (WMS)**:
  `https://ovc.catastro.meh.es/Cartografia/WMS/BuscarFirma.aspx`
- **IDE Murcia (CARM)**:
  WMS regional layers for urban planning, environmental constraints, and heritage.

## 3. Best Practices
- **Coordinate Systems**: Support EPSG:4326 (WGS84) for GeoJSON/GPS data and EPSG:3857 (Web Mercator) for basemaps. Use Proj4js when EPSG:25830 (ETRS89 / UTM zone 30N, official in Spain) conversions are required.
- **Performance**:
  - Do not load monolithic GeoJSON files over 5-10MB directly in client memory; use GeoJSON tiling, clustering (Leaflet.markercluster), or simplified geometry.
  - Set appropriate minZoom and maxZoom levels.
  - Implement layer switchers (Base Layers vs. Overlays).
- **Responsive Controls**:
  - Position zoom and attribution controls unobtrusively.
  - Provide scale bars, geolocation buttons, and full-screen toggles.
