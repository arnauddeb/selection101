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
const TAILLE_POCHETTE = 320;      // px, carré (≈ 13 Ko en WebP)
const QUALITE_POCHETTE = 0.7;     // qualité WebP (0 à 1)

// ——— Outils ———
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const pad = (n) => String(n).padStart(2, "0");
const toutesPositions = Array.from({ length: JUKEBOX.positions }, (_, i) => pad(i));
const euros = (n) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: n >= 100 ? 0 : 2 });
// Prix court sans symbole (« 0,72 », « 12 ») pour la fourchette bas · moyen · haut.
const court = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: n % 1 && n < 100 ? 2 : 0, maximumFractionDigits: n >= 100 ? 0 : 2 });
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
    // 404 sur l'API : le serveur du Mac est une ancienne version.
    const message = r.status === 404 && donnees?.erreur === "Inconnu"
      ? "Le serveur du Mac n'est pas à jour : ferme l'onglet et relance « Ouvrir le jukebox » (dossier App)."
      : donnees?.erreur || `Erreur ${r.status}`;
    const e = new Error(message);
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
    // Toujours en WebP : par le navigateur s'il sait le faire (Chrome), sinon par l'encodeur inclus (Safari).
    const natif = await new Promise((ok) => c.toBlob(ok, "image/webp", QUALITE_POCHETTE));
    if (natif?.type === "image/webp") return natif;
    const { encode } = await import("./outils/webp/webp.js");
    const webp = await encode(ctx.getImageData(0, 0, c.width, c.height), { quality: Math.round(QUALITE_POCHETTE * 100) });
    return new Blob([webp], { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ——— État ———
const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// Filtres mémorisés sur l'appareil.
const FILTRES = ["tri", "doublon", "genre", "style", "decennie", "pays", "label", "format", "pochette", "prix", "discogs"];
// Filtres à choix remplis avec les valeurs de la collection (infos Discogs).
const FILTRES_LISTE = {
  genre: { tous: "Tous", valeurs: (v) => v.infos?.genres || [] },
  style: { tous: "Tous", valeurs: (v) => v.infos?.styles || [] },
  decennie: { tous: "Toutes", valeurs: (v) => (v.infos?.annee ? [String(Math.floor(v.infos.annee / 10) * 10)] : []),
    nom: (d) => `Années ${d < 2000 ? d.slice(2) : d}`, ordre: (a, b) => a[0] - b[0] },
  pays: { tous: "Tous", valeurs: (v) => (v.infos?.pays ? [v.infos.pays] : []) },
  label: { tous: "Tous", valeurs: (v) => (v.infos?.label ? [v.infos.label] : []) },
  format: { tous: "Tous", valeurs: (v) => v.infos?.formats || [] },
};
const etat = { vinyles: [], vue: "jukebox", q: "", charge: false, edition: null, f: Object.fromEntries(FILTRES.map((k) => [k, lsGet(`jb.${k}`)])) };

const comparer = (a, b) => String(a || "").localeCompare(String(b || ""), "fr", { sensitivity: "base" });
const TRIS = {
  artiste: (x, y) => comparer(x.artiste, y.artiste) || comparer(x.a, y.a),
  titre: (x, y) => comparer(x.a, y.a) || comparer(x.artiste, y.artiste),
  prix: (x, y) => (y.prix?.moyen || -1) - (x.prix?.moyen || -1) || comparer(x.artiste, y.artiste),
  "prix-asc": (x, y) => (x.prix?.moyen ?? Infinity) - (y.prix?.moyen ?? Infinity) || comparer(x.artiste, y.artiste),
  annee: (x, y) => (x.infos?.annee || Infinity) - (y.infos?.annee || Infinity) || comparer(x.artiste, y.artiste),
  "annee-desc": (x, y) => (y.infos?.annee || -1) - (x.infos?.annee || -1) || comparer(x.artiste, y.artiste),
  recherche: (x, y) => (y.infos?.want ?? -1) - (x.infos?.want ?? -1) || comparer(x.artiste, y.artiste),
};
const TRANCHES = { bas: (p) => p < 5, moyen: (p) => p >= 5 && p <= 15, haut: (p) => p > 15 };
// Doublons : même identifiant Discogs ; sans identifiant, même artiste et mêmes faces A et B.
function doublons() {
  const groupes = new Map();
  for (const v of etat.vinyles) {
    const r = releaseDe(v);
    for (const cle of [r ? `r${r}` : `t${base(v.artiste)}|${base(v.a)}|${base(v.b)}`]) {
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(v.id);
    }
  }
  return new Set([...groupes.values()].filter((ids) => ids.length > 1).flat());
}
function filtrer(liste) {
  const f = etat.f;
  const dbl = f.doublon ? doublons() : null;
  const l = liste.filter((v) => {
    if (dbl && !dbl.has(v.id)) return false;
    const p = v.prix?.moyen;
    for (const [k, d] of Object.entries(FILTRES_LISTE)) if (f[k] && !d.valeurs(v).includes(f[k])) return false;
    if (f.pochette && !!v.avecPochette !== (f.pochette === "avec")) return false;
    if (f.prix === "inconnu" ? p : f.prix && !(p && TRANCHES[f.prix](p))) return false;
    if (etat.edition && f.discogs && !!v.discogs !== (f.discogs === "oui")) return false;
    return true;
  });
  // Doublons côte à côte, sauf si un autre tri est choisi.
  return TRIS[f.tri] ? l.sort(TRIS[f.tri]) : dbl ? l.sort(TRIS.artiste) : l;
}
function majFiltresListes() {
  for (const [k, d] of Object.entries(FILTRES_LISTE)) {
    const compte = new Map();
    for (const v of etat.vinyles) for (const x of new Set(d.valeurs(v))) compte.set(x, (compte.get(x) || 0) + 1);
    const choix = etat.f[k];
    if (choix && !compte.has(choix)) compte.set(choix, 0);
    const s = $(`filtre-${k}`);
    s.parentElement.hidden = !compte.size;
    s.innerHTML = `<option value="">${d.tous}</option>` +
      [...compte].sort(d.ordre || ((a, b) => comparer(a[0], b[0]))).map(([x, n]) => `<option value="${esc(x)}">${esc(d.nom ? d.nom(x) : x)} (${n})</option>`).join("");
    s.value = choix;
  }
}

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
  return [v.artiste, v.a, v.b, v.note, v.infos?.label, v.infos?.catno].some((c) => norm(c).includes(n));
}

// ——— Rendu ———
// Ventes Discogs sur la pochette : bas · moyen (en gras) · haut.
function prixCarte(p) {
  if (!p?.moyen) return "";
  const titre = `Ventes Discogs — bas ${euros(p.bas || p.moyen)} · moyen ${euros(p.moyen)} · haut ${euros(p.haut || p.moyen)}`;
  const texte = p.bas === p.moyen && p.haut === p.moyen ? `<b>${euros(p.moyen)}</b>`
    : `${court(p.bas)} · <b>${court(p.moyen)}</b> · ${court(p.haut)} €`;
  return `<span class="prix-disque" title="${titre}">${texte}</span>`;
}
function carte(v) {
  // Badge en haut : numéro (ou « Réserve »), en vert si j'ai la pochette.
  // V vert en bas : disque synchronisé avec Discogs (identifiant Discogs connu).
  const vert = v.avecPochette ? " vert" : "";
  const num = v.pos ? `<span class="num${vert}">${v.pos}</span>`
    : v.avecPochette || etat.q ? `<span class="num reserve${vert}">Réserve</span>` : "";
  const coche = v.discogs ? `<span class="coche" title="Synchronisé avec Discogs"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>` : "";
  const img = v.pochette
    ? `<img src="${esc(v.pochette)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'sans'}))">`
    : `<div class="sans"></div>`;
  const selA = v.pos ? JUKEBOX.selectionA(v.pos) : "A";
  const selB = v.pos ? JUKEBOX.selectionB(v.pos) : "B";
  return `<button class="disque${releaseDe(v) ? " discogs" : ""}" data-id="${esc(v.id)}">
    <div class="pochette">${img}${num}${coche}${prixCarte(v.prix)}</div>
    <div class="infos">
      <span class="artiste">${esc(v.artiste)}</span>
      <span class="face"><b>${selA}</b><span>${esc(v.a)}</span></span>
      ${v.b ? `<span class="face"><b>${selB}</b><span>${esc(v.b)}</span></span>` : ""}
      ${v.infos ? `<span class="details">${esc([v.infos.annee, v.infos.label, (v.infos.styles || v.infos.genres || [])[0]].filter(Boolean).join(" · "))}</span>` : ""}
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
  // Valeur de la collection : sommes des prix de vente Discogs (bas, moyen = médiane, haut) de chaque disque.
  const total = etat.vinyles.length;
  const connus = etat.vinyles.filter((v) => v.prix?.moyen);
  const somme = (k) => connus.reduce((s, v) => s + (v.prix[k] || v.prix.moyen), 0);
  $("total").hidden = !connus.length;
  $("total").textContent = connus.length ? `≈ ${euros(somme("moyen"))}` : "";
  const date = etat.prixMaj ? new Date(etat.prixMaj).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
  $("total").title = `Valeur de la collection : somme des prix moyens de vente Discogs${date ? `, mis à jour le ${date}` : ""}`;
  const manque = total - connus.length;
  $("sous-titre").textContent = `${total} disques` +
    (connus.length ? ` · bas ${euros(somme("bas"))} · moyen ${euros(somme("moyen"))} · haut ${euros(somme("haut"))}` : "") +
    (connus.length && manque ? ` · prix connu pour ${connus.length}` : "") +
    (etat.balayage ? ` · comparaison des pochettes… ${etat.balayage}` : "") +
    (etat.majPrix ? ` · mise à jour des prix Discogs… ${etat.majPrix}` :
      etat.edition && manque && !rapport ? ` — pour ${connus.length ? "les autres" : "les prix"} : ⚙︎ › Vérifier la collection` : "");
  document.body.classList.toggle("recherche-active", !!etat.q);
  if (!etat.charge) return;

  let html, vide = "";
  const filtreActif = FILTRES.some((k) => etat.f[k]);
  majFiltresListes();
  for (const s of document.querySelectorAll("[data-filtre]")) s.parentElement.classList.toggle("actif", !!etat.f[s.dataset.filtre]);
  $("filtres-effacer").hidden = !filtreActif;
  if (!etat.q && etat.vue === "jukebox" && !filtreActif) {
    // Vue normale du jukebox : les 80 positions, libres comprises.
    const occ = parPosition();
    html = toutesPositions.map((p) => (occ.has(p) ? carte(occ.get(p)) : carteLibre(p))).join("");
    $("compte-filtre").textContent = "";
  } else {
    // Doublons : cherchés dans tout (jukebox et réserve).
    const source = etat.q ? etat.vinyles.filter((v) => correspond(v, etat.q)) : etat.f.doublon ? etat.vinyles : etat.vue === "jukebox" ? jukebox : reserve;
    const res = filtrer(source);
    html = res.map(carte).join("");
    $("compte-filtre").textContent = filtreActif || etat.q ? `${res.length} disque${res.length > 1 ? "s" : ""}` : "";
    if (!res.length) vide = etat.q ? "Aucun disque ne correspond." : filtreActif ? "Aucun disque avec ce filtre." : "Aucun disque en réserve.";
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
// Titre « de base » : sans majuscules, accents, ponctuation ni ce qui est entre parenthèses.
const base = (s) => norm(s).replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const releaseDe = (v) => v?.discogs || v?.prix?.release || null;
function doublonActuel() {
  const artiste = base($("f-artiste").value), a = base($("f-a").value);
  if (!artiste || !a) return null;
  // Simple modification d'un disque existant (titre et disque Discogs inchangés) : pas d'alerte.
  if (!fiche.nouveau && artiste === fiche.origine.artiste && a === fiche.origine.a && fiche.discogs === fiche.origine.discogs) return null;
  return etat.vinyles.find((v) => v.id !== fiche.id && v.id !== fiche.remplacer &&
    ((fiche.discogs && releaseDe(v) === fiche.discogs) || (base(v.artiste) === artiste && base(v.a) === a))) || null;
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
  const release = fiche?.discogs || fiche?.prix?.release;
  l.hidden = !release;
  if (!release) return;
  l.href = `https://www.discogs.com/release/${release}`;
  const p = fiche.prix || {};
  const prix = [p.bas && `bas ${euros(p.bas)}`, p.moyen && `moyen ${euros(p.moyen)}`, p.haut && `haut ${euros(p.haut)}`].filter(Boolean).join(" · ");
  l.textContent = prix ? `Discogs ↗ · ${prix}` : "Discogs ↗";
}
// ——— Vérifier un disque existant avec Discogs (les titres ne changent que si on le demande) ———
const depuisDiscogs = (rel) => {
  const faces = facesDepuisTracklist(rel.tracklist);
  return { artiste: nettoyerArtiste(rel.artists_sort || (rel.artists || []).map((a) => a.anv || a.name).join(" & ")), a: faces.a || rel.title || "", b: faces.b };
};
// Infos utiles d'une fiche Discogs (même règle que infos_discogs dans App/serveur.py).
const sansNumero = (n) => String(n || "").replace(/\s*\(\d+\)$/, "").replace(/\*$/, "").trim();
function infosDiscogs(rel) {
  const l = (rel.labels || [])[0] || {};
  const f = (rel.formats || [])[0] || {};
  const formats = [...new Set((rel.formats || []).flatMap((x) => [x.name !== "Vinyl" && x.name, ...(x.descriptions || []).filter((d) => !/RPM$/.test(d))]).filter(Boolean))];
  const roles = (motif) => [...new Set((rel.extraartists || []).filter((a) => motif.test(a.role || "")).map((a) => sansNumero(a.name)))].slice(0, 6);
  const r = rel.community?.rating || {};
  const infos = {
    label: sansNumero(l.name), catno: l.catno && l.catno.toLowerCase() !== "none" ? l.catno : "",
    format: [f.name, ...(f.descriptions || [])].filter(Boolean).join(", "), formats,
    pays: rel.country || "", annee: rel.year || null, genres: rel.genres || [], styles: rel.styles || [],
    auteurs: roles(/Written-By|Words By|Lyrics By|Music By|Composed By|Songwriter/i), producteurs: roles(/Producer/i), arrangeurs: roles(/Arranged By/i),
    have: rel.community?.have ?? null, want: rel.community?.want ?? null, note: r.count ? Math.round(r.average * 100) / 100 : null, votes: r.count || null,
  };
  return Object.fromEntries(Object.entries(infos).filter(([, x]) => (Array.isArray(x) ? x.length : x !== "" && x !== null)));
}
function majInfosDiscogs() {
  const i = fiche?.infos;
  const dl = $("infos-discogs");
  dl.hidden = !i;
  if (!i) return (dl.innerHTML = "");
  const lignes = [
    ["Label", [i.label, i.catno].filter(Boolean).join(" – ")],
    ["Format", i.format],
    ["Pays", i.pays],
    ["Année", i.annee],
    ["Genre", (i.genres || []).join(", ")],
    ["Style", (i.styles || []).join(", ")],
    ["Auteurs", (i.auteurs || []).join(", ")],
    ["Production", (i.producteurs || []).join(", ")],
    ["Arrangements", (i.arrangeurs || []).join(", ")],
    ["Discogs", [i.have != null && `${i.have} l'ont`, i.want != null && `${i.want} le veulent`, i.note && `★ ${court(i.note)} (${i.votes})`].filter(Boolean).join(" · ")],
  ].filter(([, x]) => x);
  dl.innerHTML = lignes.map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join("");
}
// Prix Discogs d'un disque, affichés dans le lien en bas de la fiche.
function chargerPrix(release) {
  api(`prix-release?id=${release}`).then((r) => {
    if (Object.keys(r).length && fiche?.discogs === release) {
      fiche.prix = { ...r, release };
      majLienDiscogs();
    }
  }).catch(() => {});
}
async function proposerTitres(release) {
  const ul = $("discogs-resultats");
  try {
    const rel = await discogs(`releases/${release}`);
    if (fiche.discogs !== rel.id) fiche.prix = null; // prix d'un autre disque Discogs
    fiche.discogs = rel.id;
    fiche.infos = infosDiscogs(rel);
    majInfosDiscogs();
    fiche.suggestion = depuisDiscogs(rel);
    const s = fiche.suggestion;
    $("sugg-texte").textContent = `${s.artiste} – ${s.a}${s.b ? " / " + s.b : ""}${rel.year ? ` (${rel.year}${rel.country ? ", " + rel.country : ""})` : ""}`;
    const identique = base(s.artiste) === base($("f-artiste").value) && s.a === $("f-a").value && s.b === $("f-b").value;
    $("sugg-utiliser").hidden = identique;
    if (identique) $("sugg-texte").textContent += " — tes titres sont déjà identiques.";
    $("suggestion").hidden = false;
    $("zone-discogs").hidden = true;
    ul.innerHTML = "";
    majLienDiscogs();
    chargerPrix(rel.id);
    const doublon = doublonActuel();
    if (doublon) afficherDoublon(doublon);
  } catch {
    ul.innerHTML = `<li class="info">Ce disque n'a pas pu être lu sur Discogs.</li>`;
  }
}
function rechercherDepuisFiche() {
  $("suggestion").hidden = true;
  $("zone-discogs").hidden = false;
  $("discogs-q").value = `${$("f-artiste").value} ${$("f-a").value}`.replace(/\(.*?\)/g, "").trim();
  chercherDiscogs();
}
$("btn-verifier").addEventListener("click", () => {
  if (!etat.edition.discogs) return erreurFiche("Ajoute ta clé Discogs dans les réglages (⚙︎).");
  const connu = fiche.discogs || fiche.prix?.release;
  if (connu) proposerTitres(connu); else rechercherDepuisFiche();
});
$("sugg-autre").addEventListener("click", rechercherDepuisFiche);
$("sugg-utiliser").addEventListener("click", () => {
  const s = fiche.suggestion;
  $("f-artiste").value = s.artiste;
  $("f-a").value = s.a;
  $("f-b").value = s.b;
  $("suggestion").hidden = true;
  toast("Titres Discogs repris — pense à Enregistrer");
  const doublon = doublonActuel();
  if (doublon) afficherDoublon(doublon);
});

// ——— Comparer les pochettes avec Discogs (dans la page, sur le Mac) ———
// Empreinte d'une image : 24 × 24 zones moyennées (gris et couleurs), comparées par corrélation.
// Réglé sur la collection : deux pochettes différentes ne dépassent pas 0,70 ; au-dessus de 0,82, c'est la même image.
const SEUIL_POCHETTE = 0.82;
const VARIANTES = [1, 0.94, 0.88].flatMap((sc) => [-0.03, 0, 0.03].flatMap((dx) => [-0.03, 0, 0.03].map((dy) => [sc, dx, dy])));
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
function normaliser(v, canaux) {
  for (let c = 0; c < canaux; c++) {
    let m = 0;
    for (let i = c; i < v.length; i += canaux) m += v[i];
    m /= v.length / canaux;
    for (let i = c; i < v.length; i += canaux) v[i] -= m;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
const produit = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
async function empreintes(blob, variantes) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await chargerImage(url);
    const cote = Math.min(img.naturalWidth, img.naturalHeight);
    const a = Object.assign(document.createElement("canvas"), { width: 300, height: 300 });
    const ca = a.getContext("2d");
    ca.imageSmoothingQuality = "high";
    ca.drawImage(img, (img.naturalWidth - cote) / 2, (img.naturalHeight - cote) / 2, cote, cote, 0, 0, 300, 300);
    const b = Object.assign(document.createElement("canvas"), { width: 240, height: 240 });
    const cb = b.getContext("2d", { willReadFrequently: true });
    cb.imageSmoothingQuality = "high";
    return variantes.map(([sc, dx, dy]) => {
      const s = Math.round(300 * sc), x = Math.round((300 - s) / 2 + dx * 300), y = Math.round((300 - s) / 2 + dy * 300);
      cb.drawImage(a, x, y, s, s, 0, 0, 240, 240);
      const d = cb.getImageData(0, 0, 240, 240).data;
      const rgb = new Float64Array(576 * 3);
      for (let py = 0; py < 240; py++) {
        for (let px = 0; px < 240; px++) {
          const i = (py * 240 + px) * 4, k = (Math.floor(py / 10) * 24 + Math.floor(px / 10)) * 3;
          rgb[k] += d[i]; rgb[k + 1] += d[i + 1]; rgb[k + 2] += d[i + 2];
        }
      }
      const gris = new Float64Array(576).map((_, k) => rgb[3 * k] + rgb[3 * k + 1] + rgb[3 * k + 2]);
      return [normaliser(gris, 1), normaliser(rgb, 3)];
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
const ressemblance = ([[g0, c0]], autres) => Math.max(...autres.map(([g, c]) => 0.5 * produit(g0, g) + 0.5 * produit(c0, c)));

let correspondances = [];
async function discogsPatient(chemin, params) {
  try {
    return await discogs(chemin, params);
  } catch (e) {
    if (e.status !== 429) throw e;
    await pause(61000);
    return discogs(chemin, params);
  } finally {
    await pause(1100); // Discogs : 60 demandes par minute
  }
}
async function comparerPochettes() {
  const disques = etat.vinyles.filter((v) => v.pochette?.startsWith("covers/"));
  correspondances = [];
  $("btn-pochettes").disabled = true;
  for (const [i, v] of disques.entries()) {
    etat.balayage = `${i + 1}/${disques.length}`;
    $("btn-pochettes").textContent = `Comparaison… ${etat.balayage}`;
    rendre();
    try {
      const moi = await empreintes(await (await fetch(v.pochette)).blob(), [[1, 0, 0]]);
      const titre = v.a.replace(/\(.*?\)/g, "").trim();
      let r = await discogsPatient("database/search", { artist: v.artiste, track: titre, type: "release", per_page: "12" });
      if (!r.results?.length) r = await discogsPatient("database/search", { q: `${v.artiste} ${titre}`, type: "release", per_page: "12" });
      const est45 = (x) => /7"|45 RPM/.test((x.format || []).join(" "));
      const candidats = (r.results || []).filter((x) => x.cover_image && !x.cover_image.includes("spacer")).sort((x, y) => est45(y) - est45(x)).slice(0, 6);
      let meilleur = null;
      for (const c of candidats) {
        try {
          const image = await api(`image?url=${encodeURIComponent(c.cover_image)}`);
          const score = ressemblance(moi, await empreintes(image, VARIANTES));
          if (!meilleur || score > meilleur.score) meilleur = { score, release: c.id, image };
        } catch {}
      }
      if (meilleur && meilleur.score >= SEUIL_POCHETTE) {
        const rel = await discogsPatient(`releases/${meilleur.release}`);
        correspondances.push({ id: v.id, score: meilleur.score, release: rel.id, image: meilleur.image, ...depuisDiscogs(rel), annee: rel.year, pays: rel.country });
      }
    } catch {}
  }
  etat.balayage = "";
  rendre();
  $("btn-pochettes").disabled = false;
  $("btn-pochettes").textContent = "Comparer les pochettes";
  if (!correspondances.length) return toast("Aucune pochette identique trouvée sur Discogs");
  fermer("reglages");
  rendreCorrespondances();
  ouvrir("corresp");
}
function rendreCorrespondances() {
  $("corresp-resume").textContent = correspondances.length
    ? `${correspondances.length} disque${correspondances.length > 1 ? "s" : ""} dont la pochette est identique à celle d'une fiche Discogs. Appliquer remplace la pochette, les titres et l'identifiant Discogs.`
    : "Tout est appliqué.";
  $("corresp-liste").innerHTML = correspondances.map((c) => {
    const v = etat.vinyles.find((x) => x.id === c.id);
    c.apercu ||= URL.createObjectURL(c.image);
    const change = v.artiste !== c.artiste || v.a !== c.a || (v.b || "") !== c.b;
    return `<li><label class="corresp"><input type="checkbox" data-id="${esc(c.id)}" checked>
      <img src="${esc(v.pochette)}" alt="Ta pochette"><img src="${c.apercu}" alt="Pochette Discogs">
      <div><strong>${esc(c.artiste)} – ${esc(c.a)}${c.b ? " / " + esc(c.b) : ""}</strong>
      ${change ? `<span class="ancien">${esc(v.artiste)} – ${esc(titresDisque(v))}</span>` : ""}
      <small>Identique à ${Math.round(c.score * 100)} % · ${esc(v.pos ? "position " + v.pos : "réserve")}${c.annee ? ` · ${c.annee}` : ""}${c.pays ? `, ${esc(c.pays)}` : ""} · <a href="https://www.discogs.com/release/${c.release}" target="_blank" rel="noopener">voir ↗</a></small></div>
    </label></li>`;
  }).join("");
  $("corresp-appliquer").disabled = !correspondances.length;
}
$("btn-pochettes").addEventListener("click", () => {
  if (!etat.edition.discogs) return ($("r-pochettes").textContent = "Ajoute d'abord ta clé Discogs.");
  comparerPochettes();
});
$("corresp-tout").addEventListener("change", (e) => {
  for (const c of $("corresp-liste").querySelectorAll("input[type=checkbox]")) c.checked = e.target.checked;
});
$("corresp-appliquer").addEventListener("click", async () => {
  const ids = [...$("corresp-liste").querySelectorAll("input:checked")].map((c) => c.dataset.id);
  if (!ids.length) return;
  const b = $("corresp-appliquer");
  b.disabled = true;
  try {
    const nouvelles = new Map();
    for (const c of correspondances.filter((x) => ids.includes(x.id))) {
      const image = await pochetteCarree(c.image);
      const { chemin } = await api(`pochette?nom=${c.id}-${Date.now().toString(36)}.webp`, { method: "POST", body: image });
      nouvelles.set(c.id, { ...c, chemin });
    }
    const anciennes = [];
    await enregistrerCollection(etat.vinyles.map((v) => {
      const c = nouvelles.get(v.id);
      if (!c) return v;
      anciennes.push(v.pochette);
      return { ...v, artiste: c.artiste, a: c.a, b: c.b, discogs: c.release, pochette: c.chemin };
    }));
    anciennes.forEach(retirerPochette);
    correspondances = correspondances.filter((c) => !nouvelles.has(c.id));
    rendre();
    rendreCorrespondances();
    toast(`${nouvelles.size} disque${nouvelles.size > 1 ? "s" : ""} mis à jour`);
  } catch (err) {
    toast(err.message);
  } finally {
    b.disabled = false;
  }
});

function erreurFiche(msg) {
  $("fiche-erreur").textContent = msg;
  $("fiche-erreur").hidden = false;
}

function ouvrirFiche(v, posLibre) {
  fiche = { id: v?.id || uid(), nouveau: !v, pochette: v?.pochette || "", blob: null, discogs: v?.discogs || null,
    origine: { artiste: base(v?.artiste), a: base(v?.a), discogs: v?.discogs || null }, prix: v?.prix || null, infos: v?.infos || null, suggestion: null };
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
  majInfosDiscogs();
  $("zone-discogs").hidden = !!v;
  $("discogs-q").value = "";
  $("discogs-resultats").innerHTML = "";
  $("fiche-erreur").hidden = true;
  $("doublon").hidden = $("doublon-choix").hidden = true;
  $("suggestion").hidden = true;
  $("btn-verifier").hidden = !v;
  $("btn-enregistrer").disabled = false;
  $("btn-enregistrer").textContent = "Enregistrer";
  ouvrir("fiche");
  if (!v) setTimeout(() => $("discogs-q").focus(), 50);
}

$("grille").addEventListener("click", (e) => {
  const b = e.target.closest(".disque");
  if (!b) return;
  if (!etat.edition) {
    // En ligne : toucher un disque ouvre sa page Discogs.
    const release = releaseDe(etat.vinyles.find((x) => x.id === b.dataset.id));
    if (release) window.open(`https://www.discogs.com/release/${release}`, "_blank", "noopener");
    return;
  }
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
  if (!fiche.nouveau) return proposerTitres(b.dataset.release);
  try {
    const rel = await discogs(`releases/${b.dataset.release}`);
    const t = depuisDiscogs(rel);
    $("f-artiste").value = t.artiste;
    $("f-a").value = t.a;
    $("f-b").value = t.b;
    $("fiche-titre").textContent = t.artiste || "Nouveau disque";
    fiche.discogs = rel.id;
    fiche.infos = infosDiscogs(rel);
    majInfosDiscogs();
    fiche.prix = null;
    majLienDiscogs();
    chargerPrix(rel.id);
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
  majPublier();
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
      const nom = `${fiche.id}-${Date.now().toString(36)}.webp`;
      pochette = (await api(`pochette?nom=${nom}`, { method: "POST", body: fiche.blob })).chemin;
    }
    const pos = $("f-pos").value || null;
    const note = $("f-note").value.trim();
    const disque = { id: fiche.id, artiste, a, b: $("f-b").value.trim(), pos };
    if (pochette) disque.pochette = pochette;
    if (note) disque.note = note;
    if ($("f-avec-pochette").checked) disque.avecPochette = true;
    if (fiche.discogs) disque.discogs = fiche.discogs;
    if (fiche.prix) disque.prix = fiche.prix;
    if (fiche.discogs && fiche.infos) disque.infos = fiche.infos;
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
// Le bouton n'est actif que s'il y a des changements à mettre en ligne.
let verifPublier;
function majPublier() {
  clearTimeout(verifPublier);
  verifPublier = setTimeout(async () => {
    const b = $("btn-publier");
    if (b.textContent.startsWith("Publication")) return;
    try {
      const { n } = await api("changements");
      const aJour = n === 0;
      b.disabled = aJour;
      b.classList.toggle("a-jour", aJour);
      b.title = aJour ? "Rien de nouveau à publier" : n ? `${n} fichier${n > 1 ? "s" : ""} à mettre en ligne` : "";
    } catch {}
  }, 400);
}
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
    majPublier();
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
  api("verification").then((p) => { afficherVerif(p); if (p.en_cours) suivreVerif(!p.auto); }).catch(() => {});
}
$("btn-reglages").addEventListener("click", () => ouvrirReglages());

// ——— Vérification de toute la collection avec Discogs (tourne sur le Mac, ~3 s par disque) ———
let suiviVerif, rapport = null;
function afficherVerif(p) {
  const b = $("btn-verifier-tout");
  b.disabled = p.en_cours;
  rapport = p.rapport || rapport;
  $("btn-voir-verif").hidden = p.en_cours || !rapport;
  if (p.en_cours) {
    const reste = Math.max(1, Math.round(((p.total - p.fait) * 3.5) / 60));
    b.textContent = p.total ? `Vérification… ${p.fait}/${p.total}` : "Vérification…";
    $("r-verif").textContent = `Environ ${reste} min restantes. Tu peux fermer cette fenêtre et continuer.`;
  } else {
    b.textContent = "Vérifier la collection";
    if (rapport) $("r-verif").textContent = `Dernière vérification : ${rapport.date}.`;
  }
}
function suivreVerif(ouvrirALaFin = true) {
  clearInterval(suiviVerif);
  suiviVerif = setInterval(async () => {
    try {
      const p = await api("verification");
      afficherVerif(p);
      etat.majPrix = p.en_cours && p.total ? `${p.fait}/${p.total}` : "";
      rendre();
      if (!p.en_cours) {
        clearInterval(suiviVerif);
        await charger();
        majPublier();
        if (ouvrirALaFin) {
          toast("Vérification terminée");
          fermer("reglages");
          ouvrirVerif();
        } else {
          toast("Prix Discogs mis à jour");
        }
      }
    } catch { clearInterval(suiviVerif); }
  }, ouvrirALaFin ? 1500 : 4000);
}
$("btn-verifier-tout").addEventListener("click", async () => {
  try {
    afficherVerif(await api("verifier", { method: "POST" }));
    suivreVerif(true);
  } catch (err) {
    $("r-verif").textContent = err.message;
  }
});
$("btn-voir-verif").addEventListener("click", () => { fermer("reglages"); ouvrirVerif(); });

const titresDisque = (v) => `${v.a}${v.b ? " / " + v.b : ""}`;
function differences() {
  if (!rapport) return [];
  return rapport.suggestions.filter((s) => {
    if (rapport.ignores.includes(s.id)) return false;
    const v = etat.vinyles.find((x) => x.id === s.id);
    return v && (v.artiste !== s.artiste || v.a !== s.a || (v.b || "") !== s.b);
  });
}
function rendreVerif() {
  const diffs = differences();
  const groupes = new Map();
  for (const v of etat.vinyles) {
    const cle = releaseDe(v) ? `r${releaseDe(v)}` : `t${base(v.artiste)}|${base(v.a)}`;
    const autre = `t${base(v.artiste)}|${base(v.a)}`;
    for (const k of new Set([cle, autre])) groupes.set(k, [...(groupes.get(k) || []), v]);
  }
  const vus = new Set();
  const doublons = [...groupes.values()].filter((g) => g.length > 1).filter((g) => {
    const k = g.map((v) => v.id).sort().join();
    return !vus.has(k) && vus.add(k);
  });
  const introuvables = (rapport?.introuvables || []).map((id) => etat.vinyles.find((v) => v.id === id)).filter(Boolean);
  const ou = (v) => (v.pos ? `position ${v.pos}` : "réserve");

  $("verif-resume").textContent = `${etat.vinyles.length} disques · ${diffs.length} titre${diffs.length > 1 ? "s" : ""} à vérifier · ${doublons.length} doublon${doublons.length > 1 ? "s" : ""} · ${introuvables.length} non trouvé${introuvables.length > 1 ? "s" : ""}.`;
  $("verif-bloc-titres").hidden = !diffs.length;
  $("verif-titres").innerHTML = diffs.map((s) => {
    const v = etat.vinyles.find((x) => x.id === s.id);
    return `<li><div><strong>${esc(v.artiste)}${v.artiste !== s.artiste ? ` → ${esc(s.artiste)}` : ""}</strong>
      <span class="ancien">${esc(titresDisque(v))}</span><span class="nouveau">${esc(titresDisque(s))}</span>
      <small>${esc(ou(v))}${s.annee ? ` · Discogs : ${s.annee}` : ""}${s.pays ? `, ${esc(s.pays)}` : ""} · <a href="https://www.discogs.com/release/${s.release}" target="_blank" rel="noopener">voir ↗</a></small></div>
      <div class="choix"><button type="button" class="secondaire" data-maj="${esc(s.id)}">Mettre à jour</button><button type="button" class="texte" data-ignorer="${esc(s.id)}">Ignorer</button></div></li>`;
  }).join("");
  $("verif-bloc-doublons").hidden = !doublons.length;
  $("verif-doublons").innerHTML = doublons.map((g) => `<li><div><strong>${esc(g[0].artiste)} – ${esc(g[0].a)}</strong>
      <small>${g.map((v) => esc(ou(v))).join(" et ")}</small></div>
      <div class="choix">${g.map((v) => `<button type="button" class="secondaire" data-ouvrir="${esc(v.id)}">Ouvrir (${esc(v.pos || "réserve")})</button>`).join("")}</div></li>`).join("");
  $("verif-bloc-introuvables").hidden = !introuvables.length;
  $("verif-introuvables").innerHTML = introuvables.map((v) => `<li><div><strong>${esc(v.artiste)}</strong><small>${esc(titresDisque(v))} · ${esc(ou(v))}</small></div>
      <div class="choix"><button type="button" class="secondaire" data-ouvrir="${esc(v.id)}">Ouvrir</button></div></li>`).join("");
}
async function ouvrirVerif() {
  try { rapport = (await api("verification")).rapport || rapport; } catch {}
  if (!rapport) return toast("Lance d'abord « Vérifier la collection » dans les réglages.");
  rendreVerif();
  ouvrir("verif");
}
async function appliquer(ids) {
  const parId = new Map(rapport.suggestions.map((s) => [s.id, s]));
  const liste = etat.vinyles.map((v) => {
    const s = ids.includes(v.id) && parId.get(v.id);
    return s ? { ...v, artiste: s.artiste, a: s.a, b: s.b, discogs: s.release } : v;
  });
  await enregistrerCollection(liste);
  rendre();
  rendreVerif();
}
$("verif").addEventListener("click", async (e) => {
  const maj = e.target.closest("[data-maj]"), ign = e.target.closest("[data-ignorer]"), ouv = e.target.closest("[data-ouvrir]");
  try {
    if (maj) { await appliquer([maj.dataset.maj]); toast("Titres mis à jour"); }
    if (ign) {
      await posterJson("ignorer", { id: ign.dataset.ignorer });
      rapport.ignores.push(ign.dataset.ignorer);
      rendreVerif();
    }
    if (ouv) {
      fermer("verif");
      ouvrirFiche(etat.vinyles.find((v) => v.id === ouv.dataset.ouvrir));
    }
  } catch (err) { toast(err.message); }
});
$("verif-tout").addEventListener("click", async () => {
  const ids = differences().map((s) => s.id);
  try { await appliquer(ids); toast(`${ids.length} disques mis à jour`); } catch (err) { toast(err.message); }
});
$("form-reglages").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("r-statut").textContent = "Vérification…";
  try {
    const r = await posterJson("reglages", { github: $("r-github").value, discogs: $("r-discogs").value });
    Object.assign(etat.edition, r);
    majPublier();
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
    const donnees = await r.json();
    etat.vinyles = trier(donnees.vinyles || []);
    etat.prixMaj = donnees.prixMaj || "";
    etat.charge = true;
    rendre();
  } catch {
    $("etat").textContent = location.protocol === "file:"
      ? "Ouvre le jukebox avec « Ouvrir le jukebox » dans le dossier App."
      : "Impossible de charger la collection. Vérifie ta connexion.";
  }
}

for (const s of document.querySelectorAll("[data-filtre]")) {
  s.value = etat.f[s.dataset.filtre];
  s.addEventListener("change", () => {
    etat.f[s.dataset.filtre] = s.value;
    lsSet(`jb.${s.dataset.filtre}`, s.value);
    rendre();
  });
}
$("filtres-effacer").addEventListener("click", () => {
  for (const s of document.querySelectorAll("[data-filtre]")) {
    etat.f[s.dataset.filtre] = s.value = "";
    lsSet(`jb.${s.dataset.filtre}`, "");
  }
  rendre();
});
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
  if (etat.edition) {
    majPublier();
    api("verification").then((p) => { rapport = p.rapport || null; rendre(); }).catch(() => {});
    // Mise à jour automatique des prix (lancée par le Mac une fois par jour) : on suit sa progression.
    setTimeout(() => api("verification").then((p) => { if (p.en_cours) suivreVerif(!p.auto); }).catch(() => {}), 4000);
    // En revenant sur la page (après une modification ailleurs), on revérifie.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") majPublier(); });
  } else {
    // En ligne : on recharge en revenant sur l'appli, pour voir la dernière publication.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") charger(); });
  }
})();
