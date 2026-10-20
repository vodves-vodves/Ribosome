# Ribosome privacy policy

**English** · [Русский](PRIVACY.ru.md)

Effective October 21, 2026.

Ribosome is a browser extension that translates text on web pages. It has no servers of its own, no accounts, no analytics and no ads. The developer receives no data from it.

## What leaves your device

To translate, Ribosome sends text to Google Translate (`translate.googleapis.com`). It sends only the text you ask it to translate:

- text you select and translate;
- text you type or paste in the toolbar popup;
- the text of a page you translate, piece by piece as it comes near the screen. This includes sites you set to *Always translate this site*.

Nothing else is sent: no addresses of the pages you visit, no browsing history, no identifiers. Google handles these requests under the [Google Privacy Policy](https://policies.google.com/privacy).

When a page is in another language, Ribosome offers to translate it. The page language for this offer is detected inside your browser (`chrome.i18n.detectLanguage`). No text leaves your device until you click *Translate*.

## What stays in your browser

- **Settings** (languages, how the translation window opens, the list of sites to always translate, whether to offer translation) are kept in `chrome.storage.sync`. If you use Chrome sync, your browser syncs them between your devices through your Google account.
- **Recent translations** and the sites where you hid the offer are kept in `chrome.storage.session` and are cleared when the browser closes.
- **The position of the on-page bar** is kept in `chrome.storage.local`.

Removing the extension removes all of this.

## Permissions

- `storage`: keeps the settings and data listed above.
- `contextMenus`: adds the right-click items *Translate page*, *Always translate this site* and *Translate "…"*.
- Access to `translate.googleapis.com`: sends text to Google Translate.
- A content script on all sites: shows the translate icon and window next to a selection, translates a page when you ask, and offers translation on pages in another language. It does not read pages for any other purpose.

## Selling and sharing

Ribosome does not sell data, does not share it with anyone except Google Translate as described above, and does not use it for anything other than translation.

## Changes and contact

Changes to this policy are published in this file, with the history kept in the [repository](https://github.com/vodves-vodves/Ribosome/commits/main/PRIVACY.md). Questions: [open an issue](https://github.com/vodves-vodves/Ribosome/issues).
