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
const FILTRES = ["emplacement", "tri", "inventaire", "doublon", "pochette", "discogs"];
const etat = { vinyles: [], vue: "jukebox", q: "", charge: false, edition: null, f: Object.fromEntries(FILTRES.map((k) => [k, lsGet(`jb.${k}`)])) };

let modeInventaire = false;
let inventaireCharge = false;
const presentsInventaire = new Set();
const pointagesEnCours = new Set();

function rendreInventaire() {
  $("barre-inventaire").hidden = !modeInventaire;
  $("btn-inventaire").setAttribute("aria-pressed", String(modeInventaire));
  $("reste-inventaire").checked = etat.f.inventaire === "a-verifier";
  $("filtre-inventaire").disabled = !inventaireCharge;
  $("tris-inventaire").hidden = $("tris-inventaire").disabled = !inventaireCharge;
  const presents = etat.vinyles.filter((v) => presentsInventaire.has(v.id)).length;
  $("compte-inventaire").textContent = `${presents} / ${etat.vinyles.length} pointés · ${etat.vinyles.length - presents} à vérifier`;
}

const comparer = (a, b) => String(a || "").localeCompare(String(b || ""), "fr", { sensitivity: "base" });
const parArtiste = (x, y) => comparer(x.artiste, y.artiste) || comparer(x.a, y.a);
const estPointe = (v) => presentsInventaire.has(v.id);
function comparerNombre(x, y, sens) {
  const connuX = Number.isFinite(x), connuY = Number.isFinite(y);
  if (connuX && connuY) return (x - y) * sens;
  return Number(connuY) - Number(connuX);
}
const TRIS = new Map([
  ["artiste-az", parArtiste],
  ["artiste-za", (x, y) => comparer(y.artiste, x.artiste) || comparer(x.a, y.a)],
  ["titre-az", (x, y) => comparer(x.a, y.a) || parArtiste(x, y)],
  ["titre-za", (x, y) => comparer(y.a, x.a) || parArtiste(x, y)],
  ["prix-croissant", (x, y) => comparerNombre(x.prix?.moyen, y.prix?.moyen, 1) || parArtiste(x, y)],
  ["prix-decroissant", (x, y) => comparerNombre(x.prix?.moyen, y.prix?.moyen, -1) || parArtiste(x, y)],
  ["annee-croissante", (x, y) => comparerNombre(x.infos?.annee, y.infos?.annee, 1) || parArtiste(x, y)],
  ["annee-decroissante", (x, y) => comparerNombre(x.infos?.annee, y.infos?.annee, -1) || parArtiste(x, y)],
  ["inventaire-pointes", (x, y) => Number(estPointe(y)) - Number(estPointe(x))],
  ["inventaire-a-verifier", (x, y) => Number(estPointe(x)) - Number(estPointe(y))],
]);
const triParInventaire = () => etat.f.tri.startsWith("inventaire-");
function filtreActif(cle) {
  if (cle === "discogs" && !etat.edition) return false;
  if ((cle === "inventaire" || (cle === "tri" && triParInventaire())) && !inventaireCharge) return false;
  return !!etat.f[cle];
}

// Les deux critères restent valables même si les éditions Discogs diffèrent.
function groupesDoublons(liste) {
  const groupes = new Map();
  for (const v of liste) {
    const release = releaseDe(v);
    const artiste = base(v.artiste), faceA = base(v.a), faceB = base(v.b);
    const cles = [];
    if (release) cles.push(`r:${release}`);
    if (artiste && faceA) cles.push(`t:${artiste}|${[faceA, faceB].sort().join("|")}`);
    for (const cle of cles) {
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(v);
    }
  }

  const dejaVus = new Set();
  return [...groupes.values()].filter((groupe) => {
    if (groupe.length < 2) return false;
    const cle = JSON.stringify(groupe.map((v) => v.id).sort());
    if (dejaVus.has(cle)) return false;
    dejaVus.add(cle);
    return true;
  });
}
function filtrer(liste) {
  const f = etat.f;
  const dbl = f.doublon ? new Set(groupesDoublons(etat.vinyles).flatMap((groupe) => groupe.map((v) => v.id))) : null;
  const l = liste.filter((v) => {
    if (dbl && !dbl.has(v.id)) return false;
    if (f.pochette && !!v.avecPochette !== (f.pochette === "avec")) return false;
    if (etat.edition && f.discogs && !!v.discogs !== (f.discogs === "oui")) return false;
    if (filtreActif("inventaire") && estPointe(v) !== (f.inventaire === "pointes")) return false;
    return true;
  });
  const ordre = (filtreActif("tri") && TRIS.get(f.tri)) || (dbl && parArtiste);
  return ordre ? l.sort(ordre) : l;
}

function trier(liste) {
  return liste.sort((x, y) => {
    if (x.pos && y.pos) return x.pos.localeCompare(y.pos);
    if (x.pos) return -1;
    if (y.pos) return 1;
    return comparer(x.artiste, y.artiste);
  });
}
const parPosition = () => new Map(etat.vinyles.filter((v) => v.pos).map((v) => [v.pos, v]));

// ——— Recherche dans la collection ———
function texteRecherche(texte) {
  return norm(texte).replace(/œ/g, "oe").replace(/æ/g, "ae")
    .replace(/\b(33|45|78)\s*tours?\b/g, "$1 rpm")
    .replace(/\b(7|10|12)\s*["″]/g, "$1 pouces ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function texteDisque(v) {
  const i = v.infos || {};
  return texteRecherche([
    v.artiste, v.a, v.b, v.note, v.titresDiscogs?.artiste, v.titresDiscogs?.a, v.titresDiscogs?.b,
    i.label, i.catno, i.pays, ...(i.genres || []), ...(i.styles || []),
  ].join(" "));
}

function correspondNumero(v, numero) {
  return !!v.pos && (v.pos === pad(numero) || JUKEBOX.selectionA(v.pos) === numero || JUKEBOX.selectionB(v.pos) === numero);
}

function correspondDate(v, valeur, decennie) {
  const annee = Number(v.infos?.annee);
  if (!annee) return false;
  const date = decennie ? Math.floor(annee / 10) * 10 : annee;
  return (valeur.length === 2 ? date % 100 : date) === Number(valeur);
}

function dateImplicite(mot) {
  if (/^\d0$/.test(mot)) return true;
  if (/^(?:18|19|20)\d{2}$/.test(mot) || /^\d{2}$/.test(mot)) return false;
  return null;
}

function classerNumero(v, numero) {
  if (correspondNumero(v, numero)) return "numero";
  const decennie = dateImplicite(numero);
  if (decennie !== null && correspondDate(v, numero, decennie)) return "date";
  if (texteDisque(v).includes(numero)) return "autre";
  return "";
}

function rechercheCollection(q) {
  const conditions = [];
  const reste = norm(q)
    .replace(/^(?:genre|style|pays|label|format)(?:\s*:\s*|\s+)(?=\S)/, "")
    .replace(/\b(annees?)\s*:?\s*['’]?(\d{4}|\d{2})\b|\b(\d{2})['’]?s\b/g, (_, mot, date, dateCourte) => {
      conditions.push((v) => correspondDate(v, date || dateCourte, mot !== "annee"));
      return " ";
    })
    .replace(/\b(?:prix (?:inconnu|non renseigne)|sans prix)\b/g, () => {
      conditions.push((v) => !v.prix?.moyen);
      return " ";
    })
    .replace(/(?:(moins de|plus de)\s+)?\b(\d+(?:[.,]\d{1,2})?)(?:\s+(?:a|et)\s+(\d+(?:[.,]\d{1,2})?))?\s*(?:€|euros?\b)/g, (_, comparaison, montant, plafond) => {
      const bas = Number(montant.replace(",", "."));
      const haut = plafond ? Number(plafond.replace(",", ".")) : bas;
      conditions.push((v) => {
        const prix = v.prix?.moyen;
        if (!prix) return false;
        if (comparaison === "moins de") return prix < bas;
        if (comparaison === "plus de") return prix > bas;
        return prix >= bas && prix <= haut;
      });
      return " ";
    });
  const mots = texteRecherche(reste).split(" ").filter(Boolean);
  return (v) => {
    if (!conditions.every((condition) => condition(v))) return false;
    if (!mots.length) return conditions.length > 0;
    const texte = texteDisque(v);
    return mots.every((mot) => {
      const decennie = dateImplicite(mot);
      return texte.includes(mot) || (/^\d{1,3}$/.test(mot) && correspondNumero(v, mot))
        || (decennie !== null && correspondDate(v, mot, decennie));
    });
  };
}

// ——— Rendu ———
// Ventes Discogs sur la pochette : bas · moyen (en gras) · haut.
function prixCarte(p) {
  if (!p?.moyen) return "";
  const titre = `${p.source === "conseil" ? "Prix conseillés Discogs (VG · VG+ · NM)" : "Ventes Discogs"} — bas ${euros(p.bas || p.moyen)} · moyen ${euros(p.moyen)} · haut ${euros(p.haut || p.moyen)}`;
  const texte = p.bas === p.moyen && p.haut === p.moyen ? `<b>${euros(p.moyen)}</b>`
    : `${court(p.bas)} · <b>${court(p.moyen)}</b> · ${court(p.haut)} €`;
  return `<span class="prix-disque" title="${titre}">${texte}</span>`;
}
function pastilleDiscogs(synchronise) {
  const libelle = synchronise ? "Synchronisé avec Discogs" : "Non synchronisé avec Discogs";
  const dessin = synchronise
    ? '<path d="M10 13a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-2 2m2 5a3.5 3.5 0 0 0-5 0l-4 4a3.5 3.5 0 0 0 5 5l2-2"/>'
    : '<path d="M14 6l2-2a3 3 0 0 1 4 4l-2 2M10 18l-2 2a3 3 0 0 1-4-4l2-2M4 4l16 16"/>';
  return `<span class="pastille-discogs${synchronise ? " actif" : ""}" role="img" aria-label="${libelle}" title="${libelle}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${dessin}</svg>
  </span>`;
}
const symboleVinyle = `<span class="vinyle-seul" aria-hidden="true">
  <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13"/><path d="M7 16a9 9 0 0 1 9-9m0 18a9 9 0 0 0 9-9"/><circle cx="16" cy="16" r="4"/><path d="M16 16h.01"/></svg>
</span>`;
function statutsDisque(v, present) {
  const pointage = inventaireCharge ? `<span class="statut-disque pointage${present ? " actif" : ""}">${present ? "✓ Pointé" : "À vérifier"}</span>` : "";
  const pochette = `<span class="statut-disque etat-pochette${v.avecPochette ? "" : " absente"}">${v.avecPochette ? "Avec pochette" : "Sans pochette"}</span>`;
  return `<span class="statuts-disque">${pointage}${pochette}</span>`;
}
function carte(v) {
  const num = v.pos ? `<span class="num">${v.pos}</span>` : '<span class="num reserve">Réserve</span>';
  const present = estPointe(v);
  const img = v.pochette
    ? `<img src="${esc(v.pochette)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'sans'}))">`
    : `<div class="sans"></div>`;
  const selA = v.pos ? JUKEBOX.selectionA(v.pos) : "A";
  const selB = v.pos ? JUKEBOX.selectionB(v.pos) : "B";
  return `<button class="disque" data-id="${esc(v.id)}" ${modeInventaire ? `aria-pressed="${present}"` : 'aria-haspopup="dialog"'}>
    <div class="pochette${v.avecPochette ? "" : " sans-pochette-physique"}">
      ${img}${num}${pastilleDiscogs(v.discogs)}${prixCarte(v.prix)}${v.avecPochette ? "" : symboleVinyle}
    </div>
    ${statutsDisque(v, present)}
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

function resultatsNumeriques(liste, numero) {
  const groupes = { numero: [], date: [], autre: [] };
  for (const v of liste) {
    const groupe = classerNumero(v, numero);
    if (groupe) groupes[groupe].push(v);
  }
  const titres = {
    numero: `Numéro ${numero.length < 3 ? pad(numero) : numero}`,
    date: `${dateImplicite(numero) ? "Années" : "Année"} ${numero}`,
    autre: "Autres correspondances",
  };
  const html = Object.entries(groupes).map(([groupe, disques]) => disques.length ? `
    <section class="groupe-resultats">
      <h2>${titres[groupe]}</h2>
      <div class="grille">${disques.map(carte).join("")}</div>
    </section>` : "").join("");
  return { html, total: groupes.numero.length + groupes.date.length + groupes.autre.length };
}

function rendre() {
  const jukebox = etat.vinyles.filter((v) => v.pos);
  const reserve = etat.vinyles.filter((v) => !v.pos);
  $("nb-jukebox").textContent = `${jukebox.length}`;
  $("nb-reserve").textContent = `${reserve.length}`;
  const total = etat.vinyles.length;
  const connus = etat.vinyles.filter((v) => v.prix?.moyen);
  const valeur = etat.valeurDiscogs;
  const somme = (k) => connus.reduce((s, v) => s + (v.prix[k] || v.prix.moyen), 0)
    .toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  $("total").hidden = !valeur && !connus.length;
  $("total").textContent = valeur ? valeur.median : connus.length ? `≈ ${somme("moyen")}` : "";
  const date = valeur?.date ? new Date(valeur.date * 1000).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) : "";
  $("total").title = valeur
    ? `Estimation de toute ta collection Discogs${date ? ` · relevée le ${date}` : ""}`
    : "Somme des prix connus dans Selection101";
  const estimation = valeur
    ? ` · Estimation Discogs · Faible ${valeur.bas} · Médiane ${valeur.median} · Élevée ${valeur.haut}`
    : connus.length ? ` · Prix connus dans Selection101 (${connus.length}/${total}) · Bas ${somme("bas")} · Moyen ${somme("moyen")} · Haut ${somme("haut")}` : "";
  $("sous-titre").textContent = `${total} disques` +
    estimation +
    (etat.balayage ? ` · comparaison des pochettes… ${etat.balayage}` : "");
  document.body.classList.toggle("recherche-active", !!etat.q);
  if (!etat.charge) return;
  $("btn-stats").disabled = false;
  rendreInventaire();

  const emplacement = etat.f.emplacement;
  const onglet = emplacement || etat.vue;
  $("onglets-emplacement").hidden = emplacement === "tous";
  for (const [id, vue] of [["tab-jukebox", "jukebox"], ["tab-reserve", "reserve"]]) {
    $(id).classList.toggle("actif", vue === onglet);
    $(id).setAttribute("aria-selected", String(vue === onglet));
  }

  let html, vide = "";
  const filtresActifs = FILTRES.some(filtreActif);
  for (const s of document.querySelectorAll("[data-filtre]")) {
    const cle = s.dataset.filtre;
    s.value = filtreActif(cle) ? etat.f[cle] : "";
    s.parentElement.classList.toggle("actif", filtreActif(cle));
  }
  $("filtres-effacer").hidden = !filtresActifs;
  if (!etat.q && etat.vue === "jukebox" && !filtresActifs && !modeInventaire) {
    // Vue normale du jukebox : les 80 positions, libres comprises.
    const occ = parPosition();
    html = toutesPositions.map((p) => (occ.has(p) ? carte(occ.get(p)) : carteLibre(p))).join("");
    $("compte-filtre").textContent = "";
  } else {
    // En mode Auto, recherche et doublons couvrent toute la collection.
    const perimetre = emplacement || (etat.q || etat.f.doublon ? "tous" : etat.vue);
    const source = perimetre === "jukebox" ? jukebox : perimetre === "reserve" ? reserve : etat.vinyles;
    const liste = filtrer(source);
    let nombre;
    if (/^\d{1,4}$/.test(etat.q)) {
      const groupes = resultatsNumeriques(liste, etat.q);
      html = groupes.html;
      nombre = groupes.total;
    } else {
      const res = etat.q ? liste.filter(rechercheCollection(etat.q)) : liste;
      html = res.map(carte).join("");
      nombre = res.length;
    }
    $("compte-filtre").textContent = filtresActifs || etat.q ? `${nombre} disque${nombre > 1 ? "s" : ""}` : "";
    if (!nombre) vide = etat.q ? "Aucun disque ne correspond." : filtresActifs ? "Aucun disque avec ce filtre." : "Aucun disque en réserve.";
  }
  $("etat").textContent = vide;
  $("grille").innerHTML = html;
}

function changerVue(vue) {
  etat.vue = vue;
  if (etat.f.emplacement) changerFiltre("emplacement", vue);
  else rendre();
  window.scrollTo({ top: 0 });
}

// ——— Statistiques de la collection ———
function secondesPiste(duree) {
  if (!/^\d+(?::[0-5]\d){1,2}$/.test(duree || "")) return 0;
  return duree.split(":").reduce((total, partie) => total * 60 + Number(partie), 0);
}

function formatEcoute(secondes) {
  const heures = Math.floor(secondes / 3600);
  const minutes = Math.floor(secondes / 60) % 60;
  const reste = secondes % 60;
  return [heures && `${heures} h`, minutes && `${minutes} min`, reste && `${reste} s`].filter(Boolean).join(" ");
}

function rendreStats() {
  const perimetre = $("stats-perimetre").value;
  const disques = etat.vinyles.filter((v) => perimetre === "tous" || Boolean(v.pos) === (perimetre === "jukebox"));
  let ecoute = 0, dureesConnues = 0;
  let plusLongue = null, doyens = [];
  const artistes = new Map();
  for (const v of disques) {
    const artiste = v.artiste?.trim();
    if (artiste) {
      const nom = norm(artiste);
      const entree = artistes.get(nom) || { artiste, nombre: 0 };
      entree.nombre++;
      artistes.set(nom, entree);
    }
    const annee = Number(v.infos?.annee);
    if (Number.isInteger(annee) && annee > 0) {
      if (!doyens.length || annee < Number(doyens[0].infos.annee)) doyens = [v];
      else if (annee === Number(doyens[0].infos.annee)) doyens.push(v);
    }
    for (const piste of v.infos?.pistes || []) {
      const duree = secondesPiste(piste.duree);
      if (!duree) continue;
      dureesConnues++;
      ecoute += duree;
      if (!plusLongue || duree > plusLongue.duree) plusLongue = { piste, artiste, duree };
    }
  }
  const plusRepresentes = [...artistes.values()].sort((a, b) => b.nombre - a.nombre);
  const maximum = plusRepresentes[0]?.nombre;
  const premiers = plusRepresentes.filter((a) => a.nombre === maximum);
  const pochettes = disques.filter((v) => v.avecPochette).length;
  const cartes = [
    ["Temps d’écoute connu", ecoute ? formatEcoute(ecoute) : "Durée indisponible",
      dureesConnues ? `Calculé en additionnant les durées de ${dureesConnues} morceau${dureesConnues > 1 ? "x" : ""}.` : ""],
    ["Morceau le plus long", plusLongue && formatEcoute(plusLongue.duree),
      plusLongue && [plusLongue.piste.titre, plusLongue.artiste].filter(Boolean).join(" · ")],
    ["Plus ancienne année connue", doyens[0]?.infos.annee,
      doyens.length > 1 ? `${doyens.length} disques de cette année` : doyens[0] && [doyens[0].artiste, doyens[0].a].filter(Boolean).join(" · ")],
    ["En tête par nombre de disques", premiers.length === 1 ? premiers[0].artiste : premiers.length && `${premiers.length} artistes ex æquo`,
      maximum && `${maximum} disque${maximum > 1 ? "s" : ""}${premiers.length > 1 ? " par artiste" : ""}`],
    ["Pochettes en main", `${pochettes} / ${disques.length}`],
  ];
  $("stats-grille").innerHTML = cartes.map(([titre, valeur, detail]) => `<div>
    <dt>${esc(titre)}</dt><dd>${esc(valeur || "—")}${detail ? `<small>${esc(detail)}</small>` : ""}</dd>
  </div>`).join("");
}

$("btn-stats").addEventListener("click", () => {
  rendreStats();
  $("stats").showModal();
});
$("stats-perimetre").addEventListener("change", rendreStats);
$("stats").addEventListener("click", (e) => {
  if (e.target === $("stats")) $("stats").close();
});

// ——— Feuilles ———
function ouvrir(id) {
  $(id).hidden = false;
  document.documentElement.style.overflow = "hidden";
}
function fermer(id) {
  if (id === "fiche") return $("fiche").close();
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
const dialogueFiche = $("fiche");
const defilementFiche = dialogueFiche.querySelector(".fiche-defilement");
const fermetureFiche = dialogueFiche.querySelector("[data-fermer]");

dialogueFiche.addEventListener("click", (e) => {
  if ((e.target === dialogueFiche || e.target.closest("[data-fermer]")) && !$("btn-enregistrer").disabled) fermer("fiche");
});
dialogueFiche.addEventListener("cancel", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!$("btn-enregistrer").disabled) fermer("fiche");
});
dialogueFiche.addEventListener("keydown", (e) => {
  if (e.key === "Escape") e.stopPropagation();
});

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
  $("doublon").scrollIntoView({ block: "nearest" });
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
$("pochette-img").addEventListener("error", () => afficherPochette(""));
function majLienDiscogs() {
  const lien = $("lien-discogs");
  const release = releaseDe(fiche);
  lien.hidden = !release;
  $("fiche-prix").hidden = true;
  if (!release) return;

  lien.href = `https://www.discogs.com/release/${encodeURIComponent(release)}`;
  lien.textContent = `Discogs #${release} ↗`;
  const p = fiche.prix || {};
  const prix = [p.bas && `bas ${euros(p.bas)}`, p.moyen && `moyen ${euros(p.moyen)}`, p.haut && `haut ${euros(p.haut)}`].filter(Boolean).join(" · ");
  $("fiche-prix").textContent = p.source === "conseil" ? `Prix conseillés · ${prix}` : prix;
  $("fiche-prix").hidden = !prix;
}
const normaliserTitreDiscogs = (s) => norm(s).replace(/\s+/g, " ").replace(/^(.*), (the|les|la|le|los|die)$/, "$2 $1");
function titreAjuste(disque, face, titre) {
  const reference = disque.titresDiscogs?.[face];
  return typeof reference === "string" && normaliserTitreDiscogs(titre) !== normaliserTitreDiscogs(reference);
}
function majTitresAjustes() {
  for (const face of ["a", "b"]) {
    const champ = $(`f-${face}`);
    const original = $(`titre-discogs-${face}`);
    const ajuste = titreAjuste(fiche, face, champ.value);
    const reference = fiche.titresDiscogs?.[face];
    champ.classList.toggle("titre-ajuste", ajuste);
    original.hidden = !(ajuste && reference.trim());
    original.textContent = original.hidden ? "" : `Original Discogs : ${reference}`;
    if (!original.hidden) champ.setAttribute("aria-describedby", original.id);
    else champ.removeAttribute("aria-describedby");
  }
}
for (const face of ["a", "b"]) $(`f-${face}`).addEventListener("input", majTitresAjustes);

// ——— Vérifier un disque existant avec Discogs (les titres ne changent que si on le demande) ———
const depuisDiscogs = (rel) => {
  const faces = facesDepuisTracklist(rel.tracklist);
  return { artiste: nettoyerArtiste(rel.artists_sort || (rel.artists || []).map((a) => a.anv || a.name).join(" & ")), a: faces.a || rel.title || "", b: faces.b };
};
// Infos utiles d'une fiche Discogs (même règle que infos_discogs dans App/serveur.py).
const sansNumero = (n) => String(n || "").replace(/\s*\(\d+\)$/, "").replace(/\*$/, "").trim();
const AUTEURS_DISCOGS = /Written-By|Words By|Lyrics By|Music By|Composed By|Songwriter/i;
function infosDiscogs(rel) {
  const l = (rel.labels || [])[0] || {};
  const roles = (motif, credits = rel.extraartists) => [...new Set((credits || []).filter((a) => motif.test(a.role || "")).map((a) => sansNumero(a.name)))].slice(0, 6);
  const r = rel.community?.rating || {};
  const pistes = (rel.tracklist || []).filter((p) => (p.type_ || "track") === "track" && p.title?.trim()).map((p) => ({
    position: p.position || "", titre: p.title.trim(), duree: p.duration || "", auteurs: roles(AUTEURS_DISCOGS, p.extraartists || []),
  }));
  const infos = {
    label: sansNumero(l.name), catno: l.catno && l.catno.toLowerCase() !== "none" ? l.catno : "",
    pays: rel.country || "", annee: rel.year || null, genres: rel.genres || [], styles: rel.styles || [],
    auteurs: roles(AUTEURS_DISCOGS), producteurs: roles(/Producer/i), arrangeurs: roles(/Arranged By/i),
    pistes,
    want: rel.community?.want ?? null, note: r.count ? Math.round(r.average * 100) / 100 : null, votes: r.count || null,
  };
  return Object.fromEntries(Object.entries(infos).filter(([, x]) => (Array.isArray(x) ? x.length : x !== "" && x !== null)));
}
function contenuInfosDiscogs(i) {
  if (!i) return "";
  const lignes = [
    ["Label", [i.label, i.catno].filter(Boolean).join(" – ")],
    ["Pays", i.pays],
    ["Année", i.annee],
    ["Genre", (i.genres || []).join(", ")],
    ["Style", (i.styles || []).join(", ")],
    ["Auteurs", (i.auteurs || []).join(", ")],
    ["Production", (i.producteurs || []).join(", ")],
    ["Arrangements", (i.arrangeurs || []).join(", ")],
    ["Discogs", [i.want != null && `${i.want} le veulent`, i.note && `★ ${court(i.note)} (${i.votes})`].filter(Boolean).join(" · ")],
  ].filter(([, x]) => x);
  return lignes.map(([k, x]) => `<div><dt>${k}</dt><dd>${esc(x)}</dd></div>`).join("");
}
function majInfosDiscogs() {
  const dl = $("infos-discogs");
  dl.innerHTML = contenuInfosDiscogs(fiche?.infos);
  dl.hidden = !dl.innerHTML;

  const pistes = $("pistes-discogs");
  pistes.innerHTML = (fiche?.infos?.pistes || []).map((p) => `
    <li>
      <b>${esc(p.position)}</b>
      <span class="piste-titre">${esc(p.titre)}${p.auteurs?.length ? `<small>${esc(p.auteurs.join(", "))}</small>` : ""}</span>
      <span class="piste-duree">${esc(p.duree)}</span>
    </li>`).join("");
  $("bloc-pistes").hidden = !pistes.innerHTML;
  $("fiche-discogs").hidden = dl.hidden && $("bloc-pistes").hidden;
}
// Prix Discogs d'un disque, affichés dans le lien en bas de la fiche.
function chargerPrix(release) {
  const courante = fiche;
  if (fiche.prix && fiche.prix.source !== "conseil") return;
  api(`prix-release?id=${release}`).then((r) => {
    if (dialogueFiche.open && fiche === courante && Object.keys(r).length && fiche.discogs === release) {
      fiche.prix = r;
      majLienDiscogs();
    }
  }).catch(() => {});
}
async function proposerTitres(release, chargement = discogs(`releases/${release}`)) {
  const courante = fiche;
  const ul = $("discogs-resultats");
  try {
    const rel = await chargement;
    if (!dialogueFiche.open || fiche !== courante) return;
    if (String(releaseDe(fiche)) !== String(rel.id)) fiche.prix = null; // prix d'un autre disque Discogs
    fiche.discogs = rel.id;
    fiche.infos = infosDiscogs(rel);
    majInfosDiscogs();
    fiche.suggestion = depuisDiscogs(rel);
    fiche.titresDiscogs = fiche.suggestion;
    majTitresAjustes();
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
    if (!dialogueFiche.open || fiche !== courante) return;
    erreurFiche("Ce disque n'a pas pu être lu sur Discogs.");
    ul.innerHTML = "";
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
  const connu = releaseDe(fiche);
  if (connu) proposerTitres(connu); else rechercherDepuisFiche();
});
$("sugg-autre").addEventListener("click", rechercherDepuisFiche);
$("sugg-utiliser").addEventListener("click", () => {
  const s = fiche.suggestion;
  $("f-artiste").value = s.artiste;
  $("f-a").value = s.a;
  $("f-b").value = s.b;
  majTitresAjustes();
  $("suggestion").hidden = true;
  $("fiche-statut").textContent = "Titres Discogs repris. Clique sur Enregistrer pour les conserver.";
  $("fiche-statut").hidden = false;
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
        correspondances.push({ id: v.id, score: meilleur.score, release: rel.id, image: meilleur.image, infos: infosDiscogs(rel), ...depuisDiscogs(rel), annee: rel.year, pays: rel.country });
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
      const disque = { ...v, artiste: c.artiste, a: c.a, b: c.b, discogs: c.release, pochette: c.chemin, infos: c.infos, titresDiscogs: { artiste: c.artiste, a: c.a, b: c.b } };
      if (String(releaseDe(v)) !== String(c.release)) delete disque.prix;
      return disque;
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

function rendreFicheLecture(v) {
  const position = v.pos ? `Position ${v.pos} · ${JUKEBOX.selectionA(v.pos)} / ${JUKEBOX.selectionB(v.pos)}` : "Réserve";
  const titre = (face) => {
    if (!titreAjuste(v, face, v[face])) return esc(v[face]);
    const reference = v.titresDiscogs[face];
    const original = reference.trim() ? `<small class="titre-discogs">Original Discogs : ${esc(reference)}</small>` : "";
    return `<mark class="titre-ajuste" title="Titre ajusté manuellement">${esc(v[face])}</mark>${original}`;
  };
  $("fiche-lecture").innerHTML = `
    <p class="lead">${esc(position)} · ${v.avecPochette ? "Avec pochette" : "Sans pochette"}</p>
    <p><b>Face A</b> ${titre("a")}</p>
    ${v.b ? `<p><b>Face B</b> ${titre("b")}</p>` : ""}
    ${v.note ? `<div><h3>Note</h3><p>${esc(v.note)}</p></div>` : ""}`;
}

function ouvrirFiche(v, posLibre) {
  fiche = { id: v?.id || uid(), nouveau: !v, pochette: v?.pochette || "", blob: null, discogs: v?.discogs || null,
    origine: { artiste: base(v?.artiste), a: base(v?.a), discogs: v?.discogs || null }, prix: v?.prix || null, infos: v?.infos || null, titresDiscogs: v?.titresDiscogs || null, suggestion: null };
  const edition = !!etat.edition;
  $("fiche-lecture").hidden = edition;
  if (!edition) rendreFicheLecture(v);
  $("pochette-edit").disabled = !edition;
  $("pochette-img").alt = v ? `Pochette de ${v.artiste} — ${v.a}` : "";
  $("fiche-titre").textContent = v ? v.artiste || "Disque" : "Nouveau disque";
  $("f-artiste").value = v?.artiste || "";
  $("f-a").value = v?.a || "";
  $("f-b").value = v?.b || "";
  majTitresAjustes();
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
  arreterRechercheDiscogs();
  $("discogs-q").value = "";
  $("discogs-resultats").innerHTML = "";
  $("fiche-erreur").hidden = $("fiche-statut").hidden = true;
  $("doublon").hidden = $("doublon-choix").hidden = true;
  $("suggestion").hidden = true;
  $("btn-verifier").hidden = !v;
  $("btn-enregistrer").disabled = false;
  $("btn-enregistrer").textContent = "Enregistrer";
  dialogueFiche.showModal();
  defilementFiche.scrollTop = 0;
  if (!v) $("discogs-q").focus();
}

async function chargerInventaire() {
  const { presents } = await api("inventaire");
  presentsInventaire.clear();
  for (const id of presents) presentsInventaire.add(id);
  inventaireCharge = true;
}

async function pointerDisque(v) {
  if (pointagesEnCours.has(v.id)) return;
  pointagesEnCours.add(v.id);
  const present = !presentsInventaire.has(v.id);
  try {
    await posterJson("inventaire", { id: v.id, present });
    if (present) presentsInventaire.add(v.id);
    else presentsInventaire.delete(v.id);

    const grille = $("grille");
    const trouverCarte = (id) => grille.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const carteActuelle = trouverCarte(v.id);
    const avaitFocus = document.activeElement === carteActuelle;
    if (filtreActif("inventaire") || triParInventaire()) {
      const voisine = carteActuelle?.nextElementSibling || carteActuelle?.previousElementSibling;
      rendre();
      if (avaitFocus) (trouverCarte(v.id) || trouverCarte(voisine?.dataset.id) || $("filtre-inventaire")).focus({ preventScroll: true });
    } else {
      if (carteActuelle) {
        carteActuelle.outerHTML = carte(etat.vinyles.find((disque) => disque.id === v.id) || v);
        if (avaitFocus) trouverCarte(v.id)?.focus({ preventScroll: true });
      }
      rendreInventaire();
    }
  } catch (err) {
    toast(err.message);
  } finally {
    pointagesEnCours.delete(v.id);
  }
}

$("btn-inventaire").addEventListener("click", async () => {
  if (!etat.edition || !etat.charge) return;
  if (modeInventaire) {
    modeInventaire = false;
    rendre();
    return;
  }
  $("btn-inventaire").disabled = true;
  try {
    if (!inventaireCharge) await chargerInventaire();
    modeInventaire = true;
    rendre();
  } catch (err) {
    toast(err.message);
  } finally {
    $("btn-inventaire").disabled = false;
  }
});
$("reste-inventaire").addEventListener("change", (e) => changerFiltre("inventaire", e.target.checked ? "a-verifier" : ""));

$("grille").addEventListener("click", (e) => {
  const b = e.target.closest(".disque");
  if (!b) return;
  if (b.dataset.libre && etat.edition) return ouvrirFiche(null, b.dataset.libre);
  const v = etat.vinyles.find((x) => x.id === b.dataset.id);
  if (!v) return;
  if (modeInventaire) pointerDisque(v);
  else ouvrirFiche(v);
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
  const courante = fiche;
  e.target.value = "";
  if (!f) return;
  try {
    const blob = await pochetteCarree(f);
    if (!dialogueFiche.open || fiche !== courante) return;
    fiche.blob = blob;
    afficherPochette(URL.createObjectURL(blob));
  } catch {
    if (dialogueFiche.open && fiche === courante) erreurFiche("Cette image n'a pas pu être lue.");
  }
});

// Recherche Discogs
let discogsTimer, discogsCtl;
let fileApercusDiscogs = Promise.resolve();
let prochainApercuDiscogs = 0;
let repriseApercusDiscogs = 0;

function arreterRechercheDiscogs() {
  clearTimeout(discogsTimer);
  discogsCtl?.observateur?.disconnect();
  discogsCtl = null;
}
dialogueFiche.addEventListener("close", arreterRechercheDiscogs);

function afficherFacesResultat(bouton, faces) {
  bouton.querySelector("[data-face-a]").textContent = faces.a || "Non renseignée";
  bouton.querySelector("[data-face-b]").textContent = faces.b || "Non renseignée";
}

function chargerFacesResultats(liste, recherche) {
  const visibles = new Set();
  const enAttente = new Set();
  const active = () => dialogueFiche.open && discogsCtl === recherche;
  const indisponibles = (bouton) => afficherFacesResultat(bouton, { a: "Indisponible", b: "Indisponible" });
  const observateur = recherche.observateur = new IntersectionObserver((entrees) => {
    for (const { target: bouton, isIntersecting } of entrees) {
      if (!isIntersecting) {
        visibles.delete(bouton);
        continue;
      }
      visibles.add(bouton);
      if (enAttente.has(bouton)) continue;
      enAttente.add(bouton);

      fileApercusDiscogs = fileApercusDiscogs.then(async () => {
        if (active() && visibles.has(bouton)) {
          const delai = prochainApercuDiscogs - Date.now();
          if (delai > 0) await new Promise((resolve) => setTimeout(resolve, delai));
        }
        enAttente.delete(bouton);
        if (!active() || !visibles.has(bouton)) return;
        visibles.delete(bouton);
        observateur.unobserve(bouton);
        if (Date.now() < repriseApercusDiscogs) return indisponibles(bouton);

        const release = bouton.dataset.release;
        prochainApercuDiscogs = Date.now() + 1100;
        const chargement = discogs(`releases/${release}`);
        recherche.releases.set(release, chargement);
        try {
          const rel = await chargement;
          if (active()) afficherFacesResultat(bouton, facesDepuisTracklist(rel.tracklist));
        } catch (e) {
          recherche.releases.delete(release);
          if (e.status === 429) repriseApercusDiscogs = Date.now() + 60_000;
          if (active()) indisponibles(bouton);
        }
      });
    }
  }, { root: liste });
  liste.querySelectorAll("button[data-release]").forEach((bouton) => observateur.observe(bouton));
}

$("discogs-q").addEventListener("input", () => {
  arreterRechercheDiscogs();
  discogsTimer = setTimeout(chercherDiscogs, 450);
});
$("discogs-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); clearTimeout(discogsTimer); chercherDiscogs(); }
});
async function chercherDiscogs(page = 1) {
  arreterRechercheDiscogs();
  if (!dialogueFiche.open) return;
  const q = $("discogs-q").value.trim();
  const ul = $("discogs-resultats");
  if (q.length < 3) { ul.innerHTML = ""; return; }
  if (!etat.edition.discogs) {
    ul.innerHTML = `<li class="info">Ajoute ta clé Discogs dans les réglages (⚙︎) pour remplir automatiquement.</li>`;
    return;
  }
  ul.innerHTML = `<li class="info">Recherche…</li>`;
  const moi = (discogsCtl = { releases: new Map() });
  try {
    const r = await discogs("database/search", { q, type: "release", format: "Vinyl", per_page: "50", page });
    if (!dialogueFiche.open || moi !== discogsCtl) return;
    // 45 tours d'abord (éditions françaises en tête), puis les autres formats.
    const est45 = (x) => /7"|45 RPM/.test((x.format || []).join(" "));
    const res = Array.from(new Map((r.results || []).map((x) => [x.id, x])).values());
    res.sort((a, b) => (b.country === "France") - (a.country === "France"));
    const quarante5 = res.filter(est45);
    const autres = res.filter((x) => !est45(x));
    if (!res.length) { ul.innerHTML = `<li class="info">Rien trouvé. Essaie avec moins de mots.</li>`; return; }
    const ligne = (x) => {
      const catno = (x.catno || "").trim();
      const details = [x.year, x.country, x.label?.[0], catno.toLowerCase() === "none" ? "" : catno].filter(Boolean).join(" · ");
      const vignette = x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : `<span class="vignette"></span>`;
      return `<li><button type="button" data-release="${x.id}">
        ${vignette}
        <span>
          <strong>${esc(x.title)}</strong>
          <small>${esc(details)}</small>
          <span class="resultat-faces">
            <span><b>Face A</b><span data-face-a>…</span></span>
            <span><b>Face B</b><span data-face-b>…</span></span>
          </span>
        </span>
      </button></li>`;
    };
    ul.innerHTML = [
      `<li class="titre-resultats">45 tours</li>`,
      quarante5.length ? quarante5.map(ligne).join("") : `<li class="info">Aucun 45 tours trouvé.</li>`,
      autres.length ? `<li class="titre-resultats">Autres formats</li>${autres.map(ligne).join("")}` : "",
      page > 1 ? `<li><button type="button" data-discogs-page="${page - 1}">Résultats précédents</button></li>` : "",
      page < r.pagination?.pages ? `<li><button type="button" data-discogs-page="${page + 1}">Résultats suivants</button></li>` : "",
    ].join("");
    ul.scrollTop = 0;
    chargerFacesResultats(ul, moi);
  } catch (e) {
    if (!dialogueFiche.open || moi !== discogsCtl) return;
    ul.innerHTML = `<li class="info">${e.status === 401 ? "Clé Discogs refusée — vérifie-la dans les réglages." : e.status === 429 ? "Discogs demande une petite pause, réessaie dans une minute." : "Discogs ne répond pas. Vérifie ta connexion."}</li>`;
  }
}
$("discogs-resultats").addEventListener("click", async (e) => {
  const pagination = e.target.closest("button[data-discogs-page]");
  if (pagination && discogsCtl) return chercherDiscogs(Number(pagination.dataset.discogsPage));
  const b = e.target.closest("button[data-release]");
  if (!b) return;
  const ul = $("discogs-resultats");
  const release = b.dataset.release;
  const chargement = discogsCtl?.releases.get(release) || discogs(`releases/${release}`);
  arreterRechercheDiscogs();
  ul.innerHTML = `<li class="info">Import…</li>`;
  if (!fiche.nouveau) return proposerTitres(release, chargement);
  const courante = fiche;
  try {
    const rel = await chargement;
    if (!dialogueFiche.open || fiche !== courante) return;
    const t = depuisDiscogs(rel);
    fiche.titresDiscogs = t;
    $("f-artiste").value = t.artiste;
    $("f-a").value = t.a;
    $("f-b").value = t.b;
    majTitresAjustes();
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
        const blob = await pochetteCarree(await api(`image?url=${encodeURIComponent(image.uri)}`));
        if (!dialogueFiche.open || fiche !== courante) return;
        if (!fiche.blob) {
          fiche.blob = blob;
          afficherPochette(URL.createObjectURL(blob));
        }
      } catch {}
    }
    if (!dialogueFiche.open || fiche !== courante) return;
    ul.innerHTML = "";
    $("zone-discogs").hidden = true;
    fiche.choixDoublon = fiche.remplacer = null;
    const doublon = doublonActuel();
    if (doublon) afficherDoublon(doublon);
  } catch {
    if (dialogueFiche.open && fiche === courante) ul.innerHTML = `<li class="info">Ce disque n'a pas pu être importé.</li>`;
  }
});

// Enregistrer la collection dans le dossier du Mac
async function enregistrerCollection(vinyles) {
  const avant = new Map(etat.vinyles.map((v) => [v.id, v]));
  const apres = new Set(vinyles.map((v) => v.id));
  const { nouveauxPointes = [], vinyles: enregistres } = await posterJson("collection", {
    vinyles: trier(vinyles),
    modifications: vinyles.filter((v) => avant.get(v.id) !== v),
    supprimes: [...avant.keys()].filter((id) => !apres.has(id)),
  });
  for (const id of nouveauxPointes) presentsInventaire.add(id);
  etat.vinyles = trier(enregistres || vinyles);
  majPublier();
}
const retirerPochette = (chemin) => {
  if (chemin?.startsWith("covers/")) api(`retirer-pochette?nom=${encodeURIComponent(chemin.slice(7))}`, { method: "POST" }).catch(() => {});
};

$("form-disque").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!etat.edition || !dialogueFiche.open || $("btn-enregistrer").disabled) return;
  const artiste = $("f-artiste").value.trim();
  const a = $("f-a").value.trim();
  if (!artiste || !a) return erreurFiche("Il faut au moins l'artiste et la face A.");
  const doublon = doublonActuel();
  if (doublon && fiche.choixDoublon !== doublon.id) return afficherDoublon(doublon);
  const btn = $("btn-enregistrer");
  btn.disabled = true;
  btn.textContent = "Enregistrement…";
  fermetureFiche.disabled = $("btn-supprimer").disabled = defilementFiche.inert = true;
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
    if (fiche.discogs && fiche.titresDiscogs) disque.titresDiscogs = fiche.titresDiscogs;
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
  } finally {
    fermetureFiche.disabled = $("btn-supprimer").disabled = defilementFiche.inert = false;
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
}
$("btn-reglages").addEventListener("click", () => ouvrirReglages());

// ——— Synchronisation de la collection avec Discogs ———
let rapport = null;
const boutonSyncDiscogs = $("btn-sync-discogs");
const historiqueDiscogs = $("historique-discogs");
const selectHistorique = $("historique-entree");
let historique = [];
let restaurationEnCours = false;
let synchronisationEnCours = false;

function bilanDiscogs(p) {
  const changements = [];
  if (p.deplaces) changements.push(`${p.deplaces} ${p.deplaces === 1 ? "disque a changé" : "disques ont changé"} de dossier sur Discogs`);
  if (p.exportes) changements.push(`${p.exportes} ${p.exportes === 1 ? "disque ajouté" : "disques ajoutés"} à Discogs`);
  if (p.importes) changements.push(`${p.importes} ${p.importes === 1 ? "disque ajouté" : "disques ajoutés"} à ta réserve`);

  const bilan = changements.length ? [`${changements.join(", ")}.`] : [];
  if (p.sans_reference) bilan.push(`${p.sans_reference} ${p.sans_reference === 1 ? "disque à lier" : "disques à lier"} à Discogs.`);
  if (p.info_cases) {
    bilan.push(p.info_cases === "Crée le champ « Case jukebox » (texte libre) dans les paramètres de collection Discogs."
      ? "Pour afficher les numéros de case, crée le champ « Case jukebox » (texte privé) sur Discogs."
      : p.info_cases);
  }
  if (p.erreur_valeur) bilan.push("Estimation Discogs non actualisée.");
  return bilan.join("\n") || (p.erreur ? "" : "Synchronisation terminée.");
}

function afficherVerif(p) {
  boutonSyncDiscogs.disabled = !!p.en_cours;
  synchronisationEnCours = !!p.en_cours;
  $("btn-valeur-discogs").disabled = synchronisationEnCours || actualisationValeurEnCours;
  controlesHistorique();
  rapport = p.rapport || rapport;
  $("btn-voir-verif").hidden = p.en_cours || !rapport;
  const statut = $("statut-sync-discogs");
  const etape = p.etape || "Synchronisation Discogs";
  const dernierBilan = p.exportes != null ? p : rapport;
  statut.hidden = !p.en_cours && dernierBilan?.exportes == null && !p.erreur;
  statut.textContent = p.en_cours
    ? p.total ? `${etape} · ${p.fait}/${p.total}` : `${etape}…`
    : [p.erreur, dernierBilan?.exportes != null && bilanDiscogs(dernierBilan)].filter(Boolean).join("\n");
  if (p.en_cours) {
    $("r-verif").textContent = "Synchronisation en cours. Tu peux continuer à utiliser le jukebox.";
  } else if (rapport) {
    $("r-verif").textContent = `Dernière synchronisation le ${rapport.date}.` +
      (rapport.exportes == null ? "" : `\n${bilanDiscogs(rapport)}`);
  }
}

async function suivreVerif() {
  try {
    let progression;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      progression = await api("verification");
      if (progression.en_cours) afficherVerif(progression);
    } while (progression.en_cours);

    await chargerInventaire().catch(() => {});
    await charger();
    afficherVerif(progression);
    if (historiqueDiscogs.open) await chargerHistorique();
    majPublier();
    toast(progression.erreur || "Synchronisation Discogs terminée");
  } catch {
    afficherVerif({ en_cours: false });
    toast("Impossible de suivre la synchronisation Discogs");
  }
}

boutonSyncDiscogs.addEventListener("click", async () => {
  if (!etat.edition.discogs) return ouvrirReglages("Ajoute ta clé Discogs pour synchroniser la collection.");
  boutonSyncDiscogs.disabled = true;
  try {
    await api("verifier", { method: "POST" });
    afficherVerif({ en_cours: true });
    await suivreVerif();
  } catch (err) {
    boutonSyncDiscogs.disabled = false;
    toast(err.message);
  }
});
$("btn-voir-verif").addEventListener("click", () => { fermer("reglages"); ouvrirVerif(); });

let actualisationValeurEnCours = false;
$("btn-valeur-discogs").addEventListener("click", async (event) => {
  const bouton = event.currentTarget;
  const statut = $("r-valeur-discogs");
  actualisationValeurEnCours = true;
  bouton.disabled = true;
  statut.textContent = "Lecture de l’estimation Discogs…";
  try {
    etat.valeurDiscogs = await api("valeur-discogs", { method: "POST" });
    rendre();
    majPublier();
    statut.textContent = "Estimation Discogs actualisée.";
  } catch (err) {
    statut.textContent = err.message;
  } finally {
    actualisationValeurEnCours = false;
    bouton.disabled = synchronisationEnCours;
  }
});

const nbFichesModifiees = (n) => n <= 1 ? `${n} fiche modifiée` : `${n} fiches modifiées`;
const libellesHistorique = {
  artiste: "Artiste", a: "Face A", b: "Face B", discogs: "Référence Discogs", infos: "Infos Discogs",
  titresDiscogs: "Titres Discogs", prix: "Prix", bas: "Prix bas", moyen: "Prix moyen", haut: "Prix haut",
  source: "Source des prix", vendu: "Ventes relevées", label: "Label", catno: "N° de catalogue",
  pays: "Pays", annee: "Année", genres: "Genres",
  styles: "Styles", auteurs: "Auteurs", producteurs: "Producteurs", arrangeurs: "Arrangeurs",
  pistes: "Pistes", want: "Membres Discogs qui veulent cette édition",
  note: "Note Discogs", votes: "Nombre de votes",
};
const dateHistorique = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium" });

function valeurHistorique(cle, valeur) {
  if (valeur == null || valeur === "" || (Array.isArray(valeur) && !valeur.length)) return "—";
  if (["bas", "moyen", "haut"].includes(cle) && typeof valeur === "number") {
    return valeur.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  }
  if (cle === "source" && valeur === "conseil") return "Prix conseillé par Discogs";
  if (cle === "pistes" && Array.isArray(valeur)) {
    return valeur.map((p) => [p.position, p.titre, p.duree, p.auteurs?.join(", ")].filter(Boolean).join(" · ")).join("\n");
  }
  return Array.isArray(valeur) ? valeur.join(", ") : String(valeur);
}

function lignesHistorique(champs) {
  return Object.entries(champs).flatMap(([cle, { avant, apres }]) => {
    const libelle = libellesHistorique[cle] || cle;
    if (["infos", "prix", "titresDiscogs"].includes(cle)) {
      const cles = new Set([...Object.keys(avant || {}), ...Object.keys(apres || {})]);
      return [...cles].filter((k) => JSON.stringify(avant?.[k]) !== JSON.stringify(apres?.[k])).map((k) => [
        cle === "titresDiscogs" ? `${libelle} · ${libellesHistorique[k] || k}` : libellesHistorique[k] || k,
        valeurHistorique(k, avant?.[k]), valeurHistorique(k, apres?.[k]),
      ]);
    }
    return [[libelle, valeurHistorique(cle, avant), valeurHistorique(cle, apres)]];
  });
}

function controlesHistorique() {
  const bloque = synchronisationEnCours || restaurationEnCours;
  $("historique-attente").hidden = !synchronisationEnCours;
  selectHistorique.disabled = restaurationEnCours;
  for (const bouton of historiqueDiscogs.querySelectorAll("#historique-restaurer, [data-restaurer-fiche]")) {
    bouton.disabled = bloque;
  }
}

function rendreHistorique() {
  const entree = historique.find((e) => e.id === selectHistorique.value);
  const fiches = entree?.fiches || [];
  const ouvertes = new Set([...$("historique-fiches").querySelectorAll("details[open]")].map((d) => d.dataset.fiche));
  $("historique-restaurer").hidden = !fiches.some((f) => !f.restauree);
  $("historique-fiches").innerHTML = fiches.map((f) => `
    <details data-fiche="${esc(f.id)}"${ouvertes.has(f.id) ? " open" : ""}>
      <summary><strong>${esc(f.artiste)} · ${esc(f.titre)}</strong><small>${f.pos ? `Position ${esc(f.pos)}` : "Réserve"}${f.restauree ? " · Restaurée" : ""}</small></summary>
      <table class="historique-table">
        <thead><tr><th scope="col">Champ</th><th scope="col">Avant</th><th scope="col">Après</th></tr></thead>
        <tbody>${lignesHistorique(f.champs).map(([nom, avant, apres]) => `<tr><th scope="row">${esc(nom)}</th><td>${esc(avant)}</td><td>${esc(apres)}</td></tr>`).join("")}</tbody>
      </table>
      ${f.restauree ? "" : `<button type="button" class="secondaire" data-restaurer-fiche="${esc(f.id)}">Restaurer cette fiche</button>`}
    </details>`).join("") || (entree ? "<p class=\"lead\">Aucune fiche modifiée pendant cette mise à jour.</p>" : "");
  controlesHistorique();
}

async function chargerHistorique(ident) {
  const statut = $("historique-statut");
  statut.textContent = "Chargement de l’historique…";
  try {
    historique = await api("historique-discogs");
    selectHistorique.innerHTML = historique.map((e) =>
      `<option value="${esc(e.id)}">${esc(dateHistorique.format(e.date * 1000))} · ${esc(e.titre)} · ${nbFichesModifiees(e.fiches.length)}</option>`).join("");
    if (historique.some((e) => e.id === ident)) selectHistorique.value = ident;
    $("historique-choix").hidden = !historique.length;
    statut.textContent = historique.length ? "" : "Les prochaines mises à jour des fiches apparaîtront ici.";
    rendreHistorique();
    return true;
  } catch (err) {
    historique = [];
    $("historique-choix").hidden = true;
    statut.textContent = err.message;
  }
  rendreHistorique();
  return false;
}

$("btn-historique-discogs").addEventListener("click", () => {
  historiqueDiscogs.showModal();
  chargerHistorique();
});
historiqueDiscogs.addEventListener("click", async (e) => {
  if (e.target === historiqueDiscogs) return historiqueDiscogs.close();
  const bouton = e.target.closest("#historique-restaurer, [data-restaurer-fiche]");
  if (!bouton || restaurationEnCours || synchronisationEnCours) return;
  const fiche = bouton.dataset.restaurerFiche;
  const id = selectHistorique.value;
  if (!confirm(fiche ? "Restaurer les valeurs précédentes de cette fiche ?" : "Restaurer les valeurs précédentes de toutes les fiches de cette mise à jour ?")) return;

  restaurationEnCours = true;
  controlesHistorique();
  const statut = $("historique-statut");
  statut.textContent = "Restauration en cours…";
  try {
    const { restaurees, conflits } = await posterJson("restaurer-fiches", { id, fiche });
    if (restaurees) {
      await charger();
      majPublier();
    }
    if (!await chargerHistorique(id)) return;
    const bilan = restaurees === 1 ? "1 fiche restaurée." : `${restaurees} fiches restaurées.`;
    const conflit = conflits === 1 ? "1 fiche a changé depuis cette mise à jour ou a été supprimée."
      : `${conflits} fiches ont changé depuis cette mise à jour ou ont été supprimées.`;
    statut.textContent = conflits ? `${bilan} ${conflit}` : bilan;
  } catch (err) {
    statut.textContent = err.message;
  } finally {
    restaurationEnCours = false;
    controlesHistorique();
  }
});
selectHistorique.addEventListener("change", () => {
  $("historique-statut").textContent = "";
  $("historique-fiches").replaceChildren();
  rendreHistorique();
});

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
  const doublons = groupesDoublons(etat.vinyles);
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
  const { modifiees } = await posterJson("appliquer-titres-discogs", { ids, horodatage: rapport.horodatage });
  await charger();
  majPublier();
  rendreVerif();
  toast(nbFichesModifiees(modifiees));
}
$("verif").addEventListener("click", async (e) => {
  const maj = e.target.closest("[data-maj]"), ign = e.target.closest("[data-ignorer]"), ouv = e.target.closest("[data-ouvrir]");
  try {
    if (maj) await appliquer([maj.dataset.maj]);
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
  try { await appliquer(ids); } catch (err) { toast(err.message); }
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
    etat.valeurDiscogs = donnees.valeurDiscogs || null;
    etat.charge = true;
    rendre();
  } catch {
    $("etat").textContent = location.protocol === "file:"
      ? "Ouvre le jukebox avec « Ouvrir le jukebox » dans le dossier App."
      : "Impossible de charger la collection. Vérifie ta connexion.";
  }
}

function changerFiltre(cle, valeur) {
  etat.f[cle] = valeur;
  lsSet(`jb.${cle}`, valeur);
  rendre();
}
for (const s of document.querySelectorAll("[data-filtre]")) {
  s.addEventListener("change", () => changerFiltre(s.dataset.filtre, s.value));
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
  if (etat.edition) await chargerInventaire().catch(() => {});
  await charger();
  if (etat.edition) {
    majPublier();
    api("verification").then((p) => {
      afficherVerif(p);
      if (p.en_cours) suivreVerif();
    }).catch(() => { boutonSyncDiscogs.disabled = false; });
    // En revenant sur la page (après une modification ailleurs), on revérifie.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") majPublier(); });
  } else {
    // En ligne : on recharge en revenant sur l'appli, pour voir la dernière publication.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") charger(); });
  }
})();
