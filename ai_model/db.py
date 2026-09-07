"""
db.py — SQLite persistence for CocoLeafGuard.

Two tables:
  trees   one row per assessed tree (location, thumbnail, timestamps)
  images  one row per captured leaf image, linked to a tree, storing the
          full prediction result (status, symptoms, detections, image
          URLs, etc.) as a JSON blob.

The database file lives next to this script, inside ai_model/, so it
survives PHP/FastAPI restarts and browser refreshes alike.
"""

import json
import os
import sqlite3
import threading
from contextlib import contextmanager

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, "cocoleafguard.db")

# SQLite connections aren't thread-safe by default; FastAPI can handle
# requests concurrently, so guard writes with a simple lock.
_lock = threading.Lock()


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_conn():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trees (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                tree_number    INTEGER NOT NULL,
                location_label TEXT NOT NULL DEFAULT '',
                lat            REAL,
                lng            REAL,
                photo          TEXT,
                inspected_at   TEXT NOT NULL,
                created_at     TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS images (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                tree_id     INTEGER NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
                url         TEXT NOT NULL,
                timestamp   TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_images_tree_id ON images(tree_id)")


# ── Serialization helpers ──────────────────────────────────────

def _image_row_to_dict(row):
    return {
        "id": row["id"],
        "url": row["url"],
        "timestamp": row["timestamp"],
        "result": json.loads(row["result_json"]),
    }


def _tree_row_to_dict(row, images):
    return {
        "id": row["id"],
        "treeNumber": row["tree_number"],
        "locationLabel": row["location_label"],
        "coordinates": (
            {"lat": row["lat"], "lng": row["lng"]}
            if row["lat"] is not None and row["lng"] is not None
            else None
        ),
        "photo": row["photo"],
        "inspectedAt": row["inspected_at"],
        "images": images,
    }


# ── Trees ───────────────────────────────────────────────────────

def list_trees():
    with get_conn() as conn:
        tree_rows = conn.execute("SELECT * FROM trees ORDER BY id ASC").fetchall()
        result = []
        for t in tree_rows:
            img_rows = conn.execute(
                "SELECT * FROM images WHERE tree_id = ? ORDER BY id ASC", (t["id"],)
            ).fetchall()
            result.append(_tree_row_to_dict(t, [_image_row_to_dict(i) for i in img_rows]))
        return result


def get_tree(tree_id):
    with get_conn() as conn:
        t = conn.execute("SELECT * FROM trees WHERE id = ?", (tree_id,)).fetchone()
        if not t:
            return None
        img_rows = conn.execute(
            "SELECT * FROM images WHERE tree_id = ? ORDER BY id ASC", (tree_id,)
        ).fetchall()
        return _tree_row_to_dict(t, [_image_row_to_dict(i) for i in img_rows])


def create_tree(location_label, lat, lng, photo, inspected_at, images=None):
    """images: optional list of {url, timestamp, result} to save atomically."""
    with _lock, get_conn() as conn:
        next_num = conn.execute(
            "SELECT COALESCE(MAX(tree_number), 0) + 1 AS n FROM trees"
        ).fetchone()["n"]
        cur = conn.execute(
            """INSERT INTO trees (tree_number, location_label, lat, lng, photo, inspected_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (next_num, location_label or "", lat, lng, photo, inspected_at),
        )
        tree_id = cur.lastrowid
        for im in (images or []):
            conn.execute(
                "INSERT INTO images (tree_id, url, timestamp, result_json) VALUES (?, ?, ?, ?)",
                (tree_id, im["url"], im["timestamp"], json.dumps(im["result"])),
            )
    return get_tree(tree_id)


def update_tree(tree_id, location_label=None, lat=None, lng=None, photo=None):
    with _lock, get_conn() as conn:
        existing = conn.execute("SELECT * FROM trees WHERE id = ?", (tree_id,)).fetchone()
        if not existing:
            return None
        conn.execute(
            """UPDATE trees SET
                 location_label = ?,
                 lat = ?,
                 lng = ?,
                 photo = ?
               WHERE id = ?""",
            (
                location_label if location_label is not None else existing["location_label"],
                lat if lat is not None else existing["lat"],
                lng if lng is not None else existing["lng"],
                photo if photo is not None else existing["photo"],
                tree_id,
            ),
        )
    return get_tree(tree_id)


def delete_tree(tree_id):
    with _lock, get_conn() as conn:
        cur = conn.execute("DELETE FROM trees WHERE id = ?", (tree_id,))
        return cur.rowcount > 0


# ── Images ──────────────────────────────────────────────────────

def add_image(tree_id, url, timestamp, result):
    with _lock, get_conn() as conn:
        exists = conn.execute("SELECT id FROM trees WHERE id = ?", (tree_id,)).fetchone()
        if not exists:
            return None
        cur = conn.execute(
            "INSERT INTO images (tree_id, url, timestamp, result_json) VALUES (?, ?, ?, ?)",
            (tree_id, url, timestamp, json.dumps(result)),
        )
        image_id = cur.lastrowid
        row = conn.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
        return _image_row_to_dict(row)


def delete_image(image_id):
    with _lock, get_conn() as conn:
        cur = conn.execute("DELETE FROM images WHERE id = ?", (image_id,))
        return cur.rowcount > 0