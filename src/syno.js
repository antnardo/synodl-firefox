"use strict";

/**
 * syno.js — Client de l'API Synology DSM 7 pour la Download Station.
 *
 * APIs utilisées :
 *     SYNO.API.Auth              v7  login              (entry.cgi)
 *     SYNO.DownloadStation.Task  v1  create             (DownloadStation/task.cgi)
 *     SYNO.DownloadStation2.Task v2  create             (entry.cgi, repli)
 *     SYNO.DownloadStation.Info  v1  getinfo/getconfig  (DownloadStation/info.cgi)
 *     SYNO.FileStation.List      v2  list_share         (entry.cgi)
 *
 * Le SID est passé en paramètre `_sid` et les requêtes partent avec
 * `credentials: "omit"` : pas de cookie DSM, donc pas de SynoToken CSRF à gérer.
 *
 * Ce fichier est chargé en script classique (pas de module) : ses constantes
 * de premier niveau sont visibles depuis background.js, options.js et popup.js.
 */

const SYNO_DEFAULTS = {
    protocol: "https",
    host: "",
    port: 5001,
    username: "",
    password: "",
    deviceId: "",
    destinations: [],
    feedback: "banner",
};

class SynoError extends Error {
    /**
     * `transport` marque un échec survenu avant toute réponse de DSM — NAS
     * injoignable, délai dépassé, envoi annulé. Réessayer une autre URL de
     * la même série ne servirait alors à rien.
     */
    constructor(message, code = null, transport = false) {
        super(message);
        this.name = "SynoError";
        this.code = code;
        this.transport = transport;
    }
}

/** Codes communs à toutes les APIs DSM. */
const ERRORS_COMMON = {
    100: "Erreur inconnue côté DSM",
    101: "Paramètre invalide",
    102: "API absente du NAS (Download Station est-il installé ?)",
    103: "Méthode inexistante",
    104: "Version d'API non supportée par ce DSM",
    105: "Ce compte DSM n'a pas les droits sur Download Station",
    106: "Session expirée",
    107: "Session interrompue par une autre connexion",
    119: "Session invalide (SID refusé)",
};

/** Codes spécifiques à SYNO.API.Auth. */
const ERRORS_AUTH = {
    400: "Identifiant ou mot de passe incorrect",
    401: "Compte DSM désactivé",
    402: "Permissions refusées",
    403: "Double authentification requise : saisissez un code 2FA",
    404: "Code 2FA incorrect",
    406: "Double authentification obligatoire sur ce compte",
    407: "Adresse IP bloquée par le NAS",
    408: "Mot de passe expiré",
    409: "Mot de passe expiré",
    410: "Le mot de passe doit être changé dans DSM",
    411: "Compte verrouillé après trop d'échecs",
};

/** Codes spécifiques à SYNO.DownloadStation.Task. */
const ERRORS_TASK = {
    400: "Échec de l'envoi du fichier",
    401: "Nombre maximum de tâches atteint",
    402: "Destination refusée (droits insuffisants sur le dossier)",
    403: "Le dossier de destination n'existe pas",
    404: "Identifiant de tâche invalide",
    405: "Action invalide",
    406: "Aucune destination par défaut définie dans Download Station",
    407: "Impossible de définir la destination",
    408: "Le fichier n'existe pas",
};

/** Codes renvoyés par une session devenue caduque : on retente une fois. */
const ERRORS_RETRYABLE = [106, 107, 119];

function describeError(code, table) {
    return table[code] || ERRORS_COMMON[code] || `Erreur DSM ${code}`;
}

function synoBaseUrl(settings) {
    return `${settings.protocol}://${settings.host}:${settings.port}/webapi`;
}

/**
 * Motif de permission d'hôte pour ce NAS.
 * Les match patterns WebExtension ignorent le port : ne pas l'inclure.
 */
function synoOriginPattern(settings) {
    return `${settings.protocol}://${settings.host}/*`;
}

async function synoLoadSettings() {
    // `feedback: null` distingue « jamais réglé » de la valeur par défaut,
    // ce qui permet de reprendre l'ancien booléen `notify` une seule fois.
    const settings = await browser.storage.local.get({
        ...SYNO_DEFAULTS,
        feedback: null,
        notify: true,
    });
    if (settings.feedback === null) {
        settings.feedback = settings.notify === false ? "none" : "banner";
    }
    settings.port = Number(settings.port) || 5001;
    if (!Array.isArray(settings.destinations)) {
        settings.destinations = [];
    }
    return settings;
}

/** Traduit l'échec d'un `fetch` : interruption demandée, ou réseau. */
function synoNetworkError(settings, err) {
    const where = `${settings.host}:${settings.port}`;
    if (err.name === "AbortError") {
        return new SynoError("Envoi annulé.", null, true);
    }
    return new SynoError(
        `NAS injoignable sur ${where}. ` +
            "Vérifiez l'adresse et le port, et acceptez une fois le " +
            "certificat du NAS dans Firefox (voir le README).",
        null,
        true
    );
}

/** Une requête vers le NAS, que `signal` permet d'interrompre. */
async function synoRequest(
    settings,
    cgi,
    params,
    { method = "POST", signal = null } = {}
) {
    const url = `${synoBaseUrl(settings)}/${cgi}`;
    const body = new URLSearchParams(params);
    const init = { credentials: "omit", signal };
    let response;

    try {
        if (method === "GET") {
            response = await fetch(`${url}?${body.toString()}`, init);
        } else {
            response = await fetch(url, {
                ...init,
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body,
            });
        }
    } catch (err) {
        throw synoNetworkError(settings, err);
    }

    if (!response.ok) {
        throw new SynoError(`Le NAS a répondu HTTP ${response.status}`);
    }
    return response.json();
}

/* ------------------------------------------------------------------ */
/* Session                                                            */
/* ------------------------------------------------------------------ */

let synoSession = null;

function synoSessionKey(settings) {
    return `${synoBaseUrl(settings)}|${settings.username}`;
}

/**
 * Ouvre une session DSM.
 *
 * Si `otpCode` est fourni, on demande en plus un jeton d'appareil (`did`)
 * que l'on stocke : les connexions suivantes n'auront plus besoin du code 2FA.
 */
async function synoLogin(settings, otpCode = "", signal = null) {
    if (!settings.host || !settings.username) {
        throw new SynoError(
            "Configurez d'abord l'adresse du NAS et le compte DSM."
        );
    }

    const params = {
        api: "SYNO.API.Auth",
        version: "7",
        method: "login",
        account: settings.username,
        passwd: settings.password,
        session: "DownloadStation",
        format: "sid",
    };

    if (otpCode) {
        params.otp_code = otpCode;
        params.enable_device_token = "yes";
        params.device_name = "Firefox SynoDL";
    } else if (settings.deviceId) {
        params.device_id = settings.deviceId;
    }

    const json = await synoRequest(settings, "entry.cgi", params, { signal });
    if (!json.success) {
        const code = json.error && json.error.code;
        throw new SynoError(describeError(code, ERRORS_AUTH), code);
    }
    return { sid: json.data.sid, deviceId: json.data.did || "" };
}

async function synoGetSid(settings, force = false, signal = null) {
    const key = synoSessionKey(settings);
    if (!force && synoSession && synoSession.key === key) {
        return synoSession.sid;
    }

    const { sid, deviceId } = await synoLogin(settings, "", signal);
    if (deviceId && deviceId !== settings.deviceId) {
        await browser.storage.local.set({ deviceId });
    }
    synoSession = { key, sid };
    return sid;
}

function synoResetSession() {
    synoSession = null;
}

async function synoWithSession(settings, callback, signal = null) {
    const sid = await synoGetSid(settings, false, signal);
    try {
        return await callback(sid);
    } catch (err) {
        if (!(err instanceof SynoError) || !ERRORS_RETRYABLE.includes(err.code)) {
            throw err;
        }
        synoResetSession();
        return callback(await synoGetSid(settings, true, signal));
    }
}

/* ------------------------------------------------------------------ */
/* Download Station                                                   */
/* ------------------------------------------------------------------ */

/**
 * Ajoute une tâche de téléchargement.
 *
 * `url` accepte http(s), ftp, magnet, ed2k… `destination` est un chemin
 * relatif à la racine des partages, sans slash initial (ex. `video/Films`).
 * Vide = destination par défaut de Download Station. Interrompre `signal`
 * abandonne l'envoi, quelle que soit l'étape en cours.
 */
async function synoCreateTask(settings, url, destination = "", signal = null) {
    return synoWithSession(
        settings,
        async (sid) => {
            const params = {
                api: "SYNO.DownloadStation.Task",
                version: "1",
                method: "create",
                uri: url,
                _sid: sid,
            };
            if (destination) {
                params.destination = destination;
            }

            const json = await synoRequest(
                settings,
                "DownloadStation/task.cgi",
                params,
                { signal }
            );
            if (json.success) {
                return;
            }

            const code = json.error && json.error.code;
            // Certains DSM récents ne servent plus `create` que via
            // DownloadStation2.
            if ([102, 103, 104].includes(code)) {
                return synoCreateTaskV2(settings, sid, url, destination, signal);
            }
            throw new SynoError(describeError(code, ERRORS_TASK), code);
        },
        signal
    );
}

/**
 * Repli sur SYNO.DownloadStation2.Task.
 * Cette API est déclarée `requestFormat: JSON` : chaque valeur de paramètre
 * doit être du JSON, donc les chaînes portent leurs guillemets.
 */
async function synoCreateTaskV2(settings, sid, url, destination, signal) {
    const params = {
        api: "SYNO.DownloadStation2.Task",
        version: "2",
        method: "create",
        type: JSON.stringify("url"),
        url: JSON.stringify([url]),
        create_list: "false",
        _sid: sid,
    };
    if (destination) {
        params.destination = JSON.stringify(destination);
    }

    const json = await synoRequest(settings, "entry.cgi", params, { signal });
    if (!json.success) {
        const code = json.error && json.error.code;
        throw new SynoError(describeError(code, ERRORS_TASK), code);
    }
}

/** Version de Download Station (`version_string`). */
async function synoGetInfo(settings) {
    return synoWithSession(settings, async (sid) => {
        const json = await synoRequest(
            settings,
            "DownloadStation/info.cgi",
            {
                api: "SYNO.DownloadStation.Info",
                version: "1",
                method: "getinfo",
                _sid: sid,
            },
            { method: "GET" }
        );
        if (!json.success) {
            const code = json.error && json.error.code;
            throw new SynoError(describeError(code, ERRORS_TASK), code);
        }
        return json.data;
    });
}

/** Configuration de Download Station (dont `default_destination`). */
async function synoGetConfig(settings) {
    return synoWithSession(settings, async (sid) => {
        const json = await synoRequest(
            settings,
            "DownloadStation/info.cgi",
            {
                api: "SYNO.DownloadStation.Info",
                version: "1",
                method: "getconfig",
                _sid: sid,
            },
            { method: "GET" }
        );
        if (!json.success) {
            const code = json.error && json.error.code;
            throw new SynoError(describeError(code, ERRORS_TASK), code);
        }
        return json.data;
    });
}

/** Liste des dossiers partagés, sans slash initial. Nécessite File Station. */
async function synoListShares(settings) {
    return synoWithSession(settings, async (sid) => {
        const json = await synoRequest(
            settings,
            "entry.cgi",
            {
                api: "SYNO.FileStation.List",
                version: "2",
                method: "list_share",
                _sid: sid,
            },
            { method: "GET" }
        );
        if (!json.success) {
            const code = json.error && json.error.code;
            throw new SynoError(describeError(code, ERRORS_COMMON), code);
        }
        return (json.data.shares || []).map((share) =>
            share.path.replace(/^\//, "")
        );
    });
}
