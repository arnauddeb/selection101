from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


DOSSIER_APP = Path(__file__).resolve().parent
DOSSIER_LABELS_APP = DOSSIER_APP / "labels"
DOSSIER_LABELS_PARENT = DOSSIER_APP.parent / "labels"
FICHIER_BIBLIOTHEQUE = DOSSIER_APP / "bibliotheque.json"
HOTE = "127.0.0.1"
PORT = 8111


def charger_bibliotheque() -> dict:
    if not FICHIER_BIBLIOTHEQUE.exists():
        return {"application": "Selection 101", "version": "1.1.0", "vinyles": []}

    with FICHIER_BIBLIOTHEQUE.open("r", encoding="utf-8") as fichier:
        return json.load(fichier)


def ecrire_bibliotheque(donnees: dict) -> None:
    temporaire = FICHIER_BIBLIOTHEQUE.with_suffix(".json.tmp")
    with temporaire.open("w", encoding="utf-8") as fichier:
        json.dump(donnees, fichier, ensure_ascii=False, indent=2)
    temporaire.replace(FICHIER_BIBLIOTHEQUE)


def client_en_lecture_seule(user_agent: str) -> bool:
    agent = (user_agent or "").lower()
    marqueurs_mobiles = ["iphone", "ipad", "ipod", "android", "mobile"]
    return any(marqueur in agent for marqueur in marqueurs_mobiles)


class GestionnaireSelection101(BaseHTTPRequestHandler):
    server_version = "Selection101Local/1.1.0"

    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        chemin = urlparse(self.path).path

        if chemin == "/api/mode":
            self.repondre_json(
                {
                    "lecture_seule": client_en_lecture_seule(self.headers.get("User-Agent", "")),
                }
            )
            return

        if chemin == "/api/bibliotheque":
            self.repondre_json(charger_bibliotheque())
            return

        self.servir_fichier(chemin)

    def do_POST(self) -> None:
        chemin = urlparse(self.path).path

        if chemin != "/api/bibliotheque":
            self.repondre_json({"erreur": "Route inconnue"}, HTTPStatus.NOT_FOUND)
            return

        if client_en_lecture_seule(self.headers.get("User-Agent", "")):
            self.repondre_json({"erreur": "Lecture seule sur cet appareil"}, HTTPStatus.FORBIDDEN)
            return

        try:
            longueur = int(self.headers.get("Content-Length", "0"))
            brut = self.rfile.read(longueur)
            donnees = json.loads(brut.decode("utf-8"))
            vinyles = donnees.get("vinyles")
            if not isinstance(vinyles, list):
                raise ValueError("Format JSON invalide")

            contenu = {
                "application": "Selection 101",
                "version": "1.1.0",
                "vinyles": vinyles,
            }
            ecrire_bibliotheque(contenu)
            self.repondre_json(contenu)
        except Exception as erreur:
            self.repondre_json({"erreur": str(erreur)}, HTTPStatus.BAD_REQUEST)

    def servir_fichier(self, chemin: str) -> None:
        if chemin in {"", "/"}:
            chemin = "/index.html"

        cible = self.resoudre_cible_statique(chemin)
        if cible is None:
            self.repondre_json({"erreur": "Accès refusé"}, HTTPStatus.FORBIDDEN)
            return

        if not cible.exists() or not cible.is_file():
            self.repondre_json({"erreur": "Fichier introuvable"}, HTTPStatus.NOT_FOUND)
            return

        type_mime, _ = mimetypes.guess_type(str(cible))
        with cible.open("rb") as fichier:
            contenu = fichier.read()

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", type_mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(contenu)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(contenu)

    def resoudre_cible_statique(self, chemin: str) -> Path | None:
        chemin_relatif = unquote(chemin.lstrip("/"))

        if chemin_relatif.startswith("labels/"):
            nom_label = chemin_relatif.removeprefix("labels/")
            for dossier_labels in (DOSSIER_LABELS_APP, DOSSIER_LABELS_PARENT):
                cible_label = (dossier_labels / nom_label).resolve()
                if str(cible_label).startswith(str(dossier_labels.resolve())):
                    return cible_label
            return None

        cible = (DOSSIER_APP / chemin_relatif).resolve()
        if not str(cible).startswith(str(DOSSIER_APP)):
            return None
        return cible

    def repondre_json(self, donnees: dict, statut: HTTPStatus = HTTPStatus.OK) -> None:
        contenu = json.dumps(donnees, ensure_ascii=False).encode("utf-8")
        self.send_response(statut)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(contenu)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(contenu)


if __name__ == "__main__":
    os.chdir(DOSSIER_APP)
    serveur = ThreadingHTTPServer((HOTE, PORT), GestionnaireSelection101)
    print(f"Selection 101 local disponible sur http://127.0.0.1:{PORT}")
    serveur.serve_forever()
