"""Development server: uv run python main.py  (production: uv run gunicorn 'replicai:create_app()')."""

import os

from replicai import create_app

app = create_app()

if __name__ == "__main__":
    # Port 5000 is taken by AirPlay on macOS.
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5001")), debug=True)
