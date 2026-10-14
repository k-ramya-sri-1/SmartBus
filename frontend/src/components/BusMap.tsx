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

interface BusLocation {
  id: number;
  bus_id: number;
  bus_number: string;
  registration_number: string;
  latitude: string | number;
  longitude: string | number;
  speed: string | number | null;
  recorded_at: string;
}

const busIds = [1, 5, 7];

function BusMap() {
  const [busLocations, setBusLocations] = useState<BusLocation[]>([]);

  // --------------------------------------------------
  // Load latest GPS locations from backend
  // --------------------------------------------------
  useEffect(() => {
    const fetchBusLocations = async () => {
      try {
        const results = await Promise.all(
          busIds.map(async (busId) => {
            const response = await fetch(
              `http://localhost:5000/api/gps/latest/${busId}`,
            );

            const data = await response.json();

            if (data.success && data.location) {
              return data.location as BusLocation;
            }

            return null;
          }),
        );

        const validLocations = results.filter(
          (location): location is BusLocation =>
            location !== null,
        );

        setBusLocations(validLocations);

        console.log(
          "Initial GPS locations loaded:",
          validLocations,
        );
      } catch (error) {
        console.error(
          "Failed to fetch bus GPS locations:",
          error,
        );
      }
    };

    fetchBusLocations();
  }, []);

  // --------------------------------------------------
  // Socket.IO connection + real-time GPS updates
  // --------------------------------------------------
  useEffect(() => {
    console.log(
      "BusMap: registering Socket.IO GPS listener",
    );

    const handleConnect = () => {
      console.log(
        "BusMap Socket.IO connected:",
        socket.id,
      );
    };

    const handleConnectError = (error: Error) => {
      console.error(
        "BusMap Socket.IO connection error:",
        error.message,
      );
    };

    const handleGPSUpdate = (location: BusLocation) => {
      console.log(
        "🔥 REAL-TIME GPS UPDATE RECEIVED:",
        location,
      );

      setBusLocations((currentLocations) => {
        const existingIndex = currentLocations.findIndex(
          (bus) => bus.bus_id === location.bus_id,
        );

        // If this bus is not currently on the map,
        // add it.
        if (existingIndex === -1) {
          console.log(
            "Adding new bus location:",
            location.bus_number,
          );

          return [...currentLocations, location];
        }

        // Update the existing bus.
        const updatedLocations = [...currentLocations];

        updatedLocations[existingIndex] = {
          ...updatedLocations[existingIndex],
          ...location,
        };

        console.log(
          "Updated bus position:",
          location.bus_number,
          location.latitude,
          location.longitude,
        );

        return updatedLocations;
      });
    };

    // Connection events
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);

    // GPS real-time event
    socket.on("gps_update", handleGPSUpdate);

    console.log(
      "BusMap: gps_update listener registered",
    );

    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off(
        "connect_error",
        handleConnectError,
      );
      socket.off(
        "gps_update",
        handleGPSUpdate,
      );

      socket.disconnect();

      console.log(
        "BusMap: Socket.IO listeners removed",
      );
    };
  }, []);

  return (
    <MapContainer
      center={[17.408, 78.479]}
      zoom={13}
      style={{
        height: "500px",
        width: "100%",
      }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {busLocations.map((bus) => (
        <Marker
          key={bus.bus_id}
          position={[
            Number(bus.latitude),
            Number(bus.longitude),
          ]}
          icon={busIcon}
        >
          <Popup>
            <strong>{bus.bus_number}</strong>

            <br />

            Registration: {bus.registration_number}

            <br />

            Speed: {bus.speed ?? 0} km/h

            <br />

            Latitude: {bus.latitude}

            <br />

            Longitude: {bus.longitude}

            <br />

            Recorded: {bus.recorded_at}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

export default BusMap;