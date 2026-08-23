"use strict";

/**
 * background.js — Menu contextuel et orchestration des envois.
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

/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

function notify(title, message) {
    return browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon-96.png"),
        title,
        message,
    });
}

/** Nom de fichier lisible pour la notification, quel que soit le schéma. */
function shortLabel(url) {
    if (url.startsWith("magnet:")) {
        const name = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get(
            "dn"
        );
        return name || "lien magnet";
    }
    try {
        const path = new URL(url).pathname;
        const last = decodeURIComponent(path.split("/").filter(Boolean).pop() || "");
        return last || url;
    } catch (err) {
        return url;
    }
}

/* ------------------------------------------------------------------ */
/* Envoi                                                              */
/* ------------------------------------------------------------------ */

/**
 * Envoie une liste d'URL et retourne un résultat par URL.
 * Les erreurs ne sont jamais propagées : elles sont rapportées par entrée.
 */
async function sendUrls(urls, destination) {
    const settings = await synoLoadSettings();

    if (!settings.host || !settings.username) {
        const message = "Renseignez d'abord le NAS dans les réglages de SynoDL.";
        await notify("SynoDL non configuré", message);
        browser.runtime.openOptionsPage();
        return urls.map((url) => ({ url, ok: false, message }));
    }

    const origins = [synoOriginPattern(settings)];
    if (!(await browser.permissions.contains({ origins }))) {
        const message =
            "Firefox n'a pas encore l'autorisation de contacter ce NAS. " +
            "Ouvrez les réglages de SynoDL et enregistrez-les pour l'accorder.";
        await notify("Autorisation manquante", message);
        browser.runtime.openOptionsPage();
        return urls.map((url) => ({ url, ok: false, message }));
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
        await notify(
            failures.length === results.length
                ? "Échec de l'envoi"
                : `${failures.length} envoi(s) en échec`,
            failures[0].message
        );
    } else if (settings.notify) {
        const target = destination || "dossier par défaut";
        await notify(
            "Ajouté à la Download Station",
            results.length === 1
                ? `${shortLabel(results[0].url)} → ${target}`
                : `${results.length} liens → ${target}`
        );
    }
    return results;
}

/* ------------------------------------------------------------------ */
/* Écouteurs                                                          */
/* ------------------------------------------------------------------ */

browser.contextMenus.onClicked.addListener((info) => {
    const id = String(info.menuItemId);
    if (!id.startsWith(`${MENU_ROOT}|`)) {
        return;
    }
    const destination = id.slice(MENU_ROOT.length + 1);
    const url = pickUrl(info);
    if (!url) {
        notify(
            "Aucun lien détecté",
            "Faites un clic droit sur un lien, une image, une vidéo, " +
                "ou sur une URL sélectionnée."
        );
        return;
    }
    sendUrls([url], destination);
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
    // Un changement d'identifiants invalide la session en cache.
    const credentialKeys = ["protocol", "host", "port", "username", "password"];
    if (credentialKeys.some((key) => key in changes)) {
        synoResetSession();
    }
});

browser.runtime.onInstalled.addListener(buildMenus);
browser.runtime.onStartup.addListener(buildMenus);
buildMenus();
