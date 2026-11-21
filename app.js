// Jukebox — Selection 101
// Sur le Mac (App/Ouvrir le jukebox) : on ajoute, modifie et publie.
// En ligne (GitHub Pages) : consultation seule.
"use strict";

// ——— Réglages faciles à modifier ———
const JUKEBOX = {
  positions: 80,                  // positions 00 → 79
  selectionA: (pos) => "1" + pos, // numéro à composer pour la face A
  selectionB: (pos) => "2" + pos, // numéro à composer pour la face B
};
const TAILLE_POCHETTE = 600;      // px, carré

// ——— Outils ———
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const pad = (n) => String(n).padStart(2, "0");
const toutesPositions = Array.from({ length: JUKEBOX.positions }, (_, i) => pad(i));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("visible"), 3000);
}

// ——— Serveur local (uniquement sur le Mac) ———
async function api(chemin, options = {}) {
  const r = await fetch(`/api/${chemin}`, { ...options, headers: { "X-Jukebox": "1", ...(options.headers || {}) } });
  const donnees = (r.headers.get("Content-Type") || "").includes("json") ? await r.json() : await r.blob();
  if (!r.ok) {
    const e = new Error(donnees?.erreur || `Erreur ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return donnees;
}
const posterJson = (chemin, corps) => api(chemin, { method: "POST", body: JSON.stringify(corps), headers: { "Content-Type": "application/json" } });

async function modeEdition() {
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) return null;
  try { return await api("etat"); } catch { return null; }
}

// ——— Discogs (via le serveur local, qui garde la clé) ———
const discogs = (chemin, params = {}) => api(`discogs?${new URLSearchParams({ chemin, ...params })}`);
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

// ——— État ———
const etat = { vinyles: [], vue: "jukebox", q: "", charge: false, edition: null };

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
  if (/^\d{1,3}$/.test(q) && v.pos && (v.pos === pad(q) || JUKEBOX.selectionA(v.pos) === q || JUKEBOX.selectionB(v.pos) === q)) return true;
  const n = norm(q);
  return [v.artiste, v.a, v.b, v.note].some((c) => norm(c).includes(n));
}

// ——— Rendu ———
function carte(v) {
  // Pochette présente : V vert sur la pochette, et numéro en vert s'il y en a un.
  const num = v.pos ? `<span class="num${v.avecPochette ? " vert" : ""}">${v.pos}</span>` : etat.q ? `<span class="num reserve">Réserve</span>` : "";
  const coche = v.avecPochette ? `<span class="coche" title="Pochette présente"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>` : "";
  const img = v.pochette
    ? `<img src="${esc(v.pochette)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'sans'}))">`
    : `<div class="sans"></div>`;
  const selA = v.pos ? JUKEBOX.selectionA(v.pos) : "A";
  const selB = v.pos ? JUKEBOX.selectionB(v.pos) : "B";
  return `<button class="disque" data-id="${esc(v.id)}">
    <div class="pochette">${img}${num}${coche}</div>
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
  const jukebox = etat.vinyles.filter((v) => v.pos);
  const reserve = etat.vinyles.filter((v) => !v.pos);
  $("nb-jukebox").textContent = `${jukebox.length}`;
  $("nb-reserve").textContent = `${reserve.length}`;
  $("sous-titre").textContent = `Selection 101 · ${jukebox.length}/${JUKEBOX.positions} positions`;
  document.body.classList.toggle("recherche-active", !!etat.q);
  if (!etat.charge) return;

  let html, vide = "";
  if (etat.q) {
    const res = etat.vinyles.filter((v) => correspond(v, etat.q));
    html = res.map(carte).join("");
    if (!res.length) vide = "Aucun disque ne correspond.";
  } else if (etat.vue === "jukebox") {
    const occ = parPosition();
    html = toutesPositions.map((p) => (occ.has(p) ? carte(occ.get(p)) : carteLibre(p))).join("");
  } else {
    html = reserve.map(carte).join("");
    if (!reserve.length) vide = "Aucun disque en réserve.";
  }
  $("etat").textContent = vide;
  $("grille").innerHTML = html;
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
  if (voile && (e.target === voile || e.target.closest("[data-fermer]"))) fermer(voile.id);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const ouvert = [...document.querySelectorAll(".voile")].reverse().find((v) => !v.hidden);
  if (ouvert) fermer(ouvert.id);
});

// ——— Fiche disque ———
let fiche = null; // { id, nouveau, pochette, blob, discogs, choixDoublon, remplacer }

// ——— Doublons ———
function doublonActuel() {
  const artiste = norm($("f-artiste").value), a = norm($("f-a").value);
  if (!artiste || !a) return null;
  return etat.vinyles.find((v) => v.id !== fiche.id && v.id !== fiche.remplacer && norm(v.artiste) === artiste && norm(v.a) === a) || null;
}
function afficherDoublon(d) {
  $("doublon-texte").textContent = `Tu as déjà ce disque : ${d.artiste} – ${d.a}, ${d.pos ? "position " + d.pos : "en réserve"}.`;
  $("doublon").dataset.id = d.id;
  $("doublon").hidden = false;
  $("doublon-choix").hidden = true;
}
$("doublon-garder").addEventListener("click", () => {
  fiche.choixDoublon = $("doublon").dataset.id;
  $("doublon").hidden = true;
  $("doublon-choix").textContent = "Il sera ajouté en double.";
  $("doublon-choix").hidden = false;
});
$("doublon-remplacer").addEventListener("click", () => {
  fiche.remplacer = $("doublon").dataset.id;
  $("doublon").hidden = true;
  $("doublon-choix").textContent = "L'ancien sera supprimé à l'enregistrement.";
  $("doublon-choix").hidden = false;
});
$("doublon-annuler").addEventListener("click", () => fermer("fiche"));
for (const id of ["f-artiste", "f-a"]) {
  $(id).addEventListener("input", () => {
    if (!fiche) return;
    fiche.choixDoublon = fiche.remplacer = null;
    $("doublon").hidden = $("doublon-choix").hidden = true;
  });
}

function remplirPositions(posActuelle, idActuel) {
  const occ = parPosition();
  // Ordre : réserve, position actuelle, positions libres, puis positions occupées.
  const option = (p, lib) => `<option value="${p}">${esc(lib)}</option>`;
  const actuelle = toutesPositions.filter((p) => occ.get(p)?.id === idActuel).map((p) => option(p, `${p} · ce disque`));
  const libres = toutesPositions.filter((p) => !occ.has(p)).map((p) => option(p, `${p} · libre`));
  const occupees = toutesPositions.filter((p) => occ.has(p) && occ.get(p).id !== idActuel).map((p) => option(p, `${p} · ${occ.get(p).artiste}`));
  $("f-pos").innerHTML = [
    `<option value="">Réserve (hors jukebox)</option>`,
    ...actuelle,
    libres.length ? `<optgroup label="Libres">${libres.join("")}</optgroup>` : "",
    occupees.length ? `<optgroup label="Occupées (le disque passera en réserve)">${occupees.join("")}</optgroup>` : "",
  ].join("");
  $("f-pos").value = posActuelle || "";
  majSelections();
}
function majSelections() {
  const p = $("f-pos").value;
  $("sel-a").textContent = p ? JUKEBOX.selectionA(p) : "";
  $("sel-b").textContent = p ? JUKEBOX.selectionB(p) : "";
  $("btn-reserve").hidden = !p;
  const o = p && parPosition().get(p);
  $("aide-pos").hidden = !(o && o.id !== fiche?.id);
  if (o) $("aide-pos").textContent = `${o.artiste} passera en réserve.`;
}
function afficherPochette(src) {
  const img = $("pochette-img");
  if (src) img.src = src; else img.removeAttribute("src");
  $("pochette-vide").hidden = !!src;
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

function ouvrirFiche(v, posLibre) {
  fiche = { id: v?.id || uid(), nouveau: !v, pochette: v?.pochette || "", blob: null, discogs: v?.discogs || null };
  $("fiche-titre").textContent = v ? v.artiste || "Disque" : "Nouveau disque";
  $("f-artiste").value = v?.artiste || "";
  $("f-a").value = v?.a || "";
  $("f-b").value = v?.b || "";
  $("f-note").value = v?.note || "";
  $("f-avec-pochette").checked = !!v?.avecPochette;
  $("bloc-note").open = !!v?.note;
  remplirPositions(v ? v.pos : posLibre || "", v?.id);
  afficherPochette(v?.pochette || "");
  $("btn-supprimer").hidden = !v;
  $("btn-supprimer").textContent = "Supprimer";
  delete $("btn-supprimer").dataset.confirmer;
  majLienDiscogs();
  $("zone-discogs").hidden = !!v;
  $("discogs-q").value = "";
  $("discogs-resultats").innerHTML = "";
  $("fiche-erreur").hidden = true;
  $("doublon").hidden = $("doublon-choix").hidden = true;
  $("btn-enregistrer").disabled = false;
  $("btn-enregistrer").textContent = "Enregistrer";
  ouvrir("fiche");
  if (!v) setTimeout(() => $("discogs-q").focus(), 50);
}

$("grille").addEventListener("click", (e) => {
  const b = e.target.closest(".disque");
  if (!b || !etat.edition) return;
  if (b.dataset.libre) return ouvrirFiche(null, b.dataset.libre);
  const v = etat.vinyles.find((x) => x.id === b.dataset.id);
  if (v) ouvrirFiche(v);
});
$("btn-ajouter").addEventListener("click", () => ouvrirFiche(null, ""));
$("f-pos").addEventListener("change", majSelections);
$("btn-reserve").addEventListener("click", () => {
  $("f-pos").value = "";
  majSelections();
});
$("pochette-edit").addEventListener("click", () => $("pochette-fichier").click());
$("pochette-fichier").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  try {
    fiche.blob = await pochetteCarree(f);
    afficherPochette(URL.createObjectURL(fiche.blob));
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
  if (!etat.edition.discogs) {
    ul.innerHTML = `<li class="info">Ajoute ta clé Discogs dans les réglages (⚙︎) pour remplir automatiquement.</li>`;
    return;
  }
  ul.innerHTML = `<li class="info">Recherche…</li>`;
  const moi = (discogsCtl = {});
  try {
    const r = await discogs("database/search", { q, type: "release", format: "Vinyl", per_page: "50" });
    if (moi !== discogsCtl) return;
    // 45 tours d'abord (éditions françaises en tête), puis les autres formats.
    const est45 = (x) => /7"|45 RPM/.test((x.format || []).join(" "));
    const parPays = (liste) => liste.map((x, i) => ({ x, i })).sort((a, b) => (b.x.country === "France") - (a.x.country === "France") || a.i - b.i).map((o) => o.x);
    // Discogs liste chaque pressage : on n'en garde qu'un par disque et par pays.
    const vus = new Set();
    const res = (r.results || []).filter((x) => {
      const cle = `${x.master_id || norm(x.title)}|${x.country || ""}|${est45(x)}`;
      return !vus.has(cle) && vus.add(cle);
    });
    const quarante5 = parPays(res.filter(est45)).slice(0, 15);
    const autres = parPays(res.filter((x) => !est45(x))).slice(0, 8);
    if (!res.length) { ul.innerHTML = `<li class="info">Rien trouvé. Essaie avec moins de mots.</li>`; return; }
    const ligne = (x) => {
      const details = [x.year, x.country, (x.label || [])[0], (x.format || []).filter((f) => f !== "Vinyl").slice(0, 2).join(", ")].filter(Boolean).join(" · ");
      const vignette = x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : `<span class="vignette"></span>`;
      return `<li><button type="button" data-release="${x.id}">${vignette}<span><strong>${esc(x.title)}</strong><small>${esc(details)}</small></span></button></li>`;
    };
    ul.innerHTML = [
      `<li class="titre-resultats">45 tours</li>`,
      quarante5.length ? quarante5.map(ligne).join("") : `<li class="info">Aucun 45 tours trouvé.</li>`,
      autres.length ? `<li class="titre-resultats">Autres formats</li>${autres.map(ligne).join("")}` : "",
    ].join("");
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
        fiche.blob = await pochetteCarree(await api(`image?url=${encodeURIComponent(image.uri)}`));
        afficherPochette(URL.createObjectURL(fiche.blob));
      } catch {}
    }
    ul.innerHTML = "";
    $("zone-discogs").hidden = true;
    fiche.choixDoublon = fiche.remplacer = null;
    const doublon = doublonActuel();
    if (doublon) afficherDoublon(doublon);
  } catch {
    ul.innerHTML = `<li class="info">Ce disque n'a pas pu être importé.</li>`;
  }
});

// Enregistrer la collection dans le dossier du Mac
async function enregistrerCollection(vinyles) {
  await posterJson("collection", { vinyles: trier(vinyles) });
  etat.vinyles = vinyles;
}
const retirerPochette = (chemin) => {
  if (chemin?.startsWith("covers/")) api(`retirer-pochette?nom=${encodeURIComponent(chemin.slice(7))}`, { method: "POST" }).catch(() => {});
};

$("form-disque").addEventListener("submit", async (e) => {
  e.preventDefault();
  const artiste = $("f-artiste").value.trim();
  const a = $("f-a").value.trim();
  if (!artiste || !a) return erreurFiche("Il faut au moins l'artiste et la face A.");
  const doublon = doublonActuel();
  if (doublon && fiche.choixDoublon !== doublon.id) return afficherDoublon(doublon);
  const btn = $("btn-enregistrer");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";
  $("fiche-erreur").hidden = true;
  try {
    const ancien = etat.vinyles.find((v) => v.id === fiche.id);
    const remplace = fiche.remplacer && etat.vinyles.find((v) => v.id === fiche.remplacer);
    let pochette = fiche.pochette;
    if (fiche.blob) {
      const nom = `${fiche.id}-${Date.now().toString(36)}.jpg`;
      pochette = (await api(`pochette?nom=${nom}`, { method: "POST", body: fiche.blob })).chemin;
    }
    const pos = $("f-pos").value || null;
    const note = $("f-note").value.trim();
    const disque = { id: fiche.id, artiste, a, b: $("f-b").value.trim(), pos };
    if (pochette) disque.pochette = pochette;
    if (note) disque.note = note;
    if ($("f-avec-pochette").checked) disque.avecPochette = true;
    if (fiche.discogs) disque.discogs = fiche.discogs;
    const liste = etat.vinyles.map((v) => (pos && v.id !== disque.id && v.pos === pos ? { ...v, pos: null } : v)).filter((v) => v.id !== disque.id && v.id !== remplace?.id);
    await enregistrerCollection([...liste, disque]);
    if (ancien?.pochette !== pochette) retirerPochette(ancien?.pochette);
    if (remplace?.pochette && remplace.pochette !== pochette) retirerPochette(remplace.pochette);
    fermer("fiche");
    rendre();
    toast(pos ? `Enregistré en ${pos}` : "Enregistré en réserve");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Enregistrer";
    erreurFiche(`Enregistrement impossible : ${err.message}`);
  }
});

$("btn-supprimer").addEventListener("click", async () => {
  const b = $("btn-supprimer");
  if (!b.dataset.confirmer) {
    b.dataset.confirmer = "1";
    b.textContent = "Confirmer la suppression";
    return;
  }
  try {
    const ancien = etat.vinyles.find((v) => v.id === fiche.id);
    await enregistrerCollection(etat.vinyles.filter((v) => v.id !== fiche.id));
    retirerPochette(ancien?.pochette);
    fermer("fiche");
    rendre();
    toast("Disque supprimé");
  } catch {
    erreurFiche("Suppression impossible. Réessaie.");
  }
});

// ——— Publier en ligne ———
$("btn-publier").addEventListener("click", async () => {
  if (!etat.edition.github) return ouvrirReglages("Ajoute ta clé GitHub pour publier.");
  const b = $("btn-publier");
  b.disabled = true;
  b.textContent = "Publication…";
  const suivi = setInterval(async () => {
    try {
      const p = await api("progression");
      if (p.total) b.textContent = `Publication… ${p.fait}/${p.total}`;
    } catch {}
  }, 700);
  try {
    const r = await api("publier", { method: "POST" });
    toast(r.a_jour ? "Déjà à jour en ligne ✓" : "Publié ✓ — en ligne d'ici une minute");
  } catch (err) {
    toast(err.message);
  } finally {
    clearInterval(suivi);
    b.disabled = false;
    b.textContent = "Publier";
  }
});

// ——— Export 45'O'Juke ———
// Format lu par 45'O'Juke : artiste;titre_face_a;titre_face_b, une ligne par étiquette.
// Il ignore les lignes vides : une position libre est donc marquée « – » si on veut garder l'alignement.
function trousExport() {
  const occ = parPosition();
  const occupees = toutesPositions.filter((p) => occ.has(p));
  if (!occupees.length) return [];
  return toutesPositions.slice(0, toutesPositions.indexOf(occupees.at(-1)) + 1).filter((p) => !occ.has(p));
}
function lignesExport(garderTrous) {
  const occ = parPosition();
  const occupees = toutesPositions.filter((p) => occ.has(p));
  const derniere = occupees.length ? toutesPositions.indexOf(occupees.at(-1)) : -1;
  const lignes = [];
  for (const p of toutesPositions.slice(0, derniere + 1)) {
    const v = occ.get(p);
    if (v) lignes.push([v.artiste, v.a, v.b || ""]);
    else if (garderTrous) lignes.push(["–", "", ""]);
  }
  return lignes;
}
function csv45(lignes) {
  const c = (s) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return "﻿" + ["artiste;titre_face_a;titre_face_b", ...lignes.map((l) => l.map(c).join(";"))].join("\n") + "\n";
}
function tsv45(lignes) {
  const c = (s) => s.replace(/[\t\r\n]+/g, " ");
  return ["artiste\ttitre_face_a\ttitre_face_b", ...lignes.map((l) => l.map(c).join("\t"))].join("\n") + "\n";
}
$("btn-export").addEventListener("click", () => {
  const nb = etat.vinyles.filter((v) => v.pos).length;
  const trous = trousExport();
  $("export-resume").textContent = nb
    ? `${nb} disque${nb > 1 ? "s" : ""} du jukebox, une étiquette par disque, dans l'ordre des positions.`
    : "Aucun disque dans le jukebox pour l'instant.";
  $("export-trous").hidden = !trous.length;
  if (trous.length) {
    const s = trous.length > 1 ? "s" : "";
    const liste = trous.length > 8 ? trous.slice(0, 8).join(", ") + "…" : trous.join(", ");
    $("export-trous-texte").textContent = `Position${s} libre${s} : ${liste}. 45'O'Juke saute les lignes vides, les étiquettes suivantes seraient décalées.`;
  }
  $("btn-csv").disabled = $("btn-copier").disabled = !nb;
  ouvrir("export");
});
$("btn-csv").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv45(lignesExport($("export-garder").checked))], { type: "text/csv;charset=utf-8" }));
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

// ——— Réglages (clés gardées par le Mac dans App/reglages.json) ———
function ouvrirReglages(message) {
  $("r-github").value = "";
  $("r-discogs").value = "";
  $("r-github").placeholder = etat.edition.github ? "Enregistrée ✓" : "github_pat_…";
  $("r-discogs").placeholder = etat.edition.discogs ? "Enregistré ✓" : "Jeton personnel";
  $("r-statut").textContent = message || "";
  ouvrir("reglages");
}
$("btn-reglages").addEventListener("click", () => ouvrirReglages());
$("form-reglages").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("r-statut").textContent = "Vérification…";
  try {
    const r = await posterJson("reglages", { github: $("r-github").value, discogs: $("r-discogs").value });
    Object.assign(etat.edition, r);
    fermer("reglages");
    toast("Réglages enregistrés");
  } catch (err) {
    $("r-statut").textContent = err.message;
  }
});

// ——— Chargement ———
async function charger() {
  try {
    const r = await fetch(`data/vinyles.json?t=${Date.now()}`, { cache: "no-store" });
    etat.vinyles = trier((await r.json()).vinyles || []);
    etat.charge = true;
    rendre();
  } catch {
    $("etat").textContent = location.protocol === "file:"
      ? "Ouvre le jukebox avec « Ouvrir le jukebox » dans le dossier App."
      : "Impossible de charger la collection. Vérifie ta connexion.";
  }
}

$("tab-jukebox").addEventListener("click", () => changerVue("jukebox"));
$("tab-reserve").addEventListener("click", () => changerVue("reserve"));
$("recherche").addEventListener("input", (e) => {
  etat.q = e.target.value.trim();
  rendre();
});

(async () => {
  etat.edition = await modeEdition();
  document.body.classList.toggle("edition", !!etat.edition);
  await charger();
  if (!etat.edition) {
    // En ligne : on recharge en revenant sur l'appli, pour voir la dernière publication.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") charger(); });
  }
})();
