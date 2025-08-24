import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const parseCoord = (s) => {
  // expects "lat,lon" OR "lon,lat". We'll try both safely.
  if (!s) return null;
  const parts = s.split(",").map(v => parseFloat(v.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
  // Heuristic: lat is between -90..90, lon -180..180
  const [a, b] = parts;
  const looksLikeLatLon = Math.abs(a) <= 90 && Math.abs(b) <= 180;
  return looksLikeLatLon ? { lat: a, lon: b } : { lat: b, lon: a };
};

const toLonLatStr = ({ lon, lat }) => `${lon},${lat}`;

export default function App() {
  const mapRef = useRef(null);
  const map = useRef(null);
  const [loading, setLoading] = useState(false);

  const [start, setStart] = useState("");       // "lat,lon"
  const [dest, setDest] = useState("");         // "lat,lon"
  const [stopsText, setStopsText] = useState(""); // one per line "lat,lon"

  useEffect(() => {
    if (map.current) return;
    map.current = new mapboxgl.Map({
      container: mapRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [80.7718, 7.8731], // Sri Lanka approx
      zoom: 6,
    });

    map.current.on("load", () => {
      // Add an empty source for the route geometry:
      if (!map.current.getSource("route")) {
        map.current.addSource("route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.current.getLayer("route-line")) {
        map.current.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-width": 5 }
        });
      }

      // Source+layer for markers (start/stops/dest)
      if (!map.current.getSource("points")) {
        map.current.addSource("points", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.current.getLayer("points-circle")) {
        map.current.addLayer({
          id: "points-circle",
          type: "circle",
          source: "points",
          paint: {
            "circle-radius": 6
          }
        });
      }
    });
  }, []);

  const fitToBounds = (coords) => {
    if (!map.current || !coords?.length) return;
    const bounds = new mapboxgl.LngLatBounds();
    coords.forEach(([lon, lat]) => bounds.extend([lon, lat]));
    map.current.fitBounds(bounds, { padding: 60, duration: 800 });
  };

  const drawPoints = (features) => {
    const src = map.current.getSource("points");
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features
    });
  };

  const drawRoute = (geojson) => {
    const src = map.current.getSource("route");
    if (!src) return;
    src.setData(geojson || { type: "FeatureCollection", features: [] });
  };

  const clearMap = () => {
    drawRoute(null);
    drawPoints([]);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setStart(`${latitude.toFixed(6)},${longitude.toFixed(6)}`);
        if (map.current) {
          map.current.flyTo({ center: [longitude, latitude], zoom: 13 });
        }
      },
      (err) => alert("Location error: " + err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const buildDirectionsUrl = (startCoord, endCoord) => {
    const coords = `${toLonLatStr(startCoord)};${toLonLatStr(endCoord)}`;
    const params = new URLSearchParams({
      geometries: "geojson",
      overview: "full",
      access_token: mapboxgl.accessToken
    });
    return `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?${params.toString()}`;
  };

  const buildOptimizationUrl = (orderedLonLat) => {
    // orderedLonLat: [[lon,lat], [lon,lat], ...]
    const coordsStr = orderedLonLat.map(([lon, lat]) => `${lon},${lat}`).join(";");
    const params = new URLSearchParams({
      source: "first",
      destination: "last",
      roundtrip: "false",
      geometries: "geojson",
      overview: "full",
      access_token: mapboxgl.accessToken
    });
    return `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordsStr}?${params.toString()}`;
  };

  const onOptimize = async () => {
    clearMap();

    const startCoord = parseCoord(start);
    const destCoord = parseCoord(dest);
    const stopCoords = (stopsText || "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)
      .map(parseCoord)
      .filter(Boolean);

    if (!startCoord || !destCoord) {
      alert("Please provide valid START and DESTINATION in 'lat,lon' format.");
      return;
    }

    setLoading(true);
    try {
      // Decide API:
      // If only start+end: use Directions API (cheaper/simpler).
      // If there are 1+ stops: use Optimization API v1 (returns geometry).
      let routeGeoJSON = null;
      let displayPoints = [];

      if (stopCoords.length === 0) {
        const url = buildDirectionsUrl(startCoord, destCoord);
        const res = await fetch(url);
        const data = await res.json();
        if (!data?.routes?.[0]) throw new Error("No route found.");
        routeGeoJSON = {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: data.routes[0].geometry,
            properties: {}
          }]
        };
        displayPoints = [
          { type: "Feature", geometry: { type: "Point", coordinates: [startCoord.lon, startCoord.lat] }, properties: { role: "start" } },
          { type: "Feature", geometry: { type: "Point", coordinates: [destCoord.lon, destCoord.lat] }, properties: { role: "destination" } }
        ];
        drawRoute(routeGeoJSON);
        drawPoints(displayPoints);
        fitToBounds(routeGeoJSON.features[0].geometry.coordinates);
      } else {
        const allLonLat = [
          [startCoord.lon, startCoord.lat],
          ...stopCoords.map(s => [s.lon, s.lat]),
          [destCoord.lon, destCoord.lat]
        ];
        const url = buildOptimizationUrl(allLonLat);
        const res = await fetch(url);
        const data = await res.json();
        if (!data?.trips?.[0]) throw new Error(data?.message || "No optimized trip found.");
        const trip = data.trips[0];

        routeGeoJSON = {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: trip.geometry,
            properties: {}
          }]
        };

        // Show the optimized waypoint order as markers:
        const wpFeatures = (data.waypoints || [])
          .sort((a, b) => a.waypoint_index - b.waypoint_index)
          .map((w, i) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: w.location },
            properties: { label: i === 0 ? "Start" : (i === data.waypoints.length - 1 ? "Destination" : `Stop ${i}`) }
          }));

        drawRoute(routeGeoJSON);
        drawPoints(wpFeatures);
        fitToBounds(trip.geometry.coordinates);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to build route: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="controls">
        <div className="badge">Mapbox Route Optimization • React</div>
        <button onClick={useMyLocation} disabled={loading}>Use my location (start)</button>
        <label>Start (lat,lon)</label>
        <input
          placeholder="6.9271,79.8612"
          value={start}
          onChange={e => setStart(e.target.value)}
        />
        <label>Destination (lat,lon)</label>
        <input
          placeholder="7.2906,80.6337"
          value={dest}
          onChange={e => setDest(e.target.value)}
        />
        <label>Stops (optional) — one per line (lat,lon)</label>
        <textarea
          rows={4}
          placeholder={"7.8731,80.7718\n6.0535,80.2210"}
          value={stopsText}
          onChange={e => setStopsText(e.target.value)}
        />
        <button onClick={onOptimize} disabled={loading}>
          {loading ? "Optimizing..." : "Optimize & Draw"}
        </button>
        <div className="badge">
          Tip: For 2 points, this uses Directions API. For 3+ points, it uses Optimization API (v1).
        </div>
      </div>
      <div ref={mapRef} className="map-container" />
    </>
  );
}
