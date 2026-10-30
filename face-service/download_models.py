#!/usr/bin/env python3
"""
Download the two OpenCV models used by the SmartBus face service.

    python face-service/download_models.py

Files land in face-service/models/ and are intentionally git-ignored: they are
38 MB of third-party weights that can be fetched again at any time.
"""

from __future__ import annotations

import hashlib
import os
import sys
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")

MODELS = [
    (
        "face_detection_yunet_2023mar.onnx",
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        None,
    ),
    (
        "face_recognition_sface_2021dec.onnx",
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        None,
    ),
]


def human(size: int) -> str:
    return f"{size / (1024 * 1024):.1f} MB"


def download(name: str, url: str) -> None:
    target = os.path.join(MODEL_DIR, name)

    if os.path.isfile(target) and os.path.getsize(target) > 0:
        print(f"  {name}: already present ({human(os.path.getsize(target))})")
        return

    print(f"  {name}: downloading...")
    with urllib.request.urlopen(url, timeout=180) as response, open(target, "wb") as handle:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            handle.write(chunk)

    size = os.path.getsize(target)
    if size == 0:
        os.remove(target)
        raise RuntimeError(f"{name} downloaded but is empty")

    print(f"  {name}: {human(size)}  sha256={hashlib.sha256(open(target, 'rb').read()).hexdigest()[:16]}...")


def main() -> int:
    os.makedirs(MODEL_DIR, exist_ok=True)
    print(f"Model directory: {MODEL_DIR}")

    failures = 0
    for name, url, _ in MODELS:
        try:
            download(name, url)
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"  {name}: FAILED - {error}")

    if failures:
        print("\nSome models could not be downloaded. The face service will refuse to start.")
        return 1

    print("\nModels ready. Start the service with: python face-service/app.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
