#!/usr/bin/env python3
"""
SmartBus face verification service (internal HTTP API).

This service is never exposed to students or to the internet. It is called by
the SmartBus backend over loopback and is protected by a shared secret. It
performs real face detection and recognition, but it does NOT decide who may
board a bus: it only reports which enrolled student the captured face matched.
The backend compares that identity with the RFID identity and then applies the
bus/route rules.

Run:
    python face-service/app.py
    python face-service/app.py --port 8001 --host 127.0.0.1

Endpoints (all require X-Internal-Secret except /health):
    GET    /health
    POST   /verify          {"expected_student_id": 2, "image": "<base64>"}
    POST   /identify        {"image": "<base64>"}
    POST   /enroll          {"student_id": 2, "images": ["<base64>", ...]}
    DELETE /enroll/<id>
    GET    /students
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import signal
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# This Python distribution runs with safe_path enabled, so the script directory
# is not added to sys.path automatically. Make the sibling module importable
# regardless of how the service is launched (python app.py, -m, or a wrapper).
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from face_engine import FaceEngine, FaceEngineError  # noqa: E402

MAX_BODY_BYTES = 8 * 1024 * 1024        # 8 MB: three QVGA frames plus base64 overhead
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_ENROLL_IMAGES = 8

logger = logging.getLogger("smartbus.face")


def load_env(path: str) -> None:
    """Minimal .env loader: KEY=VALUE lines, no dependency on python-dotenv."""
    if not os.path.isfile(path):
        return

    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


class FaceServiceHandler(BaseHTTPRequestHandler):
    server_version = "SmartBusFace/1.0"
    protocol_version = "HTTP/1.1"

    # Injected by FaceService()
    engine: FaceEngine
    auth_digest: str
    max_body_bytes: int = MAX_BODY_BYTES

    # ------------------------------------------------------------------
    # Plumbing
    # ------------------------------------------------------------------

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 - stdlib signature
        logger.debug("%s - %s", self.address_string(), fmt % args)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _unauthorized(self) -> None:
        self._send_json(HTTPStatus.UNAUTHORIZED, {
            "success": False,
            "error": "UNAUTHORIZED",
            "message": "A valid X-Internal-Secret header is required.",
        })

    def _authorized(self) -> bool:
        """Compare digests, so the plaintext shared value is never held here."""
        provided = self.headers.get("X-Internal-Secret", "")
        if not provided:
            return False
        provided_digest = hashlib.sha256(provided.encode("utf-8")).hexdigest()
        return hmac.compare_digest(provided_digest, self.auth_digest)

    def _discard_request_body(self) -> None:
        """Drain a rejected body's bytes before sending a persistent response."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0

        remaining = min(max(length, 0), self.max_body_bytes)
        while remaining:
            chunk = self.rfile.read(min(64 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)

        if length > self.max_body_bytes:
            self.close_connection = True

    def _read_json(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0

        if length <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "success": False, "error": "EMPTY_BODY",
                "message": "A JSON request body is required.",
            })
            return None

        if length > self.max_body_bytes:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                "success": False, "error": "BODY_TOO_LARGE",
                "message": f"Request body exceeds {self.max_body_bytes} bytes.",
            })
            return None

        raw = self.rfile.read(length)

        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "success": False, "error": "INVALID_JSON",
                "message": "Request body is not valid JSON.",
            })
            return None

        if not isinstance(payload, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "success": False, "error": "INVALID_JSON",
                "message": "Request body must be a JSON object.",
            })
            return None

        return payload

    @staticmethod
    def _decode_image(value) -> bytes:
        if not isinstance(value, str) or not value:
            raise ValueError("image must be a base64 string")

        compact = value.strip()
        if compact.startswith("data:") and "," in compact:
            compact = compact.split(",", 1)[1]

        try:
            data = base64.b64decode(compact, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("image is not valid base64") from error

        if not data:
            raise ValueError("image is empty")

        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError(f"image exceeds {MAX_IMAGE_BYTES} bytes")

        return data

    @staticmethod
    def _as_student_id(value, field: str) -> int:
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise ValueError(f"{field} must be an integer")
        try:
            student_id = int(value)
        except (TypeError, ValueError) as error:
            raise ValueError(f"{field} must be an integer") from error
        if student_id <= 0:
            raise ValueError(f"{field} must be a positive integer")
        return student_id

    # ------------------------------------------------------------------
    # Routes
    # ------------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 - stdlib signature
        if self.path == "/health":
            self._send_json(HTTPStatus.OK, {
                "success": True,
                "status": "ok",
                "engine": "sface-v1",
                "enrolled_students": len(self.engine.enrolled_students()),
                "threshold": self.engine.threshold,
            })
            return

        if not self._authorized():
            self._unauthorized()
            return

        if self.path == "/students":
            self._send_json(HTTPStatus.OK, {
                "success": True,
                "students": self.engine.enrolled_students(),
            })
            return

        self._send_json(HTTPStatus.NOT_FOUND, {
            "success": False, "error": "NOT_FOUND", "message": "Unknown endpoint.",
        })

    def do_POST(self) -> None:  # noqa: N802 - stdlib signature
        if not self._authorized():
            self._discard_request_body()
            self._unauthorized()
            return

        if self.path == "/verify":
            self._handle_verify()
            return

        if self.path == "/identify":
            self._handle_identify()
            return

        if self.path == "/enroll":
            self._handle_enroll()
            return

        self._send_json(HTTPStatus.NOT_FOUND, {
            "success": False, "error": "NOT_FOUND", "message": "Unknown endpoint.",
        })

    def do_DELETE(self) -> None:  # noqa: N802 - stdlib signature
        if not self._authorized():
            self._unauthorized()
            return

        if self.path.startswith("/enroll/"):
            raw_id = self.path[len("/enroll/"):]
            try:
                student_id = self._as_student_id(raw_id, "student_id")
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {
                    "success": False, "error": "INVALID_STUDENT_ID", "message": str(error),
                })
                return

            removed = self.engine.delete(student_id)
            self._send_json(HTTPStatus.OK, {
                "success": True,
                "student_id": student_id,
                "removed": removed,
            })
            return

        self._send_json(HTTPStatus.NOT_FOUND, {
            "success": False, "error": "NOT_FOUND", "message": "Unknown endpoint.",
        })

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    def _handle_verify(self) -> None:
        payload = self._read_json()
        if payload is None:
            return

        started = time.perf_counter()

        try:
            expected_student_id = self._as_student_id(payload.get("expected_student_id"), "expected_student_id")
            image = self._decode_image(payload.get("image"))
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "success": False, "error": "INVALID_REQUEST", "message": str(error),
            })
            return

        try:
            result = self.engine.verify(image, expected_student_id)
        except FaceEngineError as error:
            logger.error("engine failure during verify: %s", error)
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {
                "success": False,
                "error": "ENGINE_UNAVAILABLE",
                "decision": "ENGINE_UNAVAILABLE",
                "message": "Face engine is unavailable.",
            })
            return
        except Exception as error:  # noqa: BLE001 - must never crash the service
            logger.exception("unexpected verify failure: %s", error)
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                "success": False,
                "error": "ENGINE_ERROR",
                "decision": "ENGINE_ERROR",
                "message": "Face engine failed to process the image.",
            })
            return

        result["success"] = True
        self._send_json(HTTPStatus.OK, result)

        logger.info(json.dumps({
            "event": "face_verify",
            "decision": result["decision"],
            "expected_student_id": expected_student_id,
            "matched_student_id": result.get("matched_student_id"),
            "score": result.get("score"),
            "face_count": result.get("face_count"),
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
        }))

    def _handle_identify(self) -> None:
        payload = self._read_json()
        if payload is None:
            return

        started = time.perf_counter()

        try:
            image = self._decode_image(payload.get("image"))
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "success": False, "error": "INVALID_REQUEST", "message": str(error),
            })
            return

        try:
            result = self.engine.identify(image)
        except FaceEngineError as error:
            logger.error("engine failure during identify: %s", error)
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {
                "success": False,
                "error": "ENGINE_UNAVAILABLE",
                "decision": "ENGINE_UNAVAILABLE",
                "message": "Face engine is unavailable.",
            })
            return
        except Exception as error:  # noqa: BLE001 - must never crash the service
            logger.exception("unexpected identify failure: %s", error)
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                "success": False,
                "error": "ENGINE_ERROR",
                "decision": "ENGINE_ERROR",
                "message": "Face engine failed to process the image.",
            })
            return

        result["success"] = True
        self._send_json(HTTPStatus.OK, result)

        logger.info(json.dumps({
            "event": "face_identify",
            "decision": result["decision"],
            "matched_student_id": result.get("matched_student_id"),
            "score": result.get("score"),
            "face_count": result.get("face_count"),
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
        }))

    def _handle_enroll(self) -> None:
        payload = self._read_json()
        if payload is None:
            return

        try:
            student_id = self._as_student_id(payload.get("student_id"), "student_id")

            raw_images = payload.get("images")
            if isinstance(raw_images, str):
                raw_images = [raw_images]
            if not isinstance(raw_images, list) or not raw_images:
                raise ValueError("images must be a non-empty array of base64 strings")
            if len(raw_images) > MAX_ENROLL_IMAGES:
                raise ValueError(f"at most {MAX_ENROLL_IMAGES} images are accepted")

            images = [self._decode_image(item) for item in raw_images]
            replace = payload.get("replace", True)
            if not isinstance(replace, bool):
                raise ValueError("replace must be a boolean")
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "success": False, "error": "INVALID_REQUEST", "message": str(error),
            })
            return

        try:
            result = self.engine.enroll(student_id, images, replace=replace)
        except Exception as error:  # noqa: BLE001
            logger.exception("enroll failed: %s", error)
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                "success": False, "error": "ENGINE_ERROR",
                "message": "Face engine failed to enroll the images.",
            })
            return

        if result.get("success"):
            status = HTTPStatus.CREATED
        elif result.get("error") == "DUPLICATE_FACE":
            status = HTTPStatus.CONFLICT
        else:
            status = HTTPStatus.UNPROCESSABLE_ENTITY

        self._send_json(status, result)

        logger.info(json.dumps({
            "event": "face_enroll",
            "student_id": student_id,
            "success": bool(result.get("success")),
            "template_count": result.get("template_count"),
        }))


class FaceService:
    """Threaded HTTP server with a shared engine instance."""

    def __init__(self, engine: FaceEngine, auth_digest: str, host: str, port: int) -> None:
        handler = type("BoundHandler", (FaceServiceHandler,), {"engine": engine})
        handler.auth_digest = auth_digest
        self.httpd = ThreadingHTTPServer((host, port), handler)
        self.httpd.daemon_threads = True

    def serve_forever(self) -> None:
        self.httpd.serve_forever()

    def shutdown(self) -> None:
        self.httpd.shutdown()


def main() -> int:
    parser = argparse.ArgumentParser(description="SmartBus face verification service")
    parser.add_argument("--host", default=os.environ.get("FACE_SERVICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("FACE_SERVICE_PORT", "8001")))
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )

    load_env(os.path.join(BASE_DIR, ".env"))
    load_env(os.path.join(BASE_DIR, "..", "backend", ".env"))

    configured = os.environ.get("FACE_SERVICE_SECRET", "")
    if len(configured) < 32:
        logger.error(
            "FACE_SERVICE_SECRET is missing or shorter than 32 characters. "
            "Refusing to start without authentication. "
            "Set it in face-service/.env (and in backend/.env with the same value)."
        )
        return 2

    auth_digest = hashlib.sha256(configured.encode("utf-8")).hexdigest()

    threshold = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.363"))

    # Relative paths in .env are resolved against the service directory, not
    # against whatever directory the process happens to be started from.
    model_dir = os.environ.get("FACE_MODEL_DIR", "models")
    template_dir = os.environ.get("FACE_TEMPLATE_DIR", os.path.join("data", "templates"))

    if not os.path.isabs(model_dir):
        model_dir = os.path.join(BASE_DIR, model_dir)

    if not os.path.isabs(template_dir):
        template_dir = os.path.join(BASE_DIR, template_dir)

    try:
        engine = FaceEngine(model_dir=model_dir, template_dir=template_dir, threshold=threshold)
    except FaceEngineError as error:
        logger.error("Cannot start face engine: %s", error)
        return 2

    server = FaceService(engine, auth_digest, args.host, args.port)

    def _stop(signum, frame):  # noqa: ARG001
        logger.info("shutting down (signal %s)", signum)
        server.shutdown()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    logger.info(
        "SmartBus face service listening on http://%s:%s (engine=sface-v1, threshold=%.3f, templates=%s)",
        args.host, args.port, threshold, template_dir
    )

    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
