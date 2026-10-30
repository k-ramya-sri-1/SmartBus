#!/usr/bin/env python3
"""
SmartBus face verification engine.

Detection : OpenCV YuNet  (face_detection_yunet_2023mar.onnx)
Recognition: OpenCV SFace (face_recognition_sface_2021dec.onnx), 128-D embedding

Design rules that the rest of the system depends on:

* An access decision never comes from this service alone. It returns the
  identity the face actually matched; the backend then compares that identity
  with the identity claimed by the RFID card. A face that matches a different
  student is reported as DIFFERENT_STUDENT, never as a match.

* Only 128-D embeddings are persisted. No raw face image is written to disk,
  returned over the API, or written to the log.

* Nothing is invented. If no face is found, if the image cannot be decoded,
  if the student is not enrolled, or if the engine raises, the result is an
  explicit non-match. A failure can never become an approval.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from datetime import datetime, timezone
from typing import Any

import cv2
import numpy as np

ENGINE_NAME = "sface-v1"

# OpenCV exposes the distance type as a module constant in 4.x, and as
# FaceRecognizerSF_FR_COSINE in 5.x. 0 is the cosine value in both.
_COSINE = getattr(cv2, "FaceRecognizerSF_FR_COSINE", 0)

DECISION_MATCH = "MATCH"
DECISION_NO_FACE = "NO_FACE"
DECISION_MULTIPLE_FACES = "MULTIPLE_FACES"
DECISION_LOW_SCORE = "LOW_SCORE"
DECISION_DIFFERENT_STUDENT = "DIFFERENT_STUDENT"
DECISION_NOT_ENROLLED = "NOT_ENROLLED"
DECISION_IMAGE_INVALID = "IMAGE_INVALID"
DECISION_ENGINE_ERROR = "ENGINE_ERROR"


class FaceEngineError(RuntimeError):
    """Raised when the engine cannot run at all (missing model, etc.)."""


class FaceEngine:
    def __init__(
        self,
        model_dir: str,
        template_dir: str,
        threshold: float = 0.363,
        ambiguity_ratio: float = 2.0,
        min_face_px: int = 40,
        identity_margin: float = 0.05,
    ) -> None:
        self.detector_model = os.path.join(model_dir, "face_detection_yunet_2023mar.onnx")
        self.recognizer_model = os.path.join(model_dir, "face_recognition_sface_2021dec.onnx")
        self.template_dir = template_dir
        self.threshold = float(threshold)
        self.ambiguity_ratio = float(ambiguity_ratio)
        self.min_face_px = int(min_face_px)
        # A different student's face must beat the expected student's by this
        # margin before we call it an identity mismatch. Without the margin,
        # two enrollments of the same person would make every genuine access
        # attempt look like an impersonation.
        self.identity_margin = float(identity_margin)

        for model in (self.detector_model, self.recognizer_model):
            if not os.path.isfile(model):
                raise FaceEngineError(
                    f"Model file missing: {model}. Run: python face-service/download_models.py"
                )

        os.makedirs(self.template_dir, exist_ok=True)

        # OpenCV DNN objects keep mutable input-size state, so each thread gets
        # its own pair. They are created lazily: a 38 MB model load on every
        # request would add hundreds of milliseconds to each boarding attempt.
        self._local = threading.local()
        self._write_lock = threading.Lock()
        self._cache: dict[int, tuple[float, int, dict[str, Any]]] = {}
        self._cache_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Engine internals
    # ------------------------------------------------------------------

    def _detector(self):
        det = getattr(self._local, "detector", None)
        if det is None:
            det = cv2.FaceDetectorYN.create(
                self.detector_model, "", (320, 320), 0.6, 0.3, 5000
            )
            self._local.detector = det
        return det

    def _recognizer(self):
        rec = getattr(self._local, "recognizer", None)
        if rec is None:
            rec = cv2.FaceRecognizerSF.create(self.recognizer_model, "")
            self._local.recognizer = rec
        return rec

    @staticmethod
    def decode(image_bytes: bytes) -> np.ndarray:
        buffer = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Image could not be decoded")
        return image

    def _detect(self, image: np.ndarray):
        """Return (face, face_count, reason).

        reason is None on success, otherwise "ambiguous" or "too_small".
        """
        height, width = image.shape[:2]
        detector = self._detector()
        detector.setInputSize((width, height))
        _, faces = detector.detect(image)

        if faces is None or len(faces) == 0:
            return None, 0, "no_face"

        # Largest face first: the person standing at the reader is normally
        # the closest one. A face that is obviously small (a bystander in the
        # background) is ignored, but two comparable faces are treated as
        # ambiguous instead of guessing.
        ordered = sorted(faces, key=lambda face: float(face[2]) * float(face[3]), reverse=True)
        largest = ordered[0]

        if float(largest[2]) < self.min_face_px or float(largest[3]) < self.min_face_px:
            return None, len(ordered), "too_small"

        if len(ordered) > 1:
            largest_area = float(ordered[0][2]) * float(ordered[0][3])
            second_area = float(ordered[1][2]) * float(ordered[1][3])
            if second_area * self.ambiguity_ratio > largest_area:
                return None, len(ordered), "ambiguous"

        return largest, len(ordered), None

    def _embed(self, image: np.ndarray, face) -> np.ndarray:
        recognizer = self._recognizer()
        aligned = recognizer.alignCrop(image, face)
        feature = recognizer.feature(aligned)
        return np.asarray(feature, dtype=np.float32).reshape(-1)

    def _similarity(self, left: np.ndarray, right: np.ndarray) -> float:
        return float(self._recognizer().match(
            left.reshape(1, -1), right.reshape(1, -1), _COSINE
        ))

    # ------------------------------------------------------------------
    # Template storage
    # ------------------------------------------------------------------

    def _template_path(self, student_id: int) -> str:
        return os.path.join(self.template_dir, f"{int(student_id)}.json")

    def _read_template(self, student_id: int) -> dict[str, Any] | None:
        path = self._template_path(student_id)

        try:
            stat = os.stat(path)
        except OSError:
            return None

        with self._cache_lock:
            cached = self._cache.get(int(student_id))
            if cached is not None and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
                return cached[2]

        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return None

        if data.get("engine") != ENGINE_NAME:
            return None

        vectors = []
        for template in data.get("templates") or []:
            array = np.asarray(template, dtype=np.float32).reshape(-1)
            if array.size == 128:
                vectors.append(array)

        if not vectors:
            return None

        data["vectors"] = vectors

        with self._cache_lock:
            self._cache[int(student_id)] = (stat.st_mtime, stat.st_size, data)

        return data

    def _write_template(self, student_id: int, vectors: list[np.ndarray]) -> dict[str, Any]:
        path = self._template_path(student_id)
        payload = {
            "student_id": int(student_id),
            "engine": ENGINE_NAME,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "templates": [vector.astype(float).round(6).tolist() for vector in vectors],
        }

        directory = os.path.dirname(path)
        with self._write_lock:
            handle = tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=directory, delete=False, suffix=".tmp"
            )
            try:
                json.dump(payload, handle)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                handle.close()

            try:
                os.chmod(handle.name, 0o600)
            except OSError:
                pass

            os.replace(handle.name, path)

        with self._cache_lock:
            self._cache.pop(int(student_id), None)

        return payload

    def enrolled_students(self) -> list[dict[str, Any]]:
        entries = []
        for name in sorted(os.listdir(self.template_dir)):
            if not name.endswith(".json"):
                continue
            try:
                student_id = int(name[:-5])
            except ValueError:
                continue
            record = self._read_template(student_id)
            if record is None:
                continue
            entries.append({
                "student_id": student_id,
                "template_count": len(record["vectors"]),
                "engine": record.get("engine", ENGINE_NAME),
                "created_at": record.get("created_at"),
            })
        return entries

    # ------------------------------------------------------------------
    # Public operations
    # ------------------------------------------------------------------

    def enroll(self, student_id: int, images: list[bytes], replace: bool = True) -> dict[str, Any]:
        if not images:
            return {"success": False, "error": "NO_IMAGES", "detail": "At least one image is required"}

        vectors: list[np.ndarray] = []
        rejected: list[dict[str, Any]] = []
        student_id = int(student_id)

        for index, image_bytes in enumerate(images):
            try:
                image = self.decode(image_bytes)
            except ValueError:
                rejected.append({"index": index, "reason": DECISION_IMAGE_INVALID})
                continue

            face, face_count, reason = self._detect(image)

            if face is None:
                if reason == "ambiguous" or face_count > 1:
                    rejected.append({"index": index, "reason": DECISION_MULTIPLE_FACES})
                else:
                    rejected.append({"index": index, "reason": DECISION_NO_FACE})
                continue

            vectors.append(self._embed(image, face))

        if not vectors:
            return {
                "success": False,
                "error": "NO_USABLE_IMAGE",
                "detail": "No image contained exactly one clear, unambiguous face",
                "rejected": rejected,
            }

        # One face must not be enrolled under two student records: that would
        # let a student register somebody else's face as their own, and it
        # would make every later verification ambiguous.
        conflict = self._find_duplicate_enrollment(vectors, student_id)
        if conflict is not None:
            return {
                "success": False,
                "error": "DUPLICATE_FACE",
                "detail": "This face is already enrolled for another student",
                "conflicting_student_id": conflict[0],
                "conflict_score": round(conflict[1], 5),
                "rejected": rejected,
            }

        if not replace:
            existing = self._read_template(student_id)
            if existing is not None:
                vectors = existing["vectors"] + vectors

        # Keep the most recent 8 templates; more does not improve accuracy.
        vectors = vectors[-8:]
        payload = self._write_template(student_id, vectors)

        return {
            "success": True,
            "student_id": int(student_id),
            "template_count": len(payload["templates"]),
            "engine": ENGINE_NAME,
            "created_at": payload["created_at"],
            "rejected": rejected,
        }

    def _find_duplicate_enrollment(
        self, vectors: list[np.ndarray], student_id: int
    ) -> tuple[int, float] | None:
        for entry in self.enrolled_students():
            other_id = entry["student_id"]
            if other_id == student_id:
                continue

            other_record = self._read_template(other_id)
            if other_record is None:
                continue

            best = max(
                self._similarity(probe, stored)
                for probe in vectors
                for stored in other_record["vectors"]
            )

            if best >= self.threshold:
                return other_id, best

        return None

    def delete(self, student_id: int) -> bool:
        path = self._template_path(student_id)
        with self._cache_lock:
            self._cache.pop(int(student_id), None)
        if os.path.isfile(path):
            os.remove(path)
            return True
        return False

    def verify(self, image_bytes: bytes, expected_student_id: int) -> dict[str, Any]:
        started = time.perf_counter()

        expected_record = self._read_template(expected_student_id)
        if expected_record is None:
            return self._result(
                DECISION_NOT_ENROLLED, expected_student_id,
                detail="Student has no enrolled face template",
                started=started,
            )

        try:
            image = self.decode(image_bytes)
        except ValueError:
            return self._result(
                DECISION_IMAGE_INVALID, expected_student_id,
                detail="Image could not be decoded", started=started,
            )

        detected = self._detect(image)
        face, face_count, reason = detected

        if face is None:
            decision = (
                DECISION_MULTIPLE_FACES if reason == "ambiguous"
                else DECISION_NO_FACE if reason == "no_face"
                else DECISION_NO_FACE
            )
            detail = (
                "More than one comparable face is visible" if reason == "ambiguous"
                else "Face is too small to verify" if reason == "too_small"
                else "No usable face detected"
            )
            return self._result(decision, expected_student_id, detail=detail,
                                face_count=face_count, started=started)

        probe = self._embed(image, face)

        expected_score = max(self._similarity(probe, vector) for vector in expected_record["vectors"])

        best_other_id: int | None = None
        best_other_score = -1.0

        for entry in self.enrolled_students():
            other_id = entry["student_id"]
            if other_id == int(expected_student_id):
                continue
            other_record = self._read_template(other_id)
            if other_record is None:
                continue
            score = max(self._similarity(probe, vector) for vector in other_record["vectors"])
            if score > best_other_score:
                best_other_score, best_other_id = score, other_id

        if expected_score < self.threshold:
            return self._result(
                DECISION_LOW_SCORE, expected_student_id,
                score=expected_score, best_other_score=best_other_score,
                matched_student_id=None, face_count=face_count,
                detail="Similarity below the acceptance threshold", started=started,
            )

        if (
            best_other_score >= self.threshold
            and best_other_score >= expected_score + self.identity_margin
        ):
            return self._result(
                DECISION_DIFFERENT_STUDENT, expected_student_id,
                score=expected_score, best_other_score=best_other_score,
                matched_student_id=best_other_id, face_count=face_count,
                detail="Face matches a different enrolled student", started=started,
            )

        return self._result(
            DECISION_MATCH, expected_student_id,
            score=expected_score, best_other_score=best_other_score,
            matched_student_id=int(expected_student_id), face_count=face_count,
            detail="Face matches the enrolled student", started=started,
        )

    def identify(self, image_bytes: bytes) -> dict[str, Any]:
        """Identify one enrolled face without making an access decision."""
        started = time.perf_counter()

        try:
            image = self.decode(image_bytes)
        except ValueError:
            return self._result(
                DECISION_IMAGE_INVALID, 0,
                detail="Image could not be decoded", started=started,
            )

        face, face_count, reason = self._detect(image)

        if face is None:
            decision = (
                DECISION_MULTIPLE_FACES if reason == "ambiguous" or face_count > 1
                else DECISION_NO_FACE
            )
            detail = (
                "More than one comparable face is visible"
                if decision == DECISION_MULTIPLE_FACES
                else "No usable face detected"
            )
            return self._result(
                decision, 0, face_count=face_count, detail=detail, started=started,
            )

        probe = self._embed(image, face)
        best_student_id: int | None = None
        best_score = -1.0
        second_score = -1.0

        for entry in self.enrolled_students():
            record = self._read_template(entry["student_id"])
            if record is None:
                continue

            score = max(
                self._similarity(probe, vector)
                for vector in record["vectors"]
            )

            if score > best_score:
                second_score = best_score
                best_score = score
                best_student_id = entry["student_id"]
            elif score > second_score:
                second_score = score

        if best_student_id is None or best_score < self.threshold:
            return self._result(
                DECISION_LOW_SCORE, 0,
                score=None if best_student_id is None else best_score,
                best_other_score=None if second_score < 0 else second_score,
                face_count=face_count,
                detail="No enrolled identity met the acceptance threshold",
                started=started,
            )

        if second_score >= self.threshold and second_score >= best_score - self.identity_margin:
            return self._result(
                DECISION_DIFFERENT_STUDENT, 0,
                score=best_score,
                best_other_score=second_score,
                face_count=face_count,
                detail="The best enrolled identities are too close to disambiguate",
                started=started,
            )

        return self._result(
            DECISION_MATCH, 0,
            score=best_score,
            best_other_score=None if second_score < 0 else second_score,
            matched_student_id=best_student_id,
            face_count=face_count,
            detail="Face matches one enrolled student",
            started=started,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _result(
        self,
        decision: str,
        expected_student_id: int,
        *,
        score: float | None = None,
        best_other_score: float | None = None,
        matched_student_id: int | None = None,
        face_count: int = 0,
        detail: str = "",
        started: float | None = None,
    ) -> dict[str, Any]:
        elapsed_ms = int((time.perf_counter() - started) * 1000) if started else 0
        return {
            "decision": decision,
            "match": decision == DECISION_MATCH,
            "expected_student_id": int(expected_student_id),
            "matched_student_id": matched_student_id,
            "score": None if score is None else round(float(score), 5),
            "best_other_score": None if best_other_score is None else round(float(best_other_score), 5),
            "threshold": self.threshold,
            "identity_margin": self.identity_margin,
            "face_count": face_count,
            "engine": ENGINE_NAME,
            "detail": detail,
            "elapsed_ms": elapsed_ms,
        }
