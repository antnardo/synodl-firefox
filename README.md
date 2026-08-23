# SynoDL — extension Firefox pour la Download Station

Clic droit sur un lien dans Firefox → le fichier part en téléchargement sur le
NAS Synology, sans passer par l'interface DSM ni par l'ordinateur.

Fonctionne avec les liens `http(s)`, `ftp`, `magnet`, `ed2k`, sur les liens
d'une page comme sur les images, vidéos et sons, ou sur une URL simplement
sélectionnée dans du texte.

---

## Prérequis

- Firefox 142 ou plus récent.
- Download Station installé et démarré sur le NAS (DSM 7).
- Un compte DSM autorisé sur Download Station.

L'extension s'appuie sur ces APIs, qu'un DSM 7 avec Download Station expose
toutes :

```text
SYNO.API.Auth               entry.cgi
SYNO.DownloadStation.Task   DownloadStation/task.cgi
SYNO.DownloadStation2.Task  entry.cgi
SYNO.FileStation.List       entry.cgi   (facultatif, listage des partages)
```

Pour vérifier ce que publie votre NAS, sans identifiants :

```bash
curl -sk "https://VOTRE-NAS:5001/webapi/query.cgi?api=SYNO.API.Info\
&version=1&method=query&query=SYNO.DownloadStation.Task,SYNO.DownloadStation2.Task"
```

---

## Étape 0 — accepter le certificat du NAS

**À faire avant tout le reste, sinon rien ne fonctionnera.**

DSM est servi en HTTPS (port `5001` par défaut, souvent modifié) avec le
certificat auto-signé d'usine de Synology — `CN=synology.com`, émis par
`Synology Inc. CA`. Firefox le refuse par défaut, et une requête d'extension
échoue alors en silence : il n'y a pas de page d'avertissement sur laquelle
cliquer.

Il faut donc créer l'exception une fois, à la main :

1. Ouvrir `https://VOTRE-NAS:5001` dans un onglet Firefox, en remplaçant
   l'adresse et le port par les vôtres.
2. Cliquer **Avancé…** puis **Accepter le risque et poursuivre**.

L'exception est enregistrée dans le profil Firefox et vaut ensuite pour toutes
les requêtes de l'extension. Elle survit aux redémarrages.

> Variante plus propre : installer sur le NAS un certificat valide — Let's
> Encrypt, directement depuis DSM ou via un reverse proxy — et configurer
> l'extension avec le nom de domaine correspondant. L'étape 0 devient alors
> inutile.

---

## Installation

### Depuis la release — la voie normale

1. Télécharger le `.xpi` de la [dernière
   release](https://github.com/antnardo/synodl-firefox/releases/latest).
2. Le glisser dans une fenêtre Firefox et confirmer l'installation.

L'archive attachée aux releases est signée par Mozilla : l'installation est
permanente, sur n'importe quelle édition de Firefox. En revanche il n'y a pas
de mise à jour automatique — pour changer de version, reprendre les deux mêmes
étapes avec le nouveau `.xpi`.

Enchaîner ensuite sur la [configuration](#configuration).

### Chargement temporaire — pour développer

L'add-on se charge sans signature, et disparaît au redémarrage de Firefox.

1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire…**
3. Choisir le fichier `manifest.json` de ce dossier.

C'est aussi de là que se lisent les journaux, via le bouton **Inspecter**.

### Signer sa propre version — si vous modifiez le code

Firefox en édition Release ou Beta refuse d'installer durablement une extension
non signée : un fork ou une modification locale doit donc repasser par une
signature. Deux voies possibles.

**A. Signature Mozilla en distribution privée** — gratuit, l'extension n'est pas
publiée sur le catalogue public et ne passe pas en revue humaine. Il faut un
compte Mozilla, avec double authentification obligatoire pour les développeurs
d'add-ons.

1. Construire l'archive :

   ```bash
   ./build.sh
   ```

2. Sur le tableau de bord développeur d'addons.mozilla.org, choisir **On your
   own**, et téléverser le `dist/synodl-<version>.xpi` produit.
3. Récupérer le `.xpi` signé, puis le glisser dans une fenêtre Firefox.

Avant de téléverser, **changer l'identifiant** dans `manifest.json`
(`browser_specific_settings.gecko.id`) : celui d'origine appartient au compte
AMO de ce dépôt et sera refusé. Et incrémenter `version` à chaque envoi, AMO
refusant deux fois le même numéro.

Valider comme le fait AMO, avec la version courante du linter — une version
épinglée traîne des données de compatibilité plus anciennes et laisse passer
des avertissements :

```bash
npx web-ext@latest lint --source-dir=. --self-hosted --ignore-files "dist/**" "build.sh"
```

**B. Désactiver la vérification de signature** — possible uniquement sur Firefox
Developer Edition, Nightly ou ESR : dans `about:config`, passer
`xpinstall.signatures.required` à `false`. Sans effet sur l'édition Release.

---

## Configuration

Réglages de l'extension (`about:addons` → SynoDL → Préférences) :

| Champ | Exemple |
| --- | --- |
| Protocole | `https` |
| Adresse | `192.168.1.20`, ou le nom d'hôte du NAS |
| Port | `5001`, ou le port DSM que vous avez défini |
| Utilisateur / mot de passe | compte DSM dédié (voir plus bas) |
| Code 2FA | seulement si le compte l'exige, une seule fois |
| Destinations | un chemin par ligne, ex. `video/Films` |

Le bouton **Lister les dossiers partagés** interroge File Station et propose les
partages en un clic. **Tester la connexion** vérifie l'ensemble de la chaîne et
affiche la version de Download Station ainsi que sa destination par défaut.

À l'enregistrement, Firefox demande l'autorisation de contacter l'hôte saisi :
c'est normal, l'extension ne connaît pas l'adresse du NAS à l'avance et ne
réclame donc aucune permission d'hôte à l'installation.

### Destinations

Les chemins sont relatifs à la racine des partages, sans slash initial
(`video/Films`, pas `/volume1/video/Films`). Le premier de la liste est celui
proposé en tête de menu.

- Aucune destination : une entrée unique dans le menu contextuel, le NAS range
  le fichier dans la destination par défaut de Download Station.
- Une seule destination : une entrée unique, qui l'utilise.
- Plusieurs destinations : un sous-menu, avec en dernier « Dossier par défaut du
  NAS ».

### Double authentification

Si le compte DSM impose un code 2FA, le saisir une fois dans les réglages :
l'extension demande alors un jeton d'appareil à DSM (`enable_device_token`) et
le conserve. Les connexions suivantes n'ont plus besoin de code.

---

## Utilisation

- **Clic droit sur un lien** → *Envoyer à la Download Station* (avec le
  sous-menu de destinations s'il y en a plusieurs).
- **Clic droit sur une URL sélectionnée** → même chose, l'URL est extraite du
  texte.
- **Bouton de la barre d'outils** → coller plusieurs liens d'un coup, un par
  ligne, ou reprendre l'URL de l'onglet courant.

Une notification confirme l'ajout, ou affiche l'erreur renvoyée par DSM
traduite en clair.

---

## Sécurité

Le mot de passe DSM est stocké **en clair** dans le stockage local de
l'extension, à l'intérieur du profil Firefox. C'est la limite du procédé : une
extension ne dispose d'aucun coffre chiffré.

Conséquence pratique : créer dans DSM un **utilisateur dédié**, membre d'un
groupe qui n'a accès qu'à Download Station et en écriture aux seuls dossiers de
destination. Pas de compte administrateur, pas de compte réutilisé ailleurs.

L'extension ne demande aucune permission d'hôte à l'installation ; elle ne
réclame que celle du NAS que vous saisissez, au moment de l'enregistrement des
réglages. Aucune donnée ne sort du réseau local.

---

## Détails techniques

| Élément | Choix retenu |
| --- | --- |
| Manifest | v3, page d'arrière-plan événementielle (`background.scripts`) |
| Authentification | `SYNO.API.Auth` v7, `format=sid`, en POST |
| Session | SID passé en paramètre `_sid`, `credentials: "omit"` |
| Création de tâche | `SYNO.DownloadStation.Task` v1 `create` |
| Repli | `SYNO.DownloadStation2.Task` v2 si l'API v1 est absente |
| Dossiers | `SYNO.FileStation.List` v2 `list_share` |

Quelques points qui expliquent le code :

- Les requêtes partent sans cookie (`credentials: "omit"`) et s'authentifient
  uniquement par `_sid`. DSM n'applique alors pas sa protection CSRF, ce qui
  évite d'avoir à gérer un `SynoToken`.
- Le mot de passe part en POST, jamais dans une URL.
- `SYNO.DownloadStation2.Task` est déclarée `requestFormat: JSON` par le NAS :
  chaque valeur de paramètre doit être du JSON, donc les chaînes portent leurs
  guillemets (`type="url"`, pas `type=url`). C'est le piège classique de cette
  API, et la raison pour laquelle le repli est écrit séparément.
- Les patterns de permission WebExtension ignorent le port : pour un NAS en
  `https://192.168.1.20:5001`, l'extension demande `https://192.168.1.20/*`,
  sans le port.
- Une session expirée (codes DSM 106, 107, 119) déclenche une reconnexion et un
  seul nouvel essai.

### Arborescence

```text
synodl/
├── manifest.json
├── build.sh              Empaquetage en .xpi
├── icons/
│   ├── icon.svg          Source, non embarquée dans le paquet
│   └── icon-{48,96,128}.png
└── src/
    ├── syno.js           Client de l'API DSM (auth, tâches, partages)
    ├── background.js     Menu contextuel, envois, notifications
    ├── options.html/.js  Réglages
    ├── popup.html/.js    Envoi manuel depuis la barre d'outils
    └── style.css         Thème clair et sombre
```

Régénérer les icônes après modification du SVG :

```bash
cd icons
for s in 48 96 128; do
    rsvg-convert -w "$s" -h "$s" icon.svg -o "icon-$s.png"
done
```

Valider le paquet comme le ferait Mozilla :

```bash
npx web-ext lint --source-dir=. --self-hosted --ignore-files "dist/**"
```

---

## Dépannage

- **NAS injoignable** — certificat non accepté (étape 0), adresse ou port
  erronés, ou vous n'êtes pas sur le réseau local.
- **Identifiant ou mot de passe incorrect** — compte DSM erroné.
- **Double authentification requise** — saisir une fois un code 2FA dans les
  réglages.
- **Adresse IP bloquée par le NAS** — blocage automatique DSM après des échecs
  répétés, à lever dans Panneau de configuration › Sécurité › Compte.
- **Ce compte DSM n'a pas les droits sur Download Station** — ajouter le compte
  au groupe autorisé dans DSM.
- **Le dossier de destination n'existe pas** — chemin mal orthographié, ou
  slash initial en trop.
- **Destination refusée** — le compte n'a pas le droit d'écrire dans ce
  dossier.
- **API absente du NAS** — Download Station non installé ou arrêté.

Les journaux de l'extension s'affichent dans `about:debugging` → **Inspecter**
en face de SynoDL.

---

## État

La 1.0.1 est signée par Mozilla et distribuée dans les
[releases](https://github.com/antnardo/synodl-firefox/releases). Le paquet
passe la validation AMO sans erreur ni avertissement, et la chaîne complète —
connexion DSM, menu contextuel, création de tâche — a été vérifiée sur un
DS920+ en DSM 7.3.

---

## Licence

MIT — voir [LICENSE](LICENSE).

SynoDL est un projet indépendant, sans lien avec Synology Inc. « Synology » et
« Download Station » sont des marques de leurs propriétaires respectifs.
