# backend/app.py
"""Fraudia Claims – Flask API entry point.

Registers all blueprints and starts the development server.
"""

import sys
from pathlib import Path

# Make sure the backend package root is importable
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# pyrefly: ignore [missing-import]
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables from the project root .env
load_dotenv(BACKEND_ROOT.parent / ".env")

from src.api.health import health_bp
from src.api.claims import claims_bp
from src.api.agent import agent_bp
from src.api.network import network_bp
from src.api.entities import entities_bp
from src.api.reports import reports_bp
from src.api.notion import notion_bp
from src.api.search import search_bp

def create_app() -> Flask:
    """Application factory."""
    # Configure Flask to serve the React build folder
    static_folder = str((BACKEND_ROOT.parent / "frontend" / "dist").resolve())
    app = Flask(__name__, static_folder=static_folder, static_url_path="/")

    # Allow the React dev server (default port 5173) and any localhost origin
    CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
    #CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Register blueprints
    app.register_blueprint(health_bp)
    app.register_blueprint(claims_bp)
    app.register_blueprint(agent_bp)
    app.register_blueprint(network_bp)
    app.register_blueprint(entities_bp)
    app.register_blueprint(reports_bp)
    app.register_blueprint(notion_bp)
    app.register_blueprint(search_bp)

    # Catch-all route to serve React app for non-API routes
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react(path):
        if path.startswith("api/"):
            return {"error": "Not found"}, 404
        import os
        if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
            return app.send_static_file(path)
        else:
            return app.send_static_file("index.html")

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
