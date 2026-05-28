import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.storage.relational_db import DEFAULT_DB_PATH, ensure_relational_db  # noqa: E402

def main() -> None:
    db_path = ensure_relational_db(DEFAULT_DB_PATH)
    print(f"Base SQLite creada/actualizada en {db_path}")
if __name__ == "__main__":
    main()