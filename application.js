const etatsVinyle = [
  "Excellent",
  "Bon",
  "Moyen",
  "À nettoyer",
  "Défaut / à remplacer",
];

const elements = {
  recherche: document.querySelector("#recherche"),
  boutonEffacerRecherche: document.querySelector("#bouton-effacer-recherche"),
  tri: document.querySelector("#tri"),
  ongletJukebox: document.querySelector("#onglet-jukebox"),
  ongletBibliotheque: document.querySelector("#onglet-bibliotheque"),
  modePochettes: document.querySelector("#mode-pochettes"),
  modeListe: document.querySelector("#mode-liste"),
  carrousel: document.querySelector(".carrousel-pochettes"),
  carrouselPrecedent: document.querySelector("#carrousel-precedent"),
  carrouselSuivant: document.querySelector("#carrousel-suivant"),
  grille: document.querySelector("#grille-disques"),
  compteurDisques: document.querySelector("#compteur-disques"),
  libelleCompteurDisques: document.querySelector("#libelle-compteur-disques"),
  messageApplication: document.querySelector("#message-application"),
  boutonAjouter: document.querySelector("#bouton-ajouter"),
  boutonExportCsv: document.querySelector("#bouton-export-csv"),
  boutonExportJson: document.querySelector("#bouton-export-json"),
  boutonImportJson: document.querySelector("#bouton-import-json"),
  boutonViderDonnees: document.querySelector("#bouton-vider-donnees"),
  importJsonFichier: document.querySelector("#import-json-fichier"),
  fenetre: document.querySelector("#fenetre-formulaire"),
  formulaire: document.querySelector("#formulaire-disque"),
  titreFormulaire: document.querySelector("#titre-formulaire"),
  boutonFermer: document.querySelector("#bouton-fermer"),
  boutonAnnuler: document.querySelector("#bouton-annuler"),
  messageFormulaire: document.querySelector("#message-formulaire"),
  emplacement: document.querySelector("#emplacement"),
  champPosition: document.querySelector("#champ-position"),
  positionJukebox: document.querySelector("#position_jukebox"),
  artiste: document.querySelector("#artiste"),
  listeArtistes: document.querySelector("#liste-artistes"),
  titreFaceA: document.querySelector("#titre_face_a"),
  titreFaceB: document.querySelector("#titre_face_b"),
  etatVinyle: document.querySelector("#etat_vinyle"),
  lienFaceA: document.querySelector("#lien_apple_music_face_a"),
  lienFaceB: document.querySelector("#lien_apple_music_face_b"),
  photoPochetteFichier: document.querySelector("#photo_pochette_fichier"),
  commentaire: document.querySelector("#commentaire"),
  libelleTitreFaceA: document.querySelector("#libelle-titre-face-a"),
  libelleTitreFaceB: document.querySelector("#libelle-titre-face-b"),
  modeleCarte: document.querySelector("#modele-carte"),
};

let collection = [];
let vueActive = "jukebox";
let triActif = "position";
let modeAffichage = obtenirModeAffichageInitial();
let indexCarrousel = 0;
let delaiCarrousel = null;
let animationCarrousel = null;
let dernierTempsCarrousel = null;
let balayageCarrouselActif = false;
let delaiRepriseBalayage = null;
let survolCarrouselActif = false;
let identifiantEdition = null;
let lectureSeule = false;
let baseDisponible = false;

const VITESSE_DEFILEMENT_CARROUSEL = 0.12;
const DELAI_REPRISE_CARROUSEL = 3200;

initialiser();

async function initialiser() {
  appliquerLibellesMobiles();
  remplirEtats();
  brancherEvenements();
  await chargerModeEtCollection();
  mettreAJourSuggestionsArtistes();
  mettreAJourAffichageVue();
  mettreAJourModeInterface();
  mettreAJourBoutonEffacerRecherche();
  afficherCollection();
}

function brancherEvenements() {
  elements.recherche.addEventListener("input", () => {
    mettreAJourBoutonEffacerRecherche();
    afficherCollection();
  });
  elements.tri.addEventListener("change", () => {
    triActif = elements.tri.value;
    afficherCollection();
  });
  elements.boutonEffacerRecherche.addEventListener("click", effacerRecherche);

  elements.ongletJukebox.addEventListener("click", () => changerVue("jukebox"));
  elements.ongletBibliotheque.addEventListener("click", () => changerVue("bibliotheque"));
  elements.modePochettes.addEventListener("click", () => changerModeAffichage("pochettes"));
  elements.modeListe.addEventListener("click", () => changerModeAffichage("liste"));
  elements.carrouselPrecedent.addEventListener("click", () => {
    suspendreBalayageCarrousel();
    deplacerCarrousel(-1);
    programmerRepriseBalayageCarrousel();
  });
  elements.carrouselSuivant.addEventListener("click", () => {
    suspendreBalayageCarrousel();
    deplacerCarrousel(1);
    programmerRepriseBalayageCarrousel();
  });
  elements.grille.addEventListener("scroll", synchroniserCarrouselAuDefilement, { passive: true });
  elements.carrousel.addEventListener("pointerenter", () => {
    survolCarrouselActif = true;
    suspendreBalayageCarrousel();
  });
  elements.carrousel.addEventListener("pointerleave", () => {
    survolCarrouselActif = false;
    programmerRepriseBalayageCarrousel();
  });
  ["pointerdown", "touchstart", "wheel", "keydown"].forEach((nomEvenement) => {
    elements.carrousel.addEventListener(nomEvenement, () => {
      suspendreBalayageCarrousel();
      programmerRepriseBalayageCarrousel();
    }, { passive: true });
  });
  ["pointerup", "touchend", "mouseup"].forEach((nomEvenement) => {
    elements.carrousel.addEventListener(nomEvenement, () => {
      if (!survolCarrouselActif) {
        programmerRepriseBalayageCarrousel();
      }
    }, { passive: true });
  });
  window.addEventListener("resize", appliquerLibellesMobiles, { passive: true });

  elements.boutonAjouter.addEventListener("click", ouvrirCreation);
  elements.boutonFermer.addEventListener("click", fermerFormulaire);
  elements.boutonAnnuler.addEventListener("click", fermerFormulaire);
  elements.formulaire.addEventListener("submit", enregistrerVinyle);
  elements.emplacement.addEventListener("change", mettreAJourChampsFormulaire);
  elements.positionJukebox.addEventListener("input", mettreAJourLibellesSelectionsDepuisSaisie);
  elements.positionJukebox.addEventListener("blur", normaliserChampPosition);
  elements.fenetre.addEventListener("click", (evenement) => {
    if (!evenement.target.closest(".formulaire")) {
      fermerFormulaire();
    }
  });

  elements.boutonExportCsv.addEventListener("click", exporterCsv);
  elements.boutonExportJson.addEventListener("click", exporterJson);
  elements.boutonImportJson.addEventListener("click", () => {
    if (lectureSeule) {
      afficherMessageApplication("Mode lecture seule sur cet appareil.");
      return;
    }
    elements.importJsonFichier.click();
  });
  elements.importJsonFichier.addEventListener("change", importerJson);
  elements.boutonViderDonnees.addEventListener("click", viderBibliotheque);
}

async function chargerModeEtCollection() {
  if (!estAdresseLocale()) {
    await chargerDepuisFichierStatique();
    return;
  }

  try {
    await chargerDepuisServeurLocal();
  } catch {
    await chargerDepuisFichierStatique();
  }
}

async function chargerDepuisServeurLocal() {
  const [modeReponse, bibliothequeReponse] = await Promise.all([
    fetch("/api/mode", { cache: "no-store" }),
    fetch("/api/bibliotheque", { cache: "no-store" }),
  ]);

  if (!modeReponse.ok || !bibliothequeReponse.ok) {
    throw new Error("Base locale indisponible");
  }

  const mode = await modeReponse.json();
  const donnees = await bibliothequeReponse.json();
  const vinyles = Array.isArray(donnees.vinyles) ? donnees.vinyles : [];

  lectureSeule = Boolean(mode.lecture_seule);
  collection = normaliserCollection(vinyles);
  baseDisponible = true;
  afficherMessageApplication(
    lectureSeule
      ? "Mode lecture seule activé sur cet appareil."
      : "Base locale du Mac chargée.",
    "info",
  );
}

async function chargerDepuisFichierStatique() {
  try {
    const reponse = await fetch(`./bibliotheque.json?v=${Date.now()}`, { cache: "no-store" });
    if (!reponse.ok) {
      throw new Error("Fichier JSON indisponible");
    }

    const donnees = await reponse.json();
    const vinyles = Array.isArray(donnees.vinyles) ? donnees.vinyles : [];

    lectureSeule = true;
    collection = normaliserCollection(vinyles);
    baseDisponible = true;
    afficherMessageApplication("Consultation GitHub en lecture seule.", "info");
  } catch {
    lectureSeule = true;
    baseDisponible = false;
    collection = [];
    afficherMessageApplication("Base de données indisponible", "erreur", true);
  }
}

function estAdresseLocale() {
  return ["127.0.0.1", "localhost", ""].includes(window.location.hostname);
}

function obtenirModeAffichageInitial() {
  return window.matchMedia("(max-width: 640px)").matches ? "liste" : "pochettes";
}

function estVuePochettesMobile() {
  return modeAffichage === "pochettes" && window.matchMedia("(max-width: 640px)").matches;
}

function appliquerLibellesMobiles() {
  const mobile = window.matchMedia("(max-width: 640px)").matches;

  document.querySelectorAll("[data-mobile-label][data-desktop-label]").forEach((element) => {
    const libelle = mobile ? element.dataset.mobileLabel : element.dataset.desktopLabel;
    if (libelle) {
      element.textContent = libelle;
    }
  });
}

function remplirEtats() {
  elements.etatVinyle.innerHTML = "";
  etatsVinyle.forEach((etat) => {
    const option = document.createElement("option");
    option.value = etat;
    option.textContent = etat;
    elements.etatVinyle.append(option);
  });
}

function changerVue(vue) {
  vueActive = vue;
  triActif = vue === "jukebox" ? "position" : "alphabetique";
  indexCarrousel = 0;
  balayageCarrouselActif = modeAffichage === "pochettes" && !estVuePochettesMobile();
  effacerRepriseBalayageCarrousel();
  elements.recherche.value = "";
  mettreAJourBoutonEffacerRecherche();
  mettreAJourAffichageVue();
  afficherCollection();
}

function mettreAJourAffichageVue() {
  const vueJukebox = vueActive === "jukebox";
  elements.ongletJukebox.classList.toggle("est-actif", vueJukebox);
  elements.ongletBibliotheque.classList.toggle("est-actif", !vueJukebox);
  elements.ongletJukebox.setAttribute("aria-selected", String(vueJukebox));
  elements.ongletBibliotheque.setAttribute("aria-selected", String(!vueJukebox));
  elements.tri.value = triActif;

  if (vueJukebox) {
    elements.libelleCompteurDisques.textContent = "vinyles";
  } else {
    elements.libelleCompteurDisques.textContent = "stock";
  }

  elements.modePochettes.classList.toggle("est-actif", modeAffichage === "pochettes");
  elements.modeListe.classList.toggle("est-actif", modeAffichage === "liste");
  elements.modePochettes.setAttribute("aria-selected", String(modeAffichage === "pochettes"));
  elements.modeListe.setAttribute("aria-selected", String(modeAffichage === "liste"));
}

function changerModeAffichage(mode) {
  modeAffichage = mode;
  indexCarrousel = 0;
  balayageCarrouselActif = mode === "pochettes" && !estVuePochettesMobile();
  effacerRepriseBalayageCarrousel();
  mettreAJourAffichageVue();
  afficherCollection();
}

function mettreAJourModeInterface() {
  elements.boutonAjouter.hidden = lectureSeule || !baseDisponible;
  elements.boutonImportJson.hidden = lectureSeule || !baseDisponible;
  elements.boutonViderDonnees.hidden = lectureSeule || !baseDisponible;
}

function obtenirCollectionVisible() {
  const recherche = elements.recherche.value.trim().toLowerCase();

  return collection.filter((vinyle) => {
    if (vinyle.emplacement !== vueActive) {
      return false;
    }

    const blocRecherche = [
      vinyle.position_jukebox,
      vinyle.selection_face_a,
      vinyle.selection_face_b,
      vinyle.artiste,
      vinyle.titre_face_a,
      vinyle.titre_face_b,
      vinyle.commentaire,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return !recherche || blocRecherche.includes(recherche);
  });
}

function mettreAJourBoutonEffacerRecherche() {
  elements.boutonEffacerRecherche.hidden = elements.recherche.value.trim() === "";
}

function effacerRecherche() {
  elements.recherche.value = "";
  mettreAJourBoutonEffacerRecherche();
  elements.recherche.focus();
  afficherCollection();
}

function afficherCollection() {
  annulerAnimationCarrousel();
  effacerRepriseBalayageCarrousel();
  const donnees = trierCollection(obtenirCollectionVisible());
  elements.grille.innerHTML = "";
  elements.grille.classList.toggle("grille-disques--liste", modeAffichage === "liste");
  elements.grille.classList.toggle("grille-disques--carrousel", modeAffichage === "pochettes");

  if (!baseDisponible) {
    const vide = document.createElement("div");
    vide.className = "etat-vide";
    vide.textContent = "Base de données indisponible.";
    elements.grille.append(vide);
    elements.compteurDisques.textContent = "0";
    return;
  }

  if (donnees.length === 0) {
    const vide = document.createElement("div");
    vide.className = "etat-vide";
    vide.textContent =
      vueActive === "jukebox"
        ? "Aucun vinyle ne correspond à cette recherche dans le jukebox."
        : "Aucun vinyle ne correspond à cette recherche dans la bibliothèque.";
    elements.grille.append(vide);
  } else {
    donnees.forEach((vinyle) => {
      elements.grille.append(
        modeAffichage === "liste" ? construireLigneListe(vinyle) : construireCarte(vinyle),
      );
    });
  }

  indexCarrousel = Math.max(0, Math.min(indexCarrousel, donnees.length - 1));
  mettreAJourCarrousel();
  demarrerBalayageCarrousel();

  elements.compteurDisques.textContent = String(donnees.length);
}

function deplacerCarrousel(direction) {
  const cartes = obtenirCartesCarrousel();
  if (!cartes.length || modeAffichage !== "pochettes") {
    return;
  }

  const prochainIndex = (indexCarrousel + direction + cartes.length) % cartes.length;
  allerAuCarrousel(prochainIndex);
}

function allerAuCarrousel(index) {
  const cartes = obtenirCartesCarrousel();
  if (!cartes[index]) {
    return;
  }

  indexCarrousel = index;
  centrerCarteCarrousel(index, "smooth");
  mettreAJourCarrousel();
}

function synchroniserCarrouselAuDefilement() {
  if (modeAffichage !== "pochettes") {
    return;
  }

  window.clearTimeout(delaiCarrousel);
  delaiCarrousel = window.setTimeout(() => {
    const cartes = obtenirCartesCarrousel();
    if (!cartes.length) {
      return;
    }

    const centre = elements.grille.scrollLeft + elements.grille.clientWidth / 2;
    const indexProche = cartes.reduce((meilleur, carte, index) => {
      const centreCarte = carte.offsetLeft + carte.offsetWidth / 2;
      const distance = Math.abs(centreCarte - centre);
      return distance < meilleur.distance ? { index, distance } : meilleur;
    }, { index: 0, distance: Infinity }).index;

    indexCarrousel = indexProche;
    mettreAJourCarrousel();
  }, 80);
}

function demarrerBalayageCarrousel() {
  const cartes = obtenirCartesCarrousel();
  const mouvementAutorise =
    balayageCarrouselActif &&
    modeAffichage === "pochettes" &&
    !estVuePochettesMobile() &&
    cartes.length > 1 &&
    !survolCarrouselActif &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!mouvementAutorise) {
    return;
  }

  dernierTempsCarrousel = null;
  animationCarrousel = window.requestAnimationFrame(animerBalayageCarrousel);
}

function animerBalayageCarrousel(temps) {
  if (!balayageCarrouselActif || modeAffichage !== "pochettes" || estVuePochettesMobile() || survolCarrouselActif) {
    annulerAnimationCarrousel();
    return;
  }

  const limite = elements.grille.scrollWidth - elements.grille.clientWidth;
  if (limite <= 2) {
    annulerAnimationCarrousel();
    return;
  }

  if (dernierTempsCarrousel === null) {
    dernierTempsCarrousel = temps;
  }

  const ecart = Math.min(50, temps - dernierTempsCarrousel);
  dernierTempsCarrousel = temps;
  const prochainDefilement = elements.grille.scrollLeft + ecart * VITESSE_DEFILEMENT_CARROUSEL;

  elements.grille.scrollLeft = prochainDefilement >= limite ? 0 : prochainDefilement;

  animationCarrousel = window.requestAnimationFrame(animerBalayageCarrousel);
}

function suspendreBalayageCarrousel() {
  balayageCarrouselActif = false;
  effacerRepriseBalayageCarrousel();
  annulerAnimationCarrousel();
}

function programmerRepriseBalayageCarrousel() {
  if (modeAffichage !== "pochettes" || estVuePochettesMobile() || survolCarrouselActif) {
    return;
  }

  effacerRepriseBalayageCarrousel();
  delaiRepriseBalayage = window.setTimeout(() => {
    delaiRepriseBalayage = null;
    if (modeAffichage !== "pochettes" || estVuePochettesMobile() || survolCarrouselActif) {
      return;
    }
    balayageCarrouselActif = true;
    mettreAJourCarrousel();
    demarrerBalayageCarrousel();
  }, DELAI_REPRISE_CARROUSEL);
}

function effacerRepriseBalayageCarrousel() {
  if (delaiRepriseBalayage) {
    window.clearTimeout(delaiRepriseBalayage);
    delaiRepriseBalayage = null;
  }
}

function annulerAnimationCarrousel() {
  if (animationCarrousel) {
    window.cancelAnimationFrame(animationCarrousel);
    animationCarrousel = null;
  }
  dernierTempsCarrousel = null;
}

function mettreAJourCarrousel() {
  const cartes = obtenirCartesCarrousel();
  const modePochettes = modeAffichage === "pochettes";
  elements.carrouselPrecedent.hidden = !modePochettes || cartes.length <= 1;
  elements.carrouselSuivant.hidden = !modePochettes || cartes.length <= 1;

  cartes.forEach((carte, index) => {
    carte.classList.toggle("carte-disque--active", index === indexCarrousel);
  });

  elements.carrouselPrecedent.disabled = !modePochettes || cartes.length <= 1;
  elements.carrouselSuivant.disabled = !modePochettes || cartes.length <= 1;
}

function obtenirCartesCarrousel() {
  return [...elements.grille.querySelectorAll(".carte-disque")];
}

function centrerCarteCarrousel(index, behavior) {
  const carte = obtenirCartesCarrousel()[index];
  if (!carte) {
    return;
  }

  const styles = window.getComputedStyle(elements.grille);
  const paddingGauche = Number.parseFloat(styles.paddingLeft || "0") || 0;
  const gauche = Math.max(0, carte.offsetLeft - paddingGauche);
  elements.grille.scrollTo({
    left: gauche,
    behavior,
  });
}

function construireLigneListe(vinyle) {
  const ligne = document.createElement("article");
  ligne.className = "ligne-vinyle";

  const vignette = document.createElement("div");
  vignette.className = "ligne-vinyle__visuel";
  if (vinyle.photo_pochette) {
    vignette.style.backgroundImage = `url("${vinyle.photo_pochette}")`;
  }

  const contenu = document.createElement("div");
  contenu.className = "ligne-vinyle__contenu";

  const entete = document.createElement("div");
  entete.className = "ligne-vinyle__entete";

  const titreBloc = document.createElement("div");
  titreBloc.className = "ligne-vinyle__titres";

  const artiste = document.createElement("h3");
  artiste.className = "ligne-vinyle__artiste";
  artiste.textContent = vinyle.artiste || "Sans artiste";

  const meta = document.createElement("p");
  meta.className = "ligne-vinyle__meta";
  meta.textContent =
    vinyle.emplacement === "jukebox"
      ? `Position ${vinyle.position_jukebox} • ${vinyle.selection_face_a} / ${vinyle.selection_face_b}`
      : "Bibliothèque";

  titreBloc.append(artiste, meta);

  const etat = document.createElement("span");
  etat.className = "pastille-etat ligne-vinyle__etat";
  etat.textContent = vinyle.etat_vinyle;
  appliquerCouleurEtat(etat, vinyle.etat_vinyle);

  entete.append(titreBloc, etat);

  const titresAffiches = obtenirTitresAffiches(vinyle);
  const faces = document.createElement("div");
  faces.className = "ligne-vinyle__faces";
  titresAffiches.forEach((face) => {
    faces.append(construireFaceListe(face.libelle, face.titre, face.lien));
  });

  contenu.append(entete, faces);
  ligne.append(vignette, contenu);

  return ligne;
}

function construireFaceListe(libelle, titre, lien) {
  const bloc = document.createElement("div");
  bloc.className = "ligne-vinyle__face";

  const label = document.createElement("span");
  label.className = "ligne-vinyle__label";
  label.textContent = libelle;

  const valeur = document.createElement(lien ? "a" : "p");
  valeur.className = "ligne-vinyle__titre";
  valeur.textContent = titre;
  if (lien) {
    valeur.href = lien;
    valeur.target = "_blank";
    valeur.rel = "noreferrer";
  }

  bloc.append(label, valeur);
  return bloc;
}

function trierCollection(donnees) {
  return [...donnees].sort((a, b) => {
    if (triActif === "alphabetique") {
      return String(a.artiste || "").localeCompare(String(b.artiste || ""), "fr", {
        sensitivity: "base",
      });
    }

    if (a.emplacement === "jukebox") {
      return String(a.position_jukebox).localeCompare(String(b.position_jukebox), "fr", {
        numeric: true,
      });
    }

    return String(a.artiste || "").localeCompare(String(b.artiste || ""), "fr", {
      sensitivity: "base",
    });
  });
}

function construireCarte(vinyle) {
  const fragment = elements.modeleCarte.content.cloneNode(true);
  const carte = fragment.querySelector(".carte-disque");
  const visuel = fragment.querySelector(".visuel-pochette");
  const titrePrincipal = fragment.querySelector(".titre-principal");
  const titreSecondaire = fragment.querySelector(".titre-secondaire");

  const code = vinyle.emplacement === "jukebox"
    ? `Sélections ${vinyle.selection_face_a} / ${vinyle.selection_face_b}`
    : "En bibliothèque";

  fragment.querySelectorAll(".selection-code").forEach((element) => {
    element.textContent = code;
  });

  fragment.querySelectorAll(".artiste").forEach((element) => {
    element.textContent = vinyle.artiste;
  });

  appliquerTitresRecto(carte, vinyle, titrePrincipal, titreSecondaire);
  fragment.querySelector(".position-jukebox").textContent =
    vinyle.emplacement === "jukebox" ? vinyle.position_jukebox : "Hors jukebox";
  configurerLienTitre(
    fragment.querySelector(".titre-face-a"),
    vinyle.titre_face_a || "Non renseigné",
    vinyle.lien_apple_music_face_a,
  );
  configurerLienTitre(
    fragment.querySelector(".titre-face-b"),
    vinyle.titre_face_b || "Non renseigné",
    vinyle.lien_apple_music_face_b,
  );
  configurerLien(fragment.querySelector(".bouton-ecouter-face-a"), vinyle.lien_apple_music_face_a, "Écouter");
  configurerLien(fragment.querySelector(".bouton-ecouter-face-b"), vinyle.lien_apple_music_face_b, "Écouter");
  fragment.querySelector(".commentaire").textContent =
    vinyle.commentaire || "Aucun commentaire pour ce vinyle.";

  const pastilleEtat = fragment.querySelector(".pastille-etat");
  pastilleEtat.textContent = vinyle.etat_vinyle;
  appliquerCouleurEtat(pastilleEtat, vinyle.etat_vinyle);

  if (vinyle.photo_pochette) {
    visuel.style.backgroundImage =
      `linear-gradient(180deg, rgba(16,16,16,0.06), rgba(16,16,16,0.22)), url("${vinyle.photo_pochette}")`;
  }

  const boutonPlacement = fragment.querySelector(".bouton-placement");
  const boutonModifier = fragment.querySelector(".bouton-modifier");
  const boutonSupprimer = fragment.querySelector(".bouton-supprimer");
  const menuOptions = fragment.querySelector(".menu-options");

  if (lectureSeule) {
    menuOptions.hidden = true;
  } else if (vinyle.emplacement === "bibliotheque") {
    boutonPlacement.textContent = "Mettre dans le jukebox";
    boutonPlacement.addEventListener("click", () => mettreDansLeJukebox(vinyle.id));
  } else {
    boutonPlacement.textContent = "Retirer vers bibliothèque";
    boutonPlacement.addEventListener("click", () => retirerVersBibliotheque(vinyle.id));
  }

  boutonModifier.addEventListener("click", () => ouvrirEdition(vinyle.id));
  boutonSupprimer.addEventListener("click", () => supprimerVinyle(vinyle.id));

  fragment.querySelectorAll(".carte-disque__retourner").forEach((zoneRetour) => {
    zoneRetour.addEventListener("click", (evenement) => {
      if (evenement.target.closest(".menu-options, .menu-options__action, .lien-titre")) {
        return;
      }
      carte.classList.toggle("est-retournee");
    });

    zoneRetour.addEventListener("keydown", (evenement) => {
      if (evenement.key !== "Enter" && evenement.key !== " ") {
        return;
      }
      evenement.preventDefault();
      carte.classList.toggle("est-retournee");
    });
  });

  return fragment;
}

function appliquerTitresRecto(carte, vinyle, titrePrincipal, titreSecondaire) {
  const {
    principal,
    secondaire,
    affichageDouble,
  } = obtenirConfigurationTitresRecherche(vinyle);

  titrePrincipal.textContent = principal || "Titre non renseigné";
  titreSecondaire.textContent = secondaire;
  titreSecondaire.hidden = !secondaire;
  carte.classList.toggle("carte-disque--double-titre", affichageDouble);
}

function obtenirConfigurationTitresRecherche(vinyle) {
  const recherche = String(elements.recherche.value || "").trim().toLowerCase();
  const selectionA = String(vinyle.selection_face_a || "").toLowerCase();
  const selectionB = String(vinyle.selection_face_b || "").toLowerCase();
  const position = String(vinyle.position_jukebox || "").toLowerCase();
  const titreA = vinyle.titre_face_a || "";
  const titreB = vinyle.titre_face_b || "";

  let principal = titreA;
  let secondaire = "";
  let affichageDouble = false;

  if (!recherche) {
    principal = titreA;
    secondaire = titreB;
    affichageDouble = Boolean(titreA && titreB);
  } else if (recherche === position) {
    principal = titreA;
    secondaire = titreB;
    affichageDouble = Boolean(titreA && titreB);
  } else if (recherche === selectionB && titreB) {
    principal = titreB;
    secondaire = titreA && titreA !== titreB ? titreA : "";
    affichageDouble = false;
  } else if (recherche === selectionA && titreA) {
    principal = titreA;
    secondaire = titreB && titreB !== titreA ? titreB : "";
    affichageDouble = false;
  } else {
    principal = titreA;
    secondaire = titreB && titreB !== titreA ? titreB : "";
  }

  if (recherche === selectionA || recherche === selectionB) {
    secondaire = "";
  }

  return {
    principal,
    secondaire,
    affichageDouble,
  };
}

function obtenirTitresAffiches(vinyle) {
  const { principal, secondaire } = obtenirConfigurationTitresRecherche(vinyle);
  const titreA = vinyle.titre_face_a || "";
  const titreB = vinyle.titre_face_b || "";

  if (!secondaire) {
    if (principal === titreB && titreB) {
      return [
        {
          libelle: "Face B",
          titre: titreB || "Non renseigné",
          lien: vinyle.lien_apple_music_face_b,
        },
      ];
    }

    return [
      {
        libelle: "Face A",
        titre: titreA || principal || "Non renseigné",
        lien: vinyle.lien_apple_music_face_a,
      },
    ];
  }

  return [
    {
      libelle: "Face A",
      titre: titreA || "Non renseigné",
      lien: vinyle.lien_apple_music_face_a,
    },
    {
      libelle: "Face B",
      titre: titreB || "Non renseigné",
      lien: vinyle.lien_apple_music_face_b,
    },
  ];
}

function configurerLien(element, url, libelle) {
  if (url) {
    element.href = url;
    element.textContent = libelle;
    element.hidden = false;
    element.removeAttribute("aria-disabled");
    return;
  }

  element.removeAttribute("href");
  element.setAttribute("aria-disabled", "true");
  element.textContent = "";
  element.hidden = true;
}

function configurerLienTitre(element, texte, url) {
  element.textContent = texte;
  if (url) {
    element.href = url;
    element.removeAttribute("aria-disabled");
    return;
  }

  element.removeAttribute("href");
  element.setAttribute("aria-disabled", "true");
}

function appliquerCouleurEtat(element, etat) {
  const couleurs = {
    Excellent: ["#d8f3e8", "#0d5d4c"],
    Bon: ["#e7f5df", "#496b1d"],
    Moyen: ["#fff0c9", "#8b5b00"],
    "À nettoyer": ["#f8e0bf", "#9a4300"],
    "Défaut / à remplacer": ["#f9d5db", "#8b1e36"],
  };

  const [fond, texte] = couleurs[etat] || ["#e8ece9", "#20312f"];
  element.style.background = fond;
  element.style.color = texte;
}

function ouvrirCreation() {
  if (lectureSeule || !baseDisponible) {
    return;
  }

  identifiantEdition = null;
  elements.titreFormulaire.textContent = "Ajouter un vinyle";
  elements.formulaire.reset();
  elements.emplacement.value = vueActive;
  elements.etatVinyle.value = "Bon";
  mettreAJourChampsFormulaire();
  masquerMessageFormulaire();
  elements.fenetre.showModal();
}

function ouvrirEdition(id) {
  if (lectureSeule || !baseDisponible) {
    return;
  }

  const vinyle = collection.find((element) => element.id === id);
  if (!vinyle) {
    return;
  }

  identifiantEdition = id;
  elements.titreFormulaire.textContent = `Modifier ${vinyle.artiste}`;
  elements.emplacement.value = vinyle.emplacement;
  elements.positionJukebox.value = vinyle.position_jukebox || "";
  elements.artiste.value = vinyle.artiste || "";
  elements.titreFaceA.value = vinyle.titre_face_a || "";
  elements.titreFaceB.value = vinyle.titre_face_b || "";
  elements.etatVinyle.value = vinyle.etat_vinyle || "Bon";
  elements.lienFaceA.value = vinyle.lien_apple_music_face_a || "";
  elements.lienFaceB.value = vinyle.lien_apple_music_face_b || "";
  elements.commentaire.value = vinyle.commentaire || "";
  elements.photoPochetteFichier.value = "";

  mettreAJourChampsFormulaire();
  masquerMessageFormulaire();
  elements.fenetre.showModal();
}

function fermerFormulaire() {
  elements.fenetre.close();
}

function mettreAJourChampsFormulaire() {
  const modeBibliotheque = elements.emplacement.value === "bibliotheque";
  elements.champPosition.hidden = modeBibliotheque;
  elements.positionJukebox.required = !modeBibliotheque;

  if (modeBibliotheque) {
    elements.positionJukebox.value = "";
    elements.libelleTitreFaceA.textContent = "Titre Face A";
    elements.libelleTitreFaceB.textContent = "Titre Face B";
  } else {
    mettreAJourLibellesSelectionsDepuisSaisie();
  }
}

function mettreAJourLibellesSelectionsDepuisSaisie() {
  const chiffres = String(elements.positionJukebox.value || "")
    .replace(/\D/g, "")
    .slice(0, 2);
  const position = chiffres ? chiffres.padStart(2, "0") : "00";
  elements.libelleTitreFaceA.textContent = `Titre Face A (${calculerSelectionFaceA(position)})`;
  elements.libelleTitreFaceB.textContent = `Titre Face B (${calculerSelectionFaceB(position)})`;
}

function normaliserChampPosition() {
  if (!elements.positionJukebox.value) {
    mettreAJourLibellesSelectionsDepuisSaisie();
    return;
  }

  const position = normaliserPosition(elements.positionJukebox.value);
  elements.positionJukebox.value = position;
  mettreAJourLibellesSelectionsDepuisSaisie();
  signalerPositionOccupee(position);
}

function signalerPositionOccupee(position) {
  if (!position || elements.emplacement.value !== "jukebox") {
    return;
  }

  const occupant = collection.find(
    (vinyle) =>
      vinyle.id !== identifiantEdition &&
      vinyle.emplacement === "jukebox" &&
      vinyle.position_jukebox === position,
  );

  if (!occupant) {
    masquerMessageFormulaire();
    return;
  }

  afficherMessageFormulaire(
    `Attention : la position ${position} est déjà occupée par ${occupant.artiste}. À l’enregistrement, je proposerai de l’envoyer en bibliothèque.`,
  );
}

async function enregistrerVinyle(evenement) {
  evenement.preventDefault();
  masquerMessageFormulaire();

  if (lectureSeule || !baseDisponible) {
    afficherMessageFormulaire("Mode lecture seule ou base indisponible.");
    return;
  }

  const vinyleExistant = identifiantEdition
    ? collection.find((element) => element.id === identifiantEdition)
    : null;

  const emplacement = elements.emplacement.value;
  const position = emplacement === "jukebox" ? normaliserPosition(elements.positionJukebox.value) : null;

  if (emplacement === "jukebox" && !position) {
    afficherMessageFormulaire("Saisissez une position valide de 00 à 79.");
    return;
  }

  const vinyle = {
    id: identifiantEdition || crypto.randomUUID(),
    emplacement,
    position_jukebox: position,
    artiste: elements.artiste.value.trim(),
    titre_face_a: elements.titreFaceA.value.trim(),
    titre_face_b: elements.titreFaceB.value.trim(),
    etat_vinyle: elements.etatVinyle.value,
    commentaire: elements.commentaire.value.trim(),
    lien_apple_music_face_a: elements.lienFaceA.value.trim(),
    lien_apple_music_face_b: elements.lienFaceB.value.trim(),
    photo_pochette: vinyleExistant?.photo_pochette || "",
  };

  if (!vinyle.artiste || !vinyle.titre_face_a) {
    afficherMessageFormulaire("Artiste et titre face A sont obligatoires.");
    return;
  }

  if (elements.photoPochetteFichier.files[0]) {
    vinyle.photo_pochette = await convertirFichierEnDataUrl(elements.photoPochetteFichier.files[0]);
  }

  const succes = await enregistrerAvecRegles(vinyle);
  if (!succes) {
    return;
  }

  fermerFormulaire();
}

async function enregistrerAvecRegles(vinyle) {
  const autres = collection.filter((element) => element.id !== vinyle.id);
  let prochaineBase = autres;

  if (vinyle.emplacement === "jukebox") {
    const occupant = autres.find(
      (element) => element.emplacement === "jukebox" && element.position_jukebox === vinyle.position_jukebox,
    );

    if (occupant) {
      const confirmation = window.confirm(
        `${occupant.artiste} est déjà en position ${vinyle.position_jukebox}. Voulez-vous l’envoyer en bibliothèque et mettre ce vinyle à sa place ?`,
      );

      if (!confirmation) {
        afficherMessageFormulaire(
          `Position ${vinyle.position_jukebox} déjà occupée par ${occupant.artiste}. Enregistrement annulé.`,
        );
        return false;
      }

      prochaineBase = autres.map((element) =>
        element.id === occupant.id
          ? {
              ...element,
              emplacement: "bibliotheque",
              position_jukebox: null,
              selection_face_a: "",
              selection_face_b: "",
            }
          : element,
      );
    }
  }

  const prochaineCollection = normaliserCollection([...prochaineBase, vinyle]);
  return await sauvegarderCollectionServeur(prochaineCollection, "Base locale mise à jour.");
}

async function supprimerVinyle(id) {
  if (lectureSeule || !baseDisponible) {
    return;
  }

  const vinyle = collection.find((element) => element.id === id);
  if (!vinyle) {
    return;
  }

  const confirmation = window.confirm(`Supprimer ${vinyle.artiste} de la base locale ?`);
  if (!confirmation) {
    return;
  }

  const prochaineCollection = collection.filter((element) => element.id !== id);
  await sauvegarderCollectionServeur(prochaineCollection, "Vinyle supprimé.");
}

async function retirerVersBibliotheque(id) {
  if (lectureSeule || !baseDisponible) {
    return;
  }

  const vinyle = collection.find((element) => element.id === id);
  if (!vinyle) {
    return;
  }

  const confirmation = window.confirm(`Retirer ${vinyle.artiste} du jukebox vers la bibliothèque ?`);
  if (!confirmation) {
    return;
  }

  const prochaineCollection = collection.map((element) =>
    element.id === id
      ? {
          ...element,
          emplacement: "bibliotheque",
          position_jukebox: null,
          selection_face_a: "",
          selection_face_b: "",
        }
      : element,
  );

  await sauvegarderCollectionServeur(prochaineCollection, "Vinyle remis en bibliothèque.");
}

async function mettreDansLeJukebox(id) {
  if (lectureSeule || !baseDisponible) {
    return;
  }

  const vinyle = collection.find((element) => element.id === id);
  if (!vinyle) {
    return;
  }

  const saisie = window.prompt(
    `Dans quelle position du jukebox voulez-vous placer ${vinyle.artiste} ? Entrez un nombre de 00 à 79.`,
    "00",
  );

  if (saisie === null) {
    return;
  }

  const position = normaliserPosition(saisie);
  if (!position) {
    window.alert("Position invalide. Utilisez un nombre de 00 à 79.");
    return;
  }

  const copie = { ...vinyle, emplacement: "jukebox", position_jukebox: position };
  await enregistrerAvecRegles(copie);
}

async function sauvegarderCollectionServeur(prochaineCollection, messageSucces) {
  try {
    const reponse = await fetch("/api/bibliotheque", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vinyles: normaliserCollection(prochaineCollection),
      }),
    });

    if (reponse.status === 403) {
      lectureSeule = true;
      mettreAJourModeInterface();
      afficherMessageApplication("Mode lecture seule sur cet appareil.", "erreur");
      return false;
    }

    if (!reponse.ok) {
      throw new Error("Base de données indisponible");
    }

    const donnees = await reponse.json();
    collection = normaliserCollection(donnees.vinyles || []);
    baseDisponible = true;
    mettreAJourSuggestionsArtistes();
    afficherCollection();
    afficherMessageApplication(messageSucces, "info");
    return true;
  } catch {
    baseDisponible = false;
    afficherCollection();
    afficherMessageApplication("Base de données indisponible", "erreur", true);
    return false;
  }
}

function normaliserCollection(donnees) {
  const vinylesNormalises = donnees
    .map((vinyle) => {
      const emplacement = vinyle.emplacement === "bibliotheque" ? "bibliotheque" : "jukebox";
      const position = emplacement === "jukebox" ? normaliserPosition(vinyle.position_jukebox) : null;

      if (emplacement === "jukebox" && !position) {
        return null;
      }

      return {
        id: vinyle.id || crypto.randomUUID(),
        emplacement,
        position_jukebox: position,
        selection_face_a: position ? calculerSelectionFaceA(position) : "",
        selection_face_b: position ? calculerSelectionFaceB(position) : "",
        artiste: vinyle.artiste || "",
        titre_face_a: vinyle.titre_face_a || "",
        titre_face_b: vinyle.titre_face_b || "",
        etat_vinyle: vinyle.etat_vinyle || "Bon",
        commentaire: vinyle.commentaire || "",
        lien_apple_music_face_a: vinyle.lien_apple_music_face_a || "",
        lien_apple_music_face_b: vinyle.lien_apple_music_face_b || "",
        photo_pochette: vinyle.photo_pochette || "",
      };
    })
    .filter(Boolean);

  return garantirPositionsJukeboxUniques(vinylesNormalises)
    .sort((a, b) => {
      if (a.emplacement !== b.emplacement) {
        return a.emplacement.localeCompare(b.emplacement, "fr");
      }

      if (a.emplacement === "jukebox") {
        return String(a.position_jukebox).localeCompare(String(b.position_jukebox), "fr", {
          numeric: true,
        });
      }

      return String(a.artiste || "").localeCompare(String(b.artiste || ""), "fr", {
        sensitivity: "base",
      });
    });
}

function garantirPositionsJukeboxUniques(vinyles) {
  const positionsUtilisees = new Set();

  return vinyles.map((vinyle) => {
    if (vinyle.emplacement !== "jukebox") {
      return vinyle;
    }

    if (!positionsUtilisees.has(vinyle.position_jukebox)) {
      positionsUtilisees.add(vinyle.position_jukebox);
      return vinyle;
    }

    return {
      ...vinyle,
      emplacement: "bibliotheque",
      position_jukebox: null,
      selection_face_a: "",
      selection_face_b: "",
    };
  });
}

function mettreAJourSuggestionsArtistes() {
  const artistes = [...new Set(
    collection
      .map((vinyle) => String(vinyle.artiste || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })),
  )];

  elements.listeArtistes.innerHTML = "";
  artistes.forEach((artiste) => {
    const option = document.createElement("option");
    option.value = artiste;
    elements.listeArtistes.append(option);
  });
}

function normaliserPosition(valeur) {
  const chiffres = String(valeur || "")
    .replace(/\D/g, "")
    .slice(0, 2);

  if (!chiffres) {
    return "";
  }

  const nombre = Number(chiffres);
  if (Number.isNaN(nombre)) {
    return "";
  }

  const borne = Math.max(0, Math.min(79, nombre));
  return String(borne).padStart(2, "0");
}

function calculerSelectionFaceA(position) {
  return position ? `1${position}` : "";
}

function calculerSelectionFaceB(position) {
  return position ? `2${position}` : "";
}

function afficherMessageApplication(message, type = "info", permanent = false) {
  elements.messageApplication.textContent = message;
  elements.messageApplication.hidden = false;
  elements.messageApplication.dataset.type = type;

  window.clearTimeout(afficherMessageApplication.delai);
  if (!permanent) {
    afficherMessageApplication.delai = window.setTimeout(() => {
      elements.messageApplication.hidden = true;
      elements.messageApplication.textContent = "";
      delete elements.messageApplication.dataset.type;
    }, 2600);
  }
}

function afficherMessageFormulaire(message) {
  elements.messageFormulaire.textContent = message;
  elements.messageFormulaire.hidden = false;
}

function masquerMessageFormulaire() {
  elements.messageFormulaire.hidden = true;
  elements.messageFormulaire.textContent = "";
}

function exporterCsv() {
  const lignes = [
    [
      "emplacement",
      "position_jukebox",
      "selection_face_a",
      "selection_face_b",
      "artiste",
      "titre_face_a",
      "titre_face_b",
      "etat_vinyle",
      "commentaire",
      "lien_apple_music_face_a",
      "lien_apple_music_face_b",
    ],
    ...collection.map((vinyle) => [
      vinyle.emplacement,
      vinyle.position_jukebox || "",
      vinyle.selection_face_a || "",
      vinyle.selection_face_b || "",
      vinyle.artiste || "",
      vinyle.titre_face_a || "",
      vinyle.titre_face_b || "",
      vinyle.etat_vinyle || "",
      vinyle.commentaire || "",
      vinyle.lien_apple_music_face_a || "",
      vinyle.lien_apple_music_face_b || "",
    ]),
  ];

  const contenu = lignes.map((ligne) => ligne.map(encoderCsv).join(";")).join("\n");
  telechargerFichier(`selection-101-${dateCourte()}.csv`, "text/csv;charset=utf-8", contenu);
  afficherMessageApplication("Export CSV créé.", "info");
}

function exporterJson() {
  const contenu = JSON.stringify(
    {
      application: "Selection 101",
      version: versionApplication,
      exporte_le: new Date().toISOString(),
      vinyles: collection,
    },
    null,
    2,
  );

  telechargerFichier(`selection-101-${dateCourte()}.json`, "application/json;charset=utf-8", contenu);
  afficherMessageApplication("Sauvegarde JSON créée.", "info");
}

async function importerJson(evenement) {
  if (lectureSeule || !baseDisponible) {
    elements.importJsonFichier.value = "";
    return;
  }

  const fichier = evenement.target.files?.[0];
  if (!fichier) {
    return;
  }

  try {
    const texte = await fichier.text();
    const donnees = JSON.parse(texte);
    const vinyles = Array.isArray(donnees) ? donnees : donnees.vinyles;

    if (!Array.isArray(vinyles)) {
      window.alert("Le fichier JSON ne contient pas de sauvegarde valide.");
      return;
    }

    const confirmation = window.confirm(
      "Importer cette sauvegarde va remplacer la base locale actuelle. Continuer ?",
    );

    if (!confirmation) {
      return;
    }

    await sauvegarderCollectionServeur(vinyles, "Sauvegarde JSON importée.");
  } catch {
    window.alert("Import impossible : fichier JSON invalide.");
  } finally {
    elements.importJsonFichier.value = "";
  }
}

async function viderBibliotheque() {
  if (lectureSeule || !baseDisponible) {
    return;
  }

  const confirmation = window.confirm("Voulez-vous vraiment vider toute la base locale ?");
  if (!confirmation) {
    return;
  }

  await sauvegarderCollectionServeur([], "Base locale vidée.");
}

function encoderCsv(valeur) {
  return `"${String(valeur ?? "").replaceAll('"', '""')}"`;
}

function telechargerFichier(nom, type, contenu) {
  const blob = new Blob([contenu], { type });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.append(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}

function dateCourte() {
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const mois = String(maintenant.getMonth() + 1).padStart(2, "0");
  const jour = String(maintenant.getDate()).padStart(2, "0");
  const heure = String(maintenant.getHours()).padStart(2, "0");
  const minute = String(maintenant.getMinutes()).padStart(2, "0");
  return `${annee}-${mois}-${jour}-${heure}${minute}`;
}

function convertirFichierEnDataUrl(fichier) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.addEventListener("load", () => resolve(String(lecteur.result)));
    lecteur.addEventListener("error", () => reject(new Error("Impossible de lire le fichier image.")));
    lecteur.readAsDataURL(fichier);
  });
}
