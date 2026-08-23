"use strict";

/**
 * options.js — Page de réglages.
 *
 * `browser.permissions.request()` doit être le premier appel du gestionnaire
 * de clic : tout `await` antérieur ferait perdre le geste utilisateur et
 * Firefox refuserait la demande.
 */

const fields = {
    protocol: document.getElementById("protocol"),
    host: document.getElementById("host"),
    port: document.getElementById("port"),
    username: document.getElementById("username"),
    password: document.getElementById("password"),
    otp: document.getElementById("otp"),
    destinations: document.getElementById("destinations"),
    notify: document.getElementById("notify"),
};

const statusBox = document.getElementById("status");
const deviceState = document.getElementById("device-state");
const sharesBox = document.getElementById("shares");

function setStatus(message, kind = "") {
    statusBox.textContent = message;
    statusBox.className = `status ${kind}`;
}

function parseDestinations(text) {
    return text
        .split("\n")
        .map((line) => line.trim().replace(/^\/+|\/+$/g, ""))
        .filter(Boolean);
}

/**
 * Nettoie l'adresse saisie : protocole, chemin et port collés sont retirés.
 * Un port trouvé dans l'adresse est renvoyé à part pour alimenter son champ.
 */
function splitHost(raw) {
    const cleaned = raw
        .trim()
        .replace(/^[a-z]+:\/\//i, "")
        .replace(/\/.*$/, "");
    const match = cleaned.match(/^(.*?):(\d+)$/);
    if (match) {
        return { host: match[1], port: Number(match[2]) };
    }
    return { host: cleaned, port: 0 };
}

function readForm() {
    const address = splitHost(fields.host.value);
    if (address.port) {
        fields.host.value = address.host;
        fields.port.value = address.port;
    }
    return {
        protocol: fields.protocol.value,
        host: address.host,
        port: address.port || Number(fields.port.value) || 5001,
        username: fields.username.value.trim(),
        password: fields.password.value,
        destinations: parseDestinations(fields.destinations.value),
        notify: fields.notify.checked,
    };
}

async function restore() {
    const settings = await synoLoadSettings();
    fields.protocol.value = settings.protocol;
    fields.host.value = settings.host;
    fields.port.value = settings.port;
    fields.username.value = settings.username;
    fields.password.value = settings.password;
    fields.destinations.value = settings.destinations.join("\n");
    fields.notify.checked = settings.notify;
    deviceState.textContent = settings.deviceId
        ? "Un jeton d'appareil est enregistré : le code 2FA n'est plus demandé."
        : "";
}

/**
 * Valide le formulaire, demande la permission d'hôte et enregistre.
 * Retourne les réglages enregistrés, ou null si l'opération a échoué.
 */
async function persist() {
    const settings = readForm();

    if (!settings.host) {
        setStatus("Renseignez l'adresse du NAS.", "ko");
        return null;
    }
    if (!settings.username) {
        setStatus("Renseignez le compte DSM.", "ko");
        return null;
    }

    const origins = [synoOriginPattern(settings)];
    let granted = false;
    try {
        granted = await browser.permissions.request({ origins });
    } catch (err) {
        setStatus(`Adresse de NAS invalide : ${err.message}`, "ko");
        return null;
    }
    if (!granted) {
        setStatus(
            "Firefox doit autoriser l'extension à contacter " +
                `${settings.host} pour fonctionner.`,
            "ko"
        );
        return null;
    }

    await browser.storage.local.set(settings);

    const otp = fields.otp.value.trim();
    if (otp) {
        try {
            const { deviceId } = await synoLogin(settings, otp);
            await browser.storage.local.set({ deviceId });
            settings.deviceId = deviceId;
            fields.otp.value = "";
            deviceState.textContent = deviceId
                ? "Un jeton d'appareil est enregistré : le code 2FA n'est plus demandé."
                : "Le NAS n'a pas renvoyé de jeton d'appareil.";
        } catch (err) {
            setStatus(err.message, "ko");
            return null;
        }
    } else {
        const stored = await synoLoadSettings();
        settings.deviceId = stored.deviceId;
    }

    return settings;
}

async function onSave() {
    setStatus("");
    const settings = await persist();
    if (settings) {
        setStatus("Réglages enregistrés.", "ok");
    }
}

async function onTest() {
    setStatus("");
    const settings = await persist();
    if (!settings) {
        return;
    }

    setStatus("Connexion au NAS…");
    try {
        synoResetSession();
        // Séquentiel : deux connexions simultanées sur la même session DSM
        // invalideraient l'une l'autre (erreur 107).
        const info = await synoGetInfo(settings);
        const config = await synoGetConfig(settings);
        setStatus(
            `Connecté. Download Station ${info.version_string || info.version}\n` +
                `Destination par défaut du NAS : ` +
                `${config.default_destination || "(aucune)"}`,
            "ok"
        );
    } catch (err) {
        setStatus(err.message, "ko");
    }
}

async function onLoadShares() {
    setStatus("");
    const settings = await persist();
    if (!settings) {
        return;
    }

    sharesBox.textContent = "";
    try {
        const shares = await synoListShares(settings);
        if (shares.length === 0) {
            setStatus("Aucun dossier partagé visible par ce compte.", "ko");
            return;
        }
        for (const share of shares) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = share;
            button.addEventListener("click", () => {
                const current = parseDestinations(fields.destinations.value);
                if (!current.includes(share)) {
                    current.push(share);
                }
                fields.destinations.value = current.join("\n");
            });
            sharesBox.appendChild(button);
        }
        setStatus("Cliquez un dossier pour l'ajouter aux destinations.", "ok");
    } catch (err) {
        setStatus(
            `${err.message}\nVous pouvez saisir les chemins à la main.`,
            "ko"
        );
    }
}

document.getElementById("save").addEventListener("click", onSave);
document.getElementById("test").addEventListener("click", onTest);
document.getElementById("load-shares").addEventListener("click", onLoadShares);
restore();
