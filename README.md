# SmartBus Rescue and Access Management System

An IoT-based college bus access management and emergency rescue system.

## Project Overview

SmartBus is designed to manage student bus access, verify student identity, record boarding activity, track bus locations, and support emergency rescue coordination.

## Main Features

- Student and RFID card management
- Authentication and role-based access
- Bus, route, and student assignment management
- Boarding authorization and boarding records
- GPS location tracking
- Emergency event management
- Rescue allocation and temporary authorization
- Web-based dashboard

## Technology Stack

- **Backend:** Node.js, Express.js
- **Database:** MySQL
- **Frontend:** React, TypeScript, Vite
- **Authentication:** JSON Web Tokens (JWT) and bcrypt
- **Mapping:** Leaflet and OpenStreetMap
- **Hardware planned:** ESP32-S3, RFID reader, camera, GPS module, and OLED display

## Project Structure

- `backend/` — API, controllers, routes, services, and authentication
- `database/` — database schema
- `frontend/` — web dashboard
- `esp32/` — planned embedded firmware
- `face-service/` — planned face-verification service
- `docs/` — project documentation

## Development Status

Backend APIs, database setup, and frontend dashboard development are in progress. Hardware integration and end-to-end testing remain part of the development plan.

## Security

Keep environment variables and credentials in local `.env` files. Never commit passwords, JWT secrets, access tokens, or other private credentials.