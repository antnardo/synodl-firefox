"use strict";

/**
 * background.js — Menu contextuel, envois, retour visuel.
 *
 * Le menu est reconstruit à chaque changement de réglages. L'identifiant
 * d'une entrée encode sa destination : `synodl|video/Films`, la partie
 * vide signifiant « destination par défaut de Download Station ».
 */

const MENU_ROOT = "synodl";
const MENU_CONTEXTS = ["link", "selection", "image", "video", "audio"];

/** Schémas acceptés par Download Station, pour l'extraction depuis une sélection. */
const URL_PATTERN =
    /\b((?:https?|ftps?|magnet|ed2k|thunder|flashget|qqdl):[^\s"'<>]+)/i;

const BANNER_MS_OK = 3500;
const BANNER_MS_ERROR = 9000;

let bannerSeq = 0;

/* ------------------------------------------------------------------ */
/* Menu contextuel                                                    */
/* ------------------------------------------------------------------ */

async function buildMenus() {
    await browser.contextMenus.removeAll();
    const settings = await synoLoadSettings();
    const destinations = settings.destinations.filter(Boolean);

    if (destinations.length === 0) {
        browser.contextMenus.create({
            id: `${MENU_ROOT}|`,
            title: "Envoyer à la Download Station",
            contexts: MENU_CONTEXTS,
        });
        return;
    }

    if (destinations.length === 1) {
        browser.contextMenus.create({
            id: `${MENU_ROOT}|${destinations[0]}`,
            title: `Envoyer à la Download Station (${destinations[0]})`,
            contexts: MENU_CONTEXTS,
        });
        return;
    }

    browser.contextMenus.create({
        id: MENU_ROOT,
        title: "Envoyer à la Download Station",
        contexts: MENU_CONTEXTS,
    });
    for (const destination of destinations) {
        browser.contextMenus.create({
            id: `${MENU_ROOT}|${destination}`,
            parentId: MENU_ROOT,
            title: destination,
            contexts: MENU_CONTEXTS,
        });
    }
    browser.contextMenus.create({
        id: `${MENU_ROOT}|`,
        parentId: MENU_ROOT,
        title: "Dossier par défaut du NAS",
        contexts: MENU_CONTEXTS,
    });
}

function pickUrl(info) {
    if (info.linkUrl) {
        return info.linkUrl;
    }
    if (info.srcUrl) {
        return info.srcUrl;
    }
    if (info.selectionText) {
        const match = info.selectionText.match(URL_PATTERN);
        if (match) {
            return match[1];
        }
    }
    return "";
}

/** Nom de fichier lisible, quel que soit le schéma. */
function shortLabel(url) {
    if (url.startsWith("magnet:")) {
        const name = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get(
            "dn"
        );
        return name || "lien magnet";
    }
    try {
        const path = new URL(url).pathname;
        const last = decodeURIComponent(
            path.split("/").filter(Boolean).pop() || ""
        );
        return last || url;
    } catch (err) {
        return url;
    }
}

/* ------------------------------------------------------------------ */
/* Bannière injectée dans la page                                     */
/* ------------------------------------------------------------------ */

/**
 * Exécutée dans le contexte de l'onglet, pas ici : cette fonction est
 * sérialisée par `scripting.executeScript` et ne doit donc rien référencer
 * de la portée de ce fichier.
 *
 * Elle est idempotente — rappelée avec le même `id`, elle met à jour la
 * carte existante au lieu d'en empiler une seconde.
 */
function synodlBanner(id, state, title, message, autoCloseMs) {
    const HOST_ID = "synodl-banner-host";
    let host = document.getElementById(HOST_ID);

    if (!host) {
        host = document.createElement("div");
        host.id = HOST_ID;
        // En ligne et !important : la feuille de style de la page ne doit pas
        // pouvoir déplacer ni masquer la bannière. Une règle de page ciblant
        // l'identifiant suffirait autrement à la neutraliser — d'où les
        // propriétés d'affichage reprises une à une.
        host.style.cssText = [
            "display:block",
            "visibility:visible",
            "opacity:1",
            "position:fixed",
            "top:12px",
            "right:12px",
            "bottom:auto",
            "left:auto",
            "z-index:2147483647",
            "margin:0",
            "padding:0",
            "border:0",
            "width:auto",
            "height:auto",
            "min-width:0",
            "min-height:0",
            "max-width:none",
            "max-height:none",
            "transform:none",
            "filter:none",
            "clip-path:none",
            "background:none",
            "pointer-events:none",
        ]
            .map((rule) => `${rule} !important`)
            .join(";");
        host.attachShadow({ mode: "open" });

        const style = document.createElement("style");
        style.textContent = `
.stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    direction: ltr;
    text-align: left;
}
.card {
    pointer-events: auto;
    cursor: pointer;
    box-sizing: border-box;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: 340px;
    padding: 11px 14px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 10px;
    background: #ffffff;
    color: #1c1c1e;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    font: 400 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    opacity: 0;
    transform: translateX(12px);
    transition: opacity 0.2s ease, transform 0.2s ease;
}
.card.in { opacity: 1; transform: none; }
.text { display: flex; flex-direction: column; min-width: 0; }
.title { font-weight: 600; }
.msg { opacity: 0.75; overflow-wrap: anywhere; }
.mark {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 14px;
    height: 14px;
    margin-top: 2px;
    border-radius: 50%;
}
.pending .mark {
    border: 2px solid rgba(0, 0, 0, 0.15);
    border-top-color: #1c6ea4;
    animation: synodl-spin 0.7s linear infinite;
}
.ok .mark { background: #1a7f37; }
.error .mark { background: #b42318; }
@keyframes synodl-spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) {
    .card {
        background: #2b2a33;
        color: #fbfbfe;
        border-color: rgba(255, 255, 255, 0.12);
    }
    .pending .mark {
        border-color: rgba(255, 255, 255, 0.2);
        border-top-color: #5aa6dc;
    }
    .ok .mark { background: #4ac26b; }
    .error .mark { background: #ff6b62; }
}`;

        const stack = document.createElement("div");
        stack.className = "stack";
        host.shadowRoot.append(style, stack);
        (document.body || document.documentElement).appendChild(host);
    }

    const stack = host.shadowRoot.querySelector(".stack");
    let card = stack.querySelector(`[data-id="${id}"]`);

    if (!card) {
        card = document.createElement("div");
        card.dataset.id = id;
        card.setAttribute("role", "status");
        card.innerHTML =
            '<span class="mark"></span>' +
            '<span class="text"><span class="title"></span>' +
            '<span class="msg"></span></span>';
        card.addEventListener("click", () => card.remove());
        stack.appendChild(card);
        requestAnimationFrame(() => card.classList.add("in"));
    }

    card.className = `card ${state}${card.classList.contains("in") ? " in" : ""}`;
    card.querySelector(".title").textContent = title;
    card.querySelector(".msg").textContent = message || "";

    clearTimeout(card.synodlTimer);
    if (autoCloseMs > 0) {
        card.synodlTimer = setTimeout(() => {
            card.classList.remove("in");
            setTimeout(() => {
                card.remove();
                if (!stack.children.length) {
                    host.remove();
                }
            }, 220);
        }, autoCloseMs);
    }
}

/** Retourne false si l'onglet n'accepte pas d'injection (page privilégiée…). */
async function showBanner(tabId, id, state, title, message, autoCloseMs) {
    if (typeof tabId !== "number") {
        return false;
    }
    try {
        await browser.scripting.executeScript({
            target: { tabId },
            func: synodlBanner,
            args: [id, state, title, message || "", autoCloseMs],
        });
        return true;
    } catch (err) {
        return false;
    }
}

function notify(title, message) {
    return browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon-96.png"),
        title,
        message,
    });
}

/** Bannière si possible et souhaitée, notification système sinon. */
async function announce(tabId, id, state, title, message, useBanner) {
    const autoClose = state === "error" ? BANNER_MS_ERROR : BANNER_MS_OK;
    if (useBanner) {
        const shown = await showBanner(
            tabId,
            id,
            state,
            title,
            message,
            autoClose
        );
        if (shown) {
            return;
        }
    }
    await notify(title, message);
}

/* ------------------------------------------------------------------ */
/* Envoi                                                              */
/* ------------------------------------------------------------------ */

/**
 * Envoie une liste d'URL et retourne un résultat par URL.
 * Les erreurs ne sont jamais propagées : elles sont rapportées par entrée.
 */
async function sendUrls(urls, destination, tabId = null) {
    const settings = await synoLoadSettings();
    const id = ++bannerSeq;

    // Les erreurs restent visibles même si le retour visuel est désactivé ;
    // seul le choix « notification système » les y renvoie.
    const errorBanner = settings.feedback !== "notification";
    const okBanner = settings.feedback === "banner";

    const fail = async (message) => {
        await announce(tabId, id, "error", "SynoDL", message, errorBanner);
        return urls.map((url) => ({ url, ok: false, message }));
    };

    if (!settings.host || !settings.username) {
        browser.runtime.openOptionsPage();
        return fail("Renseignez d'abord le NAS dans les réglages de SynoDL.");
    }

    const origins = [synoOriginPattern(settings)];
    if (!(await browser.permissions.contains({ origins }))) {
        browser.runtime.openOptionsPage();
        return fail(
            "Firefox n'a pas encore l'autorisation de contacter ce NAS. " +
                "Ouvrez les réglages de SynoDL et enregistrez-les."
        );
    }

    const target = destination || "dossier par défaut";
    if (okBanner) {
        await showBanner(
            tabId,
            id,
            "pending",
            urls.length === 1
                ? "Envoi à la Download Station…"
                : `Envoi de ${urls.length} liens…`,
            urls.length === 1 ? shortLabel(urls[0]) : `→ ${target}`,
            0
        );
    }

    const results = [];
    for (const url of urls) {
        try {
            await synoCreateTask(settings, url, destination);
            results.push({ url, ok: true, message: "" });
        } catch (err) {
            results.push({ url, ok: false, message: err.message });
        }
    }

    const failures = results.filter((result) => !result.ok);
    if (failures.length > 0) {
        await announce(
            tabId,
            id,
            "error",
            failures.length === results.length
                ? "Échec de l'envoi"
                : `${failures.length} envoi(s) en échec`,
            failures[0].message,
            errorBanner
        );
    } else if (settings.feedback !== "none") {
        await announce(
            tabId,
            id,
            "ok",
            "Ajouté à la Download Station",
            results.length === 1
                ? `${shortLabel(results[0].url)} → ${target}`
                : `${results.length} liens → ${target}`,
            okBanner
        );
    }
    return results;
}

/* ------------------------------------------------------------------ */
/* Écouteurs                                                          */
/* ------------------------------------------------------------------ */

browser.contextMenus.onClicked.addListener((info, tab) => {
    const id = String(info.menuItemId);
    if (!id.startsWith(`${MENU_ROOT}|`)) {
        return;
    }
    const destination = id.slice(MENU_ROOT.length + 1);
    const tabId = tab ? tab.id : null;
    const url = pickUrl(info);

    if (!url) {
        announce(
            tabId,
            ++bannerSeq,
            "error",
            "Aucun lien détecté",
            "Faites un clic droit sur un lien, une image, une vidéo, " +
                "ou sur une URL sélectionnée.",
            true
        );
        return;
    }
    sendUrls([url], destination, tabId);
});

browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "send") {
        return sendUrls(message.urls, message.destination);
    }
    return undefined;
});

browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
        return;
    }
    if (changes.destinations) {
        buildMenus();
    }
    const credentialKeys = ["protocol", "host", "port", "username", "password"];
    if (credentialKeys.some((key) => key in changes)) {
        synoResetSession();
    }
});

browser.runtime.onInstalled.addListener(buildMenus);
browser.runtime.onStartup.addListener(buildMenus);
buildMenus();
