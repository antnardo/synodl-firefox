# SynoDL — Firefox extension for Synology Download Station

Right-click a link in Firefox → the file starts downloading on the Synology
NAS, without going through the DSM interface or your computer.

Works with `http(s)`, `ftp`, `magnet` and `ed2k` links, on page links as well
as images, videos and audio, or on a URL simply selected in text.

---

## Requirements

- Firefox 142 or newer.
- Download Station installed and running on the NAS (DSM 7).
- A DSM account allowed to use Download Station.

The extension relies on these APIs, all of which a DSM 7 with Download Station
exposes:

```text
SYNO.API.Auth               entry.cgi
SYNO.DownloadStation.Task   DownloadStation/task.cgi
SYNO.DownloadStation2.Task  entry.cgi
SYNO.FileStation.List       entry.cgi   (optional, lists shared folders)
```

To check what your own NAS publishes, no credentials needed:

```bash
curl -sk "https://YOUR-NAS:5001/webapi/query.cgi?api=SYNO.API.Info\
&version=1&method=query&query=SYNO.DownloadStation.Task,SYNO.DownloadStation2.Task"
```

---

## Step 0 — trust the NAS certificate

**Do this before anything else, or nothing will work.**

DSM is served over HTTPS (port `5001` by default, often changed) with
Synology's factory self-signed certificate — `CN=synology.com`, issued by
`Synology Inc. CA`. Firefox rejects it by default, and an extension request
then fails silently: there is no warning page to click through.

So the exception has to be created once, by hand:

1. Open `https://YOUR-NAS:5001` in a Firefox tab, substituting your own
   address and port.
2. Click **Advanced…** then **Accept the Risk and Continue**.

The exception is stored in the Firefox profile and applies from then on to
every request the extension makes. It survives restarts.

> Cleaner alternative: install a valid certificate on the NAS — Let's Encrypt,
> either straight from DSM or through a reverse proxy — and point the extension
> at the matching domain name. Step 0 then becomes unnecessary.

---

## Installation

### From the release — the normal route

1. Download the `.xpi` from the [latest
   release](https://github.com/antnardo/synodl-firefox/releases/latest).
2. Drag it into a Firefox window and confirm the installation.

The archive attached to releases is signed by Mozilla, so the installation is
permanent on any Firefox edition, and from 1.2.0 onward Firefox picks up new
versions on its own (see [Updates](#updates)).

Then carry on with [configuration](#configuration).

#### Updates

A self-distributed add-on is signed by Mozilla but not hosted by it, so
Firefox's usual update check comes back empty. The manifest therefore carries
an `update_url` pointing at `updates.json`, a small file attached to every
release and reachable at a URL that always resolves to the newest one:

```text
https://github.com/antnardo/synodl-firefox/releases/latest/download/updates.json
```

Firefox fetches it periodically, compares the version it lists against the
installed one, and offers the `.xpi` it links to. A tampered file cannot push
arbitrary code: Firefox still requires the archive to carry a valid Mozilla
signature for this exact add-on ID, which only the owning AMO account can
obtain.

Versions up to 1.1.0 shipped without `update_url` and will never check for
anything — installing 1.2.0 by hand once is what starts the mechanism.

### Temporary load — for development

The add-on loads without a signature, and disappears when Firefox restarts.

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…**
3. Pick the `manifest.json` file in this folder.

This is also where the logs are read, through the **Inspect** button.

### Signing your own build — if you modify the code

Firefox Release and Beta editions refuse to permanently install an unsigned
extension, so a fork or a local change has to go through signing again. Two
routes are available.

**A. Mozilla signature, self-distributed** — free, the extension is not
published in the public catalogue and gets no human review. It needs a Mozilla
account, with two-factor authentication mandatory for add-on developers.

1. Build the archive:

   ```bash
   ./build.sh
   ```

2. On the addons.mozilla.org developer hub, choose **On your own**, and upload
   the resulting `dist/synodl-<version>.xpi`.
3. Download the signed `.xpi`, then drag it into a Firefox window.

Before uploading, **change the identifier** in `manifest.json`
(`browser_specific_settings.gecko.id`): the original one belongs to this
repository's AMO account and will be rejected. Also bump `version` on every
upload, since AMO refuses the same number twice.

Validate the way AMO does, using the current linter — a pinned version carries
older compatibility data and lets warnings slip through:

```bash
npx web-ext@latest lint --source-dir=. --self-hosted --ignore-files "dist/**" "build.sh"
```

**B. Disable signature enforcement** — only possible on Firefox Developer
Edition, Nightly or ESR: in `about:config`, set
`xpinstall.signatures.required` to `false`. No effect on the Release edition.

### Releasing

Publishing is handled by [a GitHub Actions
workflow](.github/workflows/release.yml): pushing a tag validates the package,
has Mozilla sign it, and attaches the signed `.xpi` to a GitHub release.

```bash
git tag -s v1.2.0 -m "SynoDL 1.2.0"
git push --follow-tags
```

The tag must match `version` in `manifest.json`, or the run stops before
anything is published — as it does if the credentials below are missing, or if
the package fails validation. Nothing reaches AMO until all three checks pass.

#### AMO API credentials

The workflow uploads to AMO on your behalf, which takes an API key pair issued
by Mozilla. Generate one at **Manage API Keys** in the developer hub
(`addons.mozilla.org/developers/addon/api/key/`), signed in as the account
that owns the add-on. The page gives you two values:

| Field on the AMO page | Repository secret | Shape |
| --- | --- | --- |
| JWT issuer | `AMO_JWT_ISSUER` | `user:18294746:492` |
| JWT secret | `AMO_JWT_SECRET` | 64 hexadecimal characters |

**The JWT secret is displayed once, when you generate it**, and cannot be read
back afterwards. Copy it into a password manager straight away. Losing it is
not serious — revoke the pair and generate another — but the old one stops
working the moment you do.

Treat it as a credential: it carries the right to publish versions of your
add-ons. Store it in the repository, never in the working tree:

```bash
gh secret set AMO_JWT_ISSUER
gh secret set AMO_JWT_SECRET
```

Both commands prompt for the value with the input hidden, so the secrets reach
GitHub without passing through the shell history. Check the result with
`gh secret list` — it prints the names and dates, never the values, which
GitHub itself cannot show again either.

---

## Configuration

Extension settings (`about:addons` → SynoDL → Preferences):

| Field | Example |
| --- | --- |
| Protocol | `https` |
| Address | `192.168.1.20`, or the NAS hostname |
| Port | `5001`, or whichever DSM port you set |
| Username / password | a dedicated DSM account (see below) |
| 2FA code | only if the account requires it, once |
| Destinations | one path per line, e.g. `video/Films` |
| Confirmation | in-page banner, system notification, or none |

The **List shared folders** button queries File Station and offers the shares
in one click. **Test connection** exercises the whole chain and reports the
Download Station version along with its default destination.

On save, Firefox asks permission to contact the host you entered. That is
expected: the extension cannot know the NAS address in advance, so it requests
no host permission at install time.

> The extension interface is currently French-only. This README is the English
> reference for what each control does.

### Destinations

Paths are relative to the root of the shares, with no leading slash
(`video/Films`, not `/volume1/video/Films`). The first one in the list is the
one offered at the top of the menu.

- No destination: a single context-menu entry, and the NAS files the download
  under Download Station's own default destination.
- One destination: a single entry, using it.
- Several destinations: a submenu, ending with the NAS default folder.

### Two-factor authentication

If the DSM account enforces a 2FA code, enter one once in the settings: the
extension then asks DSM for a device token (`enable_device_token`) and keeps
it. Later logins no longer need a code.

---

## Usage

- **Right-click a link** → *Send to Download Station* (with the destination
  submenu when there is more than one).
- **Right-click a selected URL** → same thing, the URL is extracted from the
  text.
- **Toolbar button** → paste several links at once, one per line, or pull in
  the current tab's URL.

A banner slides in at the top right of the page the moment you click,
showing a spinner while the request is in flight, then turning green on
success or red with the reason DSM returned. It closes on its own — sooner on
success than on failure — and immediately if you click it.

Where Firefox forbids script injection — `about:` tabs, the built-in PDF
viewer, addons.mozilla.org — the banner cannot be drawn and the extension
falls back to a system notification on its own. The **Confirmation** setting
switches to notifications everywhere, or turns success reports off entirely;
failures are always reported either way.

---

## Security

The DSM password is stored **in clear text** in the extension's local storage,
inside the Firefox profile. That is the limit of the approach: an extension
has no encrypted vault at its disposal.

The practical consequence: create a **dedicated user** in DSM, in a group that
can reach nothing but Download Station and can write only to the destination
folders. No administrator account, no account reused elsewhere.

The extension requests no host permission at install time; it asks only for
the NAS you entered, at the moment you save the settings. No data leaves the
local network.

---

## How it works

| Aspect | Choice |
| --- | --- |
| Manifest | v3, event background page (`background.scripts`) |
| Authentication | `SYNO.API.Auth` v7, `format=sid`, over POST |
| Session | SID passed as the `_sid` parameter, `credentials: "omit"` |
| Task creation | `SYNO.DownloadStation.Task` v1 `create` |
| Fallback | `SYNO.DownloadStation2.Task` v2 when the v1 API is absent |
| Folders | `SYNO.FileStation.List` v2 `list_share` |
| Banner | `scripting.executeScript` into the active tab, shadow DOM |

A few points that explain the code:

- Requests carry no cookie (`credentials: "omit"`) and authenticate through
  `_sid` alone. DSM then does not apply its CSRF protection, which spares us
  having to handle a `SynoToken`.
- The password travels in a POST body, never in a URL.
- The NAS declares `SYNO.DownloadStation2.Task` as `requestFormat: JSON`:
  every parameter value must be JSON, so strings carry their quotes
  (`type="url"`, not `type=url`). That is the classic trap with this API, and
  the reason the fallback is written separately.
- WebExtension match patterns ignore ports: for a NAS at
  `https://192.168.1.20:5001`, the extension requests
  `https://192.168.1.20/*`, without the port.
- An expired session (DSM codes 106, 107, 119) triggers a reconnection and one
  single retry.
- The banner lives in a shadow root, and the critical display properties of
  its host element are set inline with `!important` — otherwise a page rule
  targeting the host's id could hide it outright.
- Injecting into the active tab needs no broad host permission: clicking a
  context-menu entry grants `activeTab` for that tab, which is what
  `scripting.executeScript` runs on.

### Layout

```text
synodl/
├── manifest.json
├── build.sh              Packages the .xpi
├── icons/
│   ├── icon.svg          Source, not shipped in the package
│   └── icon-{48,96,128}.png
└── src/
    ├── syno.js           DSM API client (auth, tasks, shares)
    ├── background.js     Context menu, sending, notifications
    ├── options.html/.js  Settings
    ├── popup.html/.js    Manual sending from the toolbar
    └── style.css         Light and dark themes
```

Regenerate the icons after editing the SVG:

```bash
cd icons
for s in 48 96 128; do
    rsvg-convert -w "$s" -h "$s" icon.svg -o "icon-$s.png"
done
```

---

## Troubleshooting

- **NAS unreachable** — certificate not trusted (step 0), wrong address or
  port, or you are not on the local network.
- **Wrong username or password** — incorrect DSM account.
- **Two-factor authentication required** — enter a 2FA code once in the
  settings.
- **IP address blocked by the NAS** — DSM auto-block after repeated failures,
  cleared under Control Panel › Security › Account.
- **Account lacks Download Station rights** — add the account to the allowed
  group in DSM.
- **Destination folder does not exist** — misspelled path, or a stray leading
  slash.
- **Destination denied** — the account cannot write to that folder.
- **API missing from the NAS** — Download Station not installed, or stopped.

The extension logs show up in `about:debugging` → **Inspect** next to SynoDL.

---

## Status

Version 1.0.1 is signed by Mozilla and distributed through the
[releases](https://github.com/antnardo/synodl-firefox/releases). The package
passes AMO validation with no errors and no warnings, and the whole chain —
DSM login, context menu, task creation — has been verified against a DS920+
running DSM 7.3.

---

## License

MIT — see [LICENSE](LICENSE).

SynoDL is an independent project, unaffiliated with Synology Inc. "Synology"
and "Download Station" are trademarks of their respective owners.
