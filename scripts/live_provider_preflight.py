#!/usr/bin/env python3
"""Check local provider-test prerequisites without printing credential values."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.request import urlopen

from cryptography.fernet import Fernet, InvalidToken


def dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line.removeprefix("export ")
        key, separator, value = line.partition("=")
        if separator:
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def configured(name: str, values: dict[str, str]) -> str:
    return os.environ.get(name, values.get(name, "")).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=".env", help="dotenv file to inspect")
    parser.add_argument("--health-url", help="optional running backend health URL")
    args = parser.parse_args()

    values = dotenv(Path(args.env_file))
    required = (
        "COOPER_SHARED_KEY",
        "COOPER_GOOGLE_CLIENT_ID",
        "COOPER_GOOGLE_CLIENT_SECRET",
        "COOPER_ENCRYPTION_KEY",
    )
    missing = [name for name in required if not configured(name, values)]
    for name in required:
        print(f"{name}: {'ready' if name not in missing else 'missing'}")

    shared_key = configured("COOPER_SHARED_KEY", values)
    if shared_key and len(shared_key) < 24:
        print("COOPER_SHARED_KEY: must be at least 24 characters")
        missing.append("COOPER_SHARED_KEY")

    encryption_key = configured("COOPER_ENCRYPTION_KEY", values)
    if encryption_key:
        try:
            Fernet(encryption_key.encode())
        except (ValueError, TypeError, InvalidToken):
            print("COOPER_ENCRYPTION_KEY: not a valid Fernet key")
            missing.append("COOPER_ENCRYPTION_KEY")

    redirect = configured("COOPER_GOOGLE_REDIRECT_URI", values)
    expected_redirect = "http://127.0.0.1:8000/api/google/callback"
    if redirect and redirect != expected_redirect:
        print(f"COOPER_GOOGLE_REDIRECT_URI: expected {expected_redirect} for local testing")
        missing.append("COOPER_GOOGLE_REDIRECT_URI")
    elif not redirect:
        print(f"COOPER_GOOGLE_REDIRECT_URI: using default {expected_redirect}")

    if args.health_url:
        try:
            with urlopen(args.health_url, timeout=3) as response:
                healthy = response.status == 200
        except OSError:
            healthy = False
        print(f"Backend health: {'ready' if healthy else 'unavailable'}")
        if not healthy:
            missing.append("backend")

    if missing:
        print("Preflight failed. No credential values were printed.")
        return 1
    print("Preflight passed. You can begin the live-provider acceptance checklist.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
