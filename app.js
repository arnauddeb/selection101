// Jukebox — Selection 101
// Site statique (GitHub Pages). La collection vit dans data/vinyles.json du dépôt,
// les pochettes dans covers/. On lit et on écrit via l'API GitHub, on remplit via Discogs.
"use strict";

// ——— Réglages faciles à modifier ———
const JUKEBOX = {
  positions: 80,                 // positions 00 → 79
  selectionA: (pos) => "1" + pos, // numéro à composer pour la face A
  selectionB: (pos) => "2" + pos, // numéro à composer pour la face B
};
const FICHIER = "data/vinyles.json";
const DOSSIER_POCHETTES = "covers";
const TAILLE_POCHETTE = 600;      // px, carré
const DEPOT_PAR_DEFAUT = "arnauddeb/selection101";

// ——— Outils ———
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const pad = (n) => String(n).padStart(2, "0");
const toutesPositions = Array.from({ length: JUKEBOX.positions }, (_, i) => pad(i));
const lsGet = (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };

function depotDetecte() {
  const h = location.hostname;
  if (h.endsWith(".github.io")) {
    const owner = h.split(".")[0];
    const repo = location.pathname.split("/").filter(Boolean)[0] || h;
    return `${owner}/${repo}`;
  }
  return DEPOT_PAR_DEFAUT;
}
const cfg = {
  get depot() { return lsGet("jb.depot") || depotDetecte(); },
  get branche() { return lsGet("jb.branche") || "main"; },
  get github() { return lsGet("jb.github"); },
  get discogs() { return lsGet("jb.discogs"); },
};

function b64DecodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const textToB64 = (t) => bytesToB64(new TextEncoder().encode(t));
const blobToB64 = async (b) => bytesToB64(new Uint8Array(await b.arrayBuffer()));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("visible"), 2600);
}

// ——— GitHub ———
async function gh(chemin, options = {}) {
  const headers = { Accept: "application/vnd.github+json", ...(options.headers || {}) };
  if (cfg.github) headers.Authorization = `Bearer ${cfg.github}`;
  const r = await fetch(`https://api.github.com/repos/${cfg.depot}/${chemin}`, { ...options, headers, cache: "no-store" });
  if (!r.ok) {
    const e = new Error(`GitHub ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? null : r.json();
}
const urlContenu = (chemin) => `contents/${chemin.split("/").map(encodeURIComponent).join("/")}`;

async function lireCollection() {
  const r = await gh(`${urlContenu(FICHIER)}?ref=${encodeURIComponent(cfg.branche)}`);
  return { sha: r.sha, donnees: JSON.parse(b64DecodeUtf8(r.content)) };
}
async function ecrireFichier(chemin, contenuB64, message, sha) {
  const body = { message, content: contenuB64, branch: cfg.branche };
  if (sha) body.sha = sha;
  return gh(urlContenu(chemin), { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}
async function supprimerFichier(chemin) {
  try {
    const f = await gh(`${urlContenu(chemin)}?ref=${encodeURIComponent(cfg.branche)}`);
    await gh(urlContenu(chemin), { method: "DELETE", body: JSON.stringify({ message: `Pochette retirée`, sha: f.sha, branch: cfg.branche }), headers: { "Content-Type": "application/json" } });
  } catch {}
}

// Applique une modification sur la version la plus récente du fichier, puis l'écrit.
async function modifierCollection(message, modif) {
  for (let essai = 0; essai < 3; essai++) {
    const { sha, donnees } = await lireCollection();
    const vinyles = modif(structuredClone(donnees.vinyles || []));
    const suivant = { ...donnees, version: 2, vinyles: trier(vinyles) };
    try {
      await ecrireFichier(FICHIER, textToB64(JSON.stringify(suivant, null, 1) + "\n"), message, sha);
      etat.vinyles = suivant.vinyles;
      return;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
    }
  }
  throw new Error("Conflit d'enregistrement");
}

// ——— Discogs ———
async function discogs(chemin, params = {}) {
  const u = new URL(`https://api.discogs.com/${chemin}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (cfg.discogs) u.searchParams.set("token", cfg.discogs);
  const r = await fetch(u);
  if (!r.ok) {
    const e = new Error(`Discogs ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}
const nettoyerArtiste = (s) => String(s || "").replace(/\s*\(\d+\)$/, "").replace(/\*$/, "").trim();

function facesDepuisTracklist(tracklist = []) {
  const pistes = tracklist.filter((t) => (t.type_ || "track") === "track" && t.title);
  const cote = (lettre) => pistes.filter((t) => String(t.position || "").trim().toUpperCase().startsWith(lettre));
  let a = cote("A"), b = cote("B");
  if (!a.length && !b.length) { a = pistes.slice(0, 1); b = pistes.slice(1, 2); }
  const titre = (liste) => liste.map((t) => t.title.trim()).join(" / ");
  return { a: titre(a), b: titre(b) };
}

// ——— Images ———
function chargerImage(source) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error("Image illisible"));
    img.src = source;
  });
}
async function pochetteCarree(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await chargerImage(url);
    const cote = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = c.height = Math.min(TAILLE_POCHETTE, cote);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - cote) / 2, (img.naturalHeight - cote) / 2, cote, cote, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}
const urlBrute = (chemin) => `https://raw.githubusercontent.com/${cfg.depot}/${cfg.branche}/${chemin}`;
const apercusLocaux = new Map(); // pochettes enregistrées pendant cette visite
function srcPochette(v) {
  if (!v.pochette) return "";
  if (apercusLocaux.has(v.pochette)) return apercusLocaux.get(v.pochette);
  return v.pochette; // relatif (GitHub Pages) ou adresse Discogs
}
// Une pochette toute neuve n'est pas encore publiée par Pages : on la prend sur le dépôt.
window.secoursPochette = (img) => {
  const chemin = img.dataset.chemin;
  if (!img.dataset.essai && chemin && !/^https?:/.test(chemin)) {
    img.dataset.essai = "1";
    img.src = urlBrute(chemin);
  } else {
    img.replaceWith(Object.assign(document.createElement("div"), { className: "sans" }));
  }
};

// ——— État ———
const etat = { vinyles: [], vue: "jukebox", q: "", charge: false };

function trier(liste) {
  return liste.sort((x, y) => {
    if (x.pos && y.pos) return x.pos.localeCompare(y.pos);
    if (x.pos) return -1;
    if (y.pos) return 1;
    return x.artiste.localeCompare(y.artiste, "fr", { sensitivity: "base" });
  });
}
const parPosition = () => new Map(etat.vinyles.filter((v) => v.pos).map((v) => [v.pos, v]));

function correspond(v, q) {
  if (!q) return true;
  if (/^\d{1,3}$/.test(q)) {
    if (v.pos && (v.pos === pad(q) || JUKEBOX.selectionA(v.pos) === q || JUKEBOX.selectionB(v.pos) === q)) return true;
  }
  const n = norm(q);
  return [v.artiste, v.a, v.b, v.note].some((c) => norm(c).includes(n));
}

// ——— Rendu ———
function carte(v) {
  const src = srcPochette(v);
  const num = v.pos ? `<span class="num">${v.pos}</span>` : etat.q ? `<span class="num reserve">Réserve</span>` : "";
  const img = src
    ? `<img src="${esc(src)}" data-chemin="${esc(v.pochette)}" alt="" loading="lazy" decoding="async" onerror="secoursPochette(this)">`
    : `<div class="sans"></div>`;
  const selA = v.pos ? JUKEBOX.selectionA(v.pos) : "A";
  const selB = v.pos ? JUKEBOX.selectionB(v.pos) : "B";
  return `<button class="disque" data-id="${esc(v.id)}">
    <div class="pochette">${img}${num}</div>
    <div class="infos">
      <span class="artiste">${esc(v.artiste)}</span>
      <span class="face"><b>${selA}</b><span>${esc(v.a)}</span></span>
      ${v.b ? `<span class="face"><b>${selB}</b><span>${esc(v.b)}</span></span>` : ""}
    </div>
  </button>`;
}
const carteLibre = (pos) => `<button class="disque libre" data-libre="${pos}">
    <div class="pochette"><strong>${pos}</strong></div>
    <div class="infos"><span class="artiste">Libre</span><span>${JUKEBOX.selectionA(pos)} · ${JUKEBOX.selectionB(pos)}</span></div>
  </button>`;

function rendre() {
  const grille = $("grille");
  const jukebox = etat.vinyles.filter((v) => v.pos);
  const reserve = etat.vinyles.filter((v) => !v.pos);
  $("nb-jukebox").textContent = `${jukebox.length}`;
  $("nb-reserve").textContent = `${reserve.length}`;
  $("sous-titre").textContent = `Selection 101 · ${jukebox.length}/${JUKEBOX.positions} positions`;
  document.body.classList.toggle("recherche-active", !!etat.q);

  if (!etat.charge) return;
  let html = "";
  if (etat.q) {
    const res = etat.vinyles.filter((v) => correspond(v, etat.q));
    html = res.map(carte).join("");
    $("etat").textContent = res.length ? "" : "Aucun disque ne correspond.";
  } else if (etat.vue === "jukebox") {
    const occ = parPosition();
    html = toutesPositions.map((p) => (occ.has(p) ? carte(occ.get(p)) : carteLibre(p))).join("");
    $("etat").textContent = "";
  } else {
    html = reserve.map(carte).join("");
    $("etat").textContent = reserve.length ? "" : "Aucun disque en réserve.";
  }
  grille.innerHTML = html;
}

function changerVue(vue) {
  etat.vue = vue;
  for (const [id, v] of [["tab-jukebox", "jukebox"], ["tab-reserve", "reserve"]]) {
    $(id).classList.toggle("actif", v === vue);
    $(id).setAttribute("aria-selected", String(v === vue));
  }
  rendre();
  window.scrollTo({ top: 0 });
}

// ——— Feuilles ———
function ouvrir(id) {
  $(id).hidden = false;
  document.documentElement.style.overflow = "hidden";
}
function fermer(id) {
  $(id).hidden = true;
  if ([...document.querySelectorAll(".voile")].every((v) => v.hidden)) document.documentElement.style.overflow = "";
}
document.addEventListener("click", (e) => {
  const voile = e.target.closest(".voile");
  if (!voile) return;
  if (e.target === voile || e.target.closest("[data-fermer]")) fermer(voile.id);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const ouvert = [...document.querySelectorAll(".voile")].reverse().find((v) => !v.hidden);
  if (ouvert) fermer(ouvert.id);
});

// ——— Fiche disque ———
let fiche = null; // { id, nouveau, pochette, blob, apercu, discogs }

function remplirPositions(posActuelle, idActuel) {
  const occ = parPosition();
  const opts = [`<option value="">Réserve (hors jukebox)</option>`];
  for (const p of toutesPositions) {
    const o = occ.get(p);
    const lib = !o ? `${p} · libre` : o.id === idActuel ? `${p} · ce disque` : `${p} · ${o.artiste}`;
    opts.push(`<option value="${p}">${esc(lib)}</option>`);
  }
  $("f-pos").innerHTML = opts.join("");
  $("f-pos").value = posActuelle || "";
  majSelections();
}
function majSelections() {
  const p = $("f-pos").value;
  $("sel-a").textContent = p ? JUKEBOX.selectionA(p) : "";
  $("sel-b").textContent = p ? JUKEBOX.selectionB(p) : "";
  const o = p && parPosition().get(p);
  const aide = $("aide-pos");
  if (o && o.id !== fiche?.id) {
    aide.textContent = `${o.artiste} passera en réserve.`;
    aide.hidden = false;
  } else aide.hidden = true;
}
function afficherPochette(src) {
  const img = $("pochette-img");
  if (src) img.src = src; else img.removeAttribute("src");
  $("pochette-vide").hidden = !!src;
}

function ouvrirFiche(v, posLibre) {
  fiche = { id: v?.id || uid(), nouveau: !v, pochette: v?.pochette || "", blob: null, discogs: v?.discogs || null };
  $("fiche-titre").textContent = v ? v.artiste || "Disque" : "Nouveau disque";
  $("f-artiste").value = v?.artiste || "";
  $("f-a").value = v?.a || "";
  $("f-b").value = v?.b || "";
  $("f-note").value = v?.note || "";
  $("bloc-note").open = !!v?.note;
  remplirPositions(v ? v.pos : posLibre || "", v?.id);
  afficherPochette(v ? srcPochette(v) : "");
  $("btn-supprimer").hidden = !v;
  $("btn-supprimer").textContent = "Supprimer";
  delete $("btn-supprimer").dataset.confirmer;
  majLienDiscogs();
  $("zone-discogs").hidden = !!v;
  $("discogs-q").value = "";
  $("discogs-resultats").innerHTML = "";
  $("fiche-erreur").hidden = true;
  $("btn-enregistrer").disabled = false;
  $("btn-enregistrer").textContent = "Enregistrer";
  ouvrir("fiche");
  if (!v && matchMedia("(hover: hover)").matches) setTimeout(() => $("discogs-q").focus(), 50);
}
function majLienDiscogs() {
  const l = $("lien-discogs");
  l.hidden = !fiche?.discogs;
  if (fiche?.discogs) l.href = `https://www.discogs.com/release/${fiche.discogs}`;
}
function erreurFiche(msg) {
  $("fiche-erreur").textContent = msg;
  $("fiche-erreur").hidden = false;
}

$("grille").addEventListener("click", (e) => {
  const b = e.target.closest(".disque");
  if (!b) return;
  if (b.dataset.libre) return ouvrirFiche(null, b.dataset.libre);
  const v = etat.vinyles.find((x) => x.id === b.dataset.id);
  if (v) ouvrirFiche(v);
});
$("btn-ajouter").addEventListener("click", () => ouvrirFiche(null, ""));
$("f-pos").addEventListener("change", majSelections);
$("pochette-edit").addEventListener("click", () => $("pochette-fichier").click());
$("pochette-fichier").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  try {
    const blob = await pochetteCarree(f);
    fiche.blob = blob;
    afficherPochette(URL.createObjectURL(blob));
  } catch {
    erreurFiche("Cette image n'a pas pu être lue.");
  }
});

// Recherche Discogs
let discogsTimer, discogsCtl;
$("discogs-q").addEventListener("input", () => {
  clearTimeout(discogsTimer);
  discogsTimer = setTimeout(chercherDiscogs, 450);
});
$("discogs-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); clearTimeout(discogsTimer); chercherDiscogs(); }
});
async function chercherDiscogs() {
  const q = $("discogs-q").value.trim();
  const ul = $("discogs-resultats");
  if (q.length < 3) { ul.innerHTML = ""; return; }
  if (!cfg.discogs) {
    ul.innerHTML = `<li class="info">Ajoute ta clé Discogs dans les réglages (⚙︎) pour chercher automatiquement.</li>`;
    return;
  }
  ul.innerHTML = `<li class="info">Recherche…</li>`;
  const moi = (discogsCtl = {});
  try {
    const r = await discogs("database/search", { q, type: "release", format: "Vinyl", per_page: "25" });
    if (moi !== discogsCtl) return;
    const score = (x) => {
      const f = (x.format || []).join(" ");
      return (/7"/.test(f) ? 3 : 0) + (/Single|45 RPM/.test(f) ? 2 : 0) + (x.country === "France" ? 1 : 0);
    };
    const res = (r.results || []).map((x, i) => ({ x, s: score(x), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 12).map((o) => o.x);
    if (!res.length) { ul.innerHTML = `<li class="info">Rien trouvé. Essaie avec moins de mots.</li>`; return; }
    ul.innerHTML = res.map((x) => {
      const details = [x.year, x.country, (x.label || [])[0], (x.format || []).filter((f) => f !== "Vinyl").slice(0, 2).join(", ")].filter(Boolean).join(" · ");
      const vignette = x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : `<span class="vignette"></span>`;
      return `<li><button type="button" data-release="${x.id}">${vignette}<span><strong>${esc(x.title)}</strong><small>${esc(details)}</small></span></button></li>`;
    }).join("");
  } catch (e) {
    if (moi !== discogsCtl) return;
    ul.innerHTML = `<li class="info">${e.status === 401 ? "Clé Discogs refusée — vérifie-la dans les réglages." : e.status === 429 ? "Discogs demande une petite pause, réessaie dans une minute." : "Discogs ne répond pas. Vérifie ta connexion."}</li>`;
  }
}
$("discogs-resultats").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-release]");
  if (!b) return;
  const ul = $("discogs-resultats");
  ul.innerHTML = `<li class="info">Import…</li>`;
  try {
    const rel = await discogs(`releases/${b.dataset.release}`);
    const artiste = nettoyerArtiste(rel.artists_sort || (rel.artists || []).map((a) => a.anv || a.name).join(" & "));
    const { a, b: faceB } = facesDepuisTracklist(rel.tracklist);
    $("f-artiste").value = artiste;
    $("f-a").value = a || rel.title || "";
    $("f-b").value = faceB;
    $("fiche-titre").textContent = artiste || "Nouveau disque";
    fiche.discogs = rel.id;
    majLienDiscogs();
    const image = (rel.images || []).find((i) => i.type === "primary") || (rel.images || [])[0];
    if (image?.uri && !fiche.blob) {
      try {
        const r = await fetch(image.uri, { mode: "cors" });
        if (!r.ok) throw 0;
        fiche.blob = await pochetteCarree(await r.blob());
        afficherPochette(URL.createObjectURL(fiche.blob));
      } catch {
        fiche.pochette = image.uri; // image gardée chez Discogs
        afficherPochette(image.uri);
      }
    }
    ul.innerHTML = "";
    $("zone-discogs").hidden = true;
    const doublon = etat.vinyles.find((v) => norm(v.artiste) === norm($("f-artiste").value) && norm(v.a) === norm($("f-a").value));
    if (doublon) erreurFiche(`Tu l'as déjà : ${doublon.pos ? "position " + doublon.pos : "en réserve"}.`);
  } catch {
    ul.innerHTML = `<li class="info">Ce disque n'a pas pu être importé.</li>`;
  }
});

// Enregistrer
$("form-disque").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!cfg.github) { fermer("fiche"); ouvrirReglages("Ajoute ta clé GitHub pour pouvoir enregistrer."); return; }
  const artiste = $("f-artiste").value.trim();
  const a = $("f-a").value.trim();
  if (!artiste || !a) return erreurFiche("Il faut au moins l'artiste et la face A.");
  const btn = $("btn-enregistrer");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";
  $("fiche-erreur").hidden = true;
  try {
    const ancien = etat.vinyles.find((v) => v.id === fiche.id);
    let pochette = fiche.pochette;
    if (fiche.blob) {
      pochette = `${DOSSIER_POCHETTES}/${fiche.id}-${Date.now().toString(36)}.jpg`;
      await ecrireFichier(pochette, await blobToB64(fiche.blob), `Pochette : ${artiste}`);
      apercusLocaux.set(pochette, URL.createObjectURL(fiche.blob));
    }
    const pos = $("f-pos").value || null;
    const note = $("f-note").value.trim();
    const disque = { id: fiche.id, artiste, a, b: $("f-b").value.trim(), pos };
    if (pochette) disque.pochette = pochette;
    if (note) disque.note = note;
    if (fiche.discogs) disque.discogs = fiche.discogs;
    await modifierCollection(`${fiche.nouveau ? "Ajout" : "Modification"} : ${artiste} – ${a}`, (liste) => {
      if (pos) for (const v of liste) if (v.id !== disque.id && v.pos === pos) v.pos = null;
      const i = liste.findIndex((v) => v.id === disque.id);
      if (i >= 0) liste[i] = disque; else liste.push(disque);
      return liste;
    });
    if (ancien?.pochette && ancien.pochette !== pochette && ancien.pochette.startsWith(DOSSIER_POCHETTES + "/")) supprimerFichier(ancien.pochette);
    fermer("fiche");
    rendre();
    toast(pos ? `Enregistré en ${pos}` : "Enregistré en réserve");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Enregistrer";
    erreurFiche(err.status === 401 || err.status === 403 || err.status === 404
      ? "GitHub refuse l'enregistrement — vérifie ta clé dans les réglages."
      : "Enregistrement impossible. Vérifie ta connexion et réessaie.");
  }
});

// Supprimer (deux appuis)
$("btn-supprimer").addEventListener("click", async () => {
  const b = $("btn-supprimer");
  if (!cfg.github) { fermer("fiche"); ouvrirReglages("Ajoute ta clé GitHub pour pouvoir modifier."); return; }
  if (!b.dataset.confirmer) {
    b.dataset.confirmer = "1";
    b.textContent = "Confirmer la suppression";
    return;
  }
  b.textContent = "Suppression…";
  try {
    const ancien = etat.vinyles.find((v) => v.id === fiche.id);
    await modifierCollection(`Suppression : ${ancien?.artiste || ""}`, (liste) => liste.filter((v) => v.id !== fiche.id));
    if (ancien?.pochette?.startsWith(DOSSIER_POCHETTES + "/")) supprimerFichier(ancien.pochette);
    fermer("fiche");
    rendre();
    toast("Disque supprimé");
  } catch {
    b.textContent = "Supprimer";
    delete b.dataset.confirmer;
    erreurFiche("Suppression impossible. Réessaie.");
  }
});

// ——— Export 45'O'Juke ———
// Format lu par 45'O'Juke : artiste;titre_face_a;titre_face_b, une ligne par étiquette.
// Il ignore les lignes vides : une position libre est donc marquée « – » si on veut garder l'alignement.
function lignesExport(garderTrous) {
  const occ = parPosition();
  const occupees = toutesPositions.filter((p) => occ.has(p));
  const derniere = occupees.length ? toutesPositions.indexOf(occupees[occupees.length - 1]) : -1;
  const lignes = [];
  for (let i = 0; i <= derniere; i++) {
    const v = occ.get(toutesPositions[i]);
    if (v) lignes.push([v.artiste, v.a, v.b || ""]);
    else if (garderTrous) lignes.push(["–", "", ""]);
  }
  return lignes;
}
function trousExport() {
  const occ = parPosition();
  const occupees = toutesPositions.filter((p) => occ.has(p));
  if (!occupees.length) return [];
  const der = toutesPositions.indexOf(occupees[occupees.length - 1]);
  return toutesPositions.slice(0, der + 1).filter((p) => !occ.has(p));
}
function csv45(lignes) {
  const c = (s) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return "﻿" + ["artiste;titre_face_a;titre_face_b", ...lignes.map((l) => l.map(c).join(";"))].join("\n") + "\n";
}
function tsv45(lignes) {
  const c = (s) => s.replace(/[\t\r\n]+/g, " ");
  return ["artiste\ttitre_face_a\ttitre_face_b", ...lignes.map((l) => l.map(c).join("\t"))].join("\n") + "\n";
}
function ouvrirExport() {
  const nb = etat.vinyles.filter((v) => v.pos).length;
  const trous = trousExport();
  $("export-resume").textContent = nb
    ? `${nb} disque${nb > 1 ? "s" : ""} du jukebox, une étiquette par disque, dans l'ordre des positions.`
    : "Aucun disque dans le jukebox pour l'instant.";
  $("export-trous").hidden = !trous.length;
  if (trous.length) {
    const liste = trous.length > 8 ? trous.slice(0, 8).join(", ") + "…" : trous.join(", ");
    $("export-trous-texte").textContent = `Position${trous.length > 1 ? "s" : ""} libre${trous.length > 1 ? "s" : ""} : ${liste}. 45'O'Juke saute les lignes vides, les étiquettes suivantes seraient décalées.`;
  }
  $("btn-csv").disabled = $("btn-copier").disabled = !nb;
  ouvrir("export");
}
$("btn-export").addEventListener("click", ouvrirExport);
$("btn-csv").addEventListener("click", () => {
  const contenu = csv45(lignesExport($("export-garder").checked));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenu], { type: "text/csv;charset=utf-8" }));
  a.download = `jukebox-45ojuke-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("CSV prêt pour 45'O'Juke");
});
$("btn-copier").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(tsv45(lignesExport($("export-garder").checked)));
    toast("Liste copiée — colle-la dans 45'O'Juke");
  } catch {
    toast("Copie impossible sur ce navigateur");
  }
});

// ——— Réglages ———
function ouvrirReglages(message) {
  $("r-github").value = cfg.github;
  $("r-discogs").value = cfg.discogs;
  $("r-depot").value = cfg.depot;
  $("r-branche").value = cfg.branche;
  $("r-depot-nom").textContent = cfg.depot;
  $("r-statut").textContent = message || (cfg.github ? "Clé GitHub enregistrée sur cet appareil." : "Sans clé GitHub, la collection est en lecture seule.");
  ouvrir("reglages");
}
$("btn-reglages").addEventListener("click", () => ouvrirReglages());
$("form-reglages").addEventListener("submit", async (e) => {
  e.preventDefault();
  const depot = $("r-depot").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  lsSet("jb.depot", depot && depot !== depotDetecte() ? depot : "");
  const branche = $("r-branche").value.trim();
  lsSet("jb.branche", branche && branche !== "main" ? branche : "");
  lsSet("jb.github", $("r-github").value.trim());
  lsSet("jb.discogs", $("r-discogs").value.trim());
  $("r-statut").textContent = "Vérification…";
  if (cfg.github) {
    try {
      const repo = await (await fetch(`https://api.github.com/repos/${cfg.depot}`, { headers: { Authorization: `Bearer ${cfg.github}` } })).json();
      if (!repo?.permissions?.push) throw 0;
    } catch {
      $("r-statut").textContent = `Cette clé GitHub ne permet pas d'écrire dans ${cfg.depot}.`;
      return;
    }
  }
  fermer("reglages");
  toast("Réglages enregistrés");
  charger();

// L'ancienne version installait un service worker qui gardait l'ancien site en cache.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
}
});

// ——— Chargement ———
async function charger() {
  try {
    const { donnees } = await lireCollection();
    etat.vinyles = trier(donnees.vinyles || []);
  } catch {
    // Secours : la copie publiée par GitHub Pages (peut avoir une minute de retard).
    try {
      const r = await fetch(`${FICHIER}?t=${Date.now()}`, { cache: "no-store" });
      etat.vinyles = trier((await r.json()).vinyles || []);
    } catch {
      $("etat").textContent = location.protocol === "file:"
        ? "Ouvre plutôt « Ouvrir le jukebox.command » (ou le site en ligne) : le navigateur bloque la lecture de la collection depuis un simple fichier."
        : "Impossible de charger la collection. Vérifie ta connexion.";
      return;
    }
  }
  etat.charge = true;
  rendre();
}

$("tab-jukebox").addEventListener("click", () => changerVue("jukebox"));
$("tab-reserve").addEventListener("click", () => changerVue("reserve"));
$("recherche").addEventListener("input", (e) => {
  etat.q = e.target.value.trim();
  rendre();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && etat.charge && document.querySelectorAll(".voile:not([hidden])").length === 0) charger();

// L'ancienne version installait un service worker qui gardait l'ancien site en cache.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
}
});
charger();

// L'ancienne version installait un service worker qui gardait l'ancien site en cache.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
}
