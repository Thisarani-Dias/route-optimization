import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken =
  "pk.eyJ1IjoidGhpc2FyYW5pZGlhcyIsImEiOiJjbWVwaGhkZHowdWF6MmpvdGhwNm53cWxvIn0.mB8D1busNcpvOEoiiz8IzQ";

export default function RouteMap() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [destinations, setDestinations] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [currentLocation, setCurrentLocation] = useState(null);

  // Initialize map
  useEffect(() => {
    if (map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [79.8612, 6.9271], // default Colombo
      zoom: 12,
    });

    map.current.addControl(new mapboxgl.NavigationControl());

    // Add empty sources and layers for route
    map.current.on("load", () => {
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
          paint: { "line-width": 5, "line-color": "#3b82f6" },
        });
      }
    });
  }, []);

  // Detect current location
  const detectLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported by your browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        setCurrentLocation([lng, lat]);

        map.current.flyTo({ center: [lng, lat], zoom: 14 });

        new mapboxgl.Marker({ color: "blue" })
          .setLngLat([lng, lat])
          .setPopup(new mapboxgl.Popup().setText("You are here"))
          .addTo(map.current);
      },
      (err) => {
        alert("Unable to retrieve your location: " + err.message);
      }
    );
  };

  // Add a destination
  const addDestination = () => {
    if (!inputValue.trim()) return;

    fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        inputValue
      )}.json?access_token=${mapboxgl.accessToken}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.features.length > 0) {
          const coords = data.features[0].geometry.coordinates;
          setDestinations((prev) => [...prev, coords]);

          new mapboxgl.Marker({ color: "red" })
            .setLngLat(coords)
            .setPopup(new mapboxgl.Popup().setText(inputValue))
            .addTo(map.current);

          map.current.flyTo({ center: coords, zoom: 12 });
        } else {
          alert("Place not found.");
        }
      });
    setInputValue("");
  };

  // Draw optimized route using Mapbox Optimization API
  const drawOptimizedRoute = async () => {
    if (!currentLocation) {
      alert("Please detect your current location first!");
      return;
    }
    if (destinations.length === 0) {
      alert("Please add at least one destination.");
      return;
    }

    const allCoords = [currentLocation, ...destinations];
    const coordsStr = allCoords.map((c) => c.join(",")).join(";");
    const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordsStr}?source=first&destination=last&roundtrip=false&geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.trips || !data.trips[0]) throw new Error("No optimized route found");

      const geojson = {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: data.trips[0].geometry }],
      };

      // Ensure the source exists
      if (!map.current.getSource("route")) {
        map.current.addSource("route", { type: "geojson", data: geojson });
        if (!map.current.getLayer("route-line")) {
          map.current.addLayer({
            id: "route-line",
            type: "line",
            source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-width": 5, "line-color": "#3b82f6" },
          });
        }
      } else {
        map.current.getSource("route").setData(geojson);
      }

      // Fit map to route bounds
      const bounds = new mapboxgl.LngLatBounds();
      data.trips[0].geometry.coordinates.forEach((c) => bounds.extend(c));
      map.current.fitBounds(bounds, { padding: 50 });
    } catch (err) {
      console.error(err);
      alert("Failed to draw optimized route: " + err.message);
    }
  };


  return (
    <div>
      <div className="controls" style={{ margin: "10px" }}>
        <button onClick={detectLocation} style={{ marginRight: "10px" }}>
          📍 Detect My Location
        </button>
        <input
          type="text"
          placeholder="Enter destination"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          style={{ marginRight: "5px" }}
        />
        <button onClick={addDestination} style={{ marginRight: "10px" }}>
          ➕ Add Destination
        </button>
        <button onClick={drawOptimizedRoute}>🛣️ Show Optimized Route</button>
      </div>

      <div
        ref={mapContainer}
        style={{ height: "600px", width: "100%", border: "1px solid #ccc" }}
      />
    </div>
  );
}
