# Chrome Web Store listing

Text and images for the [developer dashboard](https://chrome.google.com/webstore/devconsole). The same set works for [Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge/).

Package: `ribosome-<version>-chrome.zip` from the [latest release](https://github.com/vodves-vodves/Ribosome/releases/latest), or `npm run zip`.

## Store listing

The name and the summary under it come from the manifest (`extName` and `extDescription` in `shared/locales`).

- **Category:** Productivity › Tools
- **Languages:** English (default), Russian
- **Homepage URL:** https://github.com/vodves-vodves/Ribosome
- **Support URL:** https://github.com/vodves-vodves/Ribosome/issues

### Graphics

Per language, from `docs/store/en/` and `docs/store/ru/`:

| Field | File |
|---|---|
| Store icon, 128×128 | `public/icon/128.png` |
| Screenshots, 1280×800 | `1-select.png`, `2-pin.png`, `3-page.png`, `4-offer.png`, `5-popup.png` |
| Small promo tile, 440×280 | `promo-440x280.png` |
| Marquee promo tile, 1400×560 | `promo-1400x560.png` |

### Description · English

```
Ribosome translates text right where you read it. Select a phrase and its translation appears in a small glass window beside it: no new tab, no copy and paste. Or translate the whole page in place.

TRANSLATE A SELECTION
• Select text and click the small icon next to it, or have the window open as soon as you select.
• Pin windows to keep them on screen while you read on, and drag them anywhere.
• Click a pinned window's source line to jump back to the original text.

TRANSLATE THE WHOLE PAGE
• Right-click › Ribosome › Translate page, press Alt+T, or use the button in the toolbar popup.
• The text is replaced in place: the layout, links and buttons keep working. What's on screen goes first, the rest follows as you scroll, and new posts in a feed are translated as they appear.
• Code, form fields and editable areas are left as they are.
• On a page in another language, a small bar offers to translate it. Tick "Always translate this site" and the site is translated every time you open it.

MORE
• A second language: text that is already in your language is translated into your second language.
• The toolbar popup translates anything you type or paste.
• Light and dark theme, English and Russian interface, 41 languages.
• Free, no account, no API key. When Google limits requests, Ribosome pauses, shows a countdown and retries on its own.

PRIVACY
Ribosome sends only the text you ask to translate to Google Translate. No accounts, analytics or tracking. The page language for the offer is detected inside your browser.

Open source: https://github.com/vodves-vodves/Ribosome
```

### Description · Russian

```
Ribosome переводит текст прямо там, где вы читаете. Выделите фразу, и перевод появится рядом в небольшом стеклянном окне: без новой вкладки и без копирования. Или переведите всю страницу на месте.

ПЕРЕВОД ВЫДЕЛЕННОГО
• Выделите текст и нажмите на значок рядом, или включите, чтобы окно открывалось сразу после выделения.
• Закрепляйте окна, чтобы они оставались на экране, пока вы читаете дальше, и перетаскивайте куда угодно.
• Нажмите на исходную строку закреплённого окна, и страница прокрутится к этому месту в тексте.

ПЕРЕВОД ВСЕЙ СТРАНИЦЫ
• Правая кнопка › Ribosome › Перевести страницу, Alt+T или кнопка во всплывающем окне.
• Текст заменяется на месте: вёрстка, ссылки и кнопки продолжают работать. Сначала переводится то, что на экране, остальное по мере прокрутки, а новые посты в ленте переводятся, как только появляются.
• Код, поля ввода и редактируемые области не трогаются.
• На странице на другом языке небольшая плашка предлагает её перевести. Отметьте «Всегда переводить этот сайт», и сайт будет переводиться при каждом открытии.

ЕЩЁ
• Второй язык: текст, который уже на вашем языке, переводится на второй язык.
• Всплывающее окно переводит всё, что вы впишете или вставите.
• Светлая и тёмная тема, интерфейс на русском и английском, 41 язык.
• Бесплатно, без аккаунта и ключа API. Когда Google ограничивает запросы, Ribosome делает паузу, показывает обратный отсчёт и повторяет сам.

ПРИВАТНОСТЬ
Ribosome отправляет в Google Translate только текст, который вы попросили перевести. Никаких аккаунтов, аналитики и слежки. Язык страницы для предложения перевести определяется внутри браузера.

Открытый код: https://github.com/vodves-vodves/Ribosome
```

## Privacy practices

**Single purpose**

```
Translate text on web pages: a selection, text typed in the popup, or the whole page in place.
```

**Permission justification**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings (languages, how the translation window opens, sites to always translate, whether to offer translation), a cache of recent translations that is cleared when the browser closes, and the position of the on-page bar. |
| `contextMenus` | Adds the right-click items "Translate page / Show original", "Always translate this site" and "Translate the selected text". |
| Host permission `translate.googleapis.com` | Sends the text the user asks to translate to Google Translate and receives the translation. No other server is contacted. |
| Content script on all sites | Shows the translate icon and window next to a selection, translates a page in place when the user asks or has set the site to always translate, and offers translation on pages in another language. It runs on all sites because the user can select text or translate a page on any site. |

**Remote code:** No, I am not using remote code.

**Data usage:** check only **Website content**. The text the user selects, types in the popup, or of a page they translate is sent to Google Translate to produce the translation. Leave every other category unchecked.

Certify all three statements: not sold to third parties, not used for purposes unrelated to the single purpose, not used to determine creditworthiness.

**Privacy policy URL:** https://github.com/vodves-vodves/Ribosome/blob/main/PRIVACY.md

## Account and distribution

- **Account:** verify the contact email. Trader status: non-trader (a free extension made by an individual).
- **Distribution:** Public, all regions, free.
