"""One authenticated loopback request over an existing SSH connection.

No credentials leave the Mini. The first output line describes the response;
subsequent bytes are its body, including streaming model output.
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALLOWED = {"/status", "/models", "/models/user", "/tools", "/tool", "/chat/completions", "/archive"}


def main():
    line = sys.stdin.buffer.readline(2_000_001)
    if len(line) > 2_000_000:
        raise ValueError("Request too large")
    message = json.loads(line)
    path = message.get("path")
    if path not in ALLOWED:
        raise ValueError("Unknown bridge route")
    data = json.dumps(message["body"]).encode() if "body" in message else None
    request = urllib.request.Request("http://127.0.0.1:8768" + path, data=data, headers={
        "Authorization": "Bearer " + (ROOT / ".harbor-api-key").read_text().strip(),
        "Content-Type": "application/json",
    })
    try:
        response = urllib.request.urlopen(request, timeout=240)
    except urllib.error.HTTPError as error:
        response = error
    print(json.dumps({"status": response.status, "contentType": response.headers.get("Content-Type", "application/json")}), flush=True)
    with response:
        while chunk := response.read1(65536):
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Jinx bridge is unavailable on the Mini", file=sys.stderr)
        sys.exit(1)
