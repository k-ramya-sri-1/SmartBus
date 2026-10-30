import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import socket from "../services/socket";
import { api, type GpsLocation } from "../services/api";

const busIcon = new L.Icon({
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

/**
 * Live bus map.
 *
 * Only positions the backend marks as a current GPS fix are placed on the map.
 * A stale or missing fix is deliberately omitted: drawing the last known point
 * as if it were current would mislead the transport desk.
 */
function BusMap() {
  const [locations, setLocations] = useState<GpsLocation[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const buses = await api.buses.list();
        const results = await Promise.all(
          buses.map(async (bus) => {
            try {
              const { location } = await api.gps.latest(bus.id);
              return location.is_current ? location : null;
            } catch {
              // 404 simply means this bus has never reported a position.
              return null;
            }
          }),
        );

        if (!cancelled) {
          setLocations(
            results.filter((location): location is GpsLocation => location !== null),
          );
        }
      } catch (error) {
        console.error("Could not load initial GPS positions:", error);
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleGpsUpdate = (update: GpsLocation) => {
      if (update.fix_status !== "GPS_FIX") {
        return;
      }

      setLocations((current) => {
        const index = current.findIndex((item) => item.bus_id === update.bus_id);

        if (index === -1) {
          return [...current, update];
        }

        const next = [...current];
        next[index] = { ...next[index], ...update };
        return next;
      });
    };

    socket.on("gps_update", handleGpsUpdate);

    return () => {
      socket.off("gps_update", handleGpsUpdate);
    };
  }, []);

  return (
    <MapContainer
      center={[17.408, 78.479]}
      zoom={13}
      style={{ height: "500px", width: "100%" }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {locations.map((bus) => (
        <Marker
          key={bus.bus_id}
          position={[Number(bus.latitude), Number(bus.longitude)]}
          icon={busIcon}
        >
          <Popup>
            <strong>{bus.bus_number}</strong>
            <br />
            Registration: {bus.registration_number ?? "—"}
            <br />
            Speed: {bus.speed ?? 0} km/h
            <br />
            Latitude: {Number(bus.latitude).toFixed(5)}
            <br />
            Longitude: {Number(bus.longitude).toFixed(5)}
            <br />
            Recorded: {new Date(bus.recorded_at).toLocaleTimeString()}
            {bus.route_deviation_m !== null && (
              <>
                <br />
                Route deviation: {bus.route_deviation_m} m
              </>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

export default BusMap;
