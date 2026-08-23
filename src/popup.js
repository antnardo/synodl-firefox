"use strict";

/**
 * popup.js — Envoi manuel d'un ou plusieurs liens.
 *
 * L'envoi passe par le script d'arrière-plan (message `send`) pour que la
 * session DSM reste partagée avec le menu contextuel.
 */

const urlsField = document.getElementById("urls");
const destinationField = document.getElementById("destination");
const statusBox = document.getElementById("status");
const sendButton = document.getElementById("send");

function setStatus(message, kind = "") {
    statusBox.textContent = message;
    statusBox.className = `status ${kind}`;
}

function readUrls() {
    return urlsField.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

async function restore() {
    const settings = await synoLoadSettings();
    for (const destination of settings.destinations) {
        destinationField.add(new Option(destination, destination));
    }
    destinationField.add(new Option("Dossier par défaut du NAS", ""));

    if (!settings.host || !settings.username) {
        setStatus("SynoDL n'est pas encore configuré.", "ko");
        sendButton.disabled = true;
    }
}

async function onSend() {
    const urls = readUrls();
    if (urls.length === 0) {
        setStatus("Saisissez au moins un lien.", "ko");
        return;
    }

    sendButton.disabled = true;
    setStatus("Envoi…");
    const results = await browser.runtime.sendMessage({
        type: "send",
        urls,
        destination: destinationField.value,
    });
    sendButton.disabled = false;

    const failures = results.filter((result) => !result.ok);
    if (failures.length === 0) {
        setStatus(`${results.length} lien(s) ajouté(s).`, "ok");
        urlsField.value = "";
        return;
    }
    setStatus(
        failures.map((result) => `${result.url}\n${result.message}`).join("\n\n"),
        "ko"
    );
}

async function onFromTab() {
    const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    if (!tab || !tab.url) {
        setStatus("URL de l'onglet indisponible.", "ko");
        return;
    }
    const lines = readUrls();
    if (!lines.includes(tab.url)) {
        lines.push(tab.url);
    }
    urlsField.value = lines.join("\n");
}

document.getElementById("send").addEventListener("click", onSend);
document.getElementById("from-tab").addEventListener("click", onFromTab);
document.getElementById("open-options").addEventListener("click", () => {
    browser.runtime.openOptionsPage();
    window.close();
});
restore();
