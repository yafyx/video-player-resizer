# Video Player Resizer privacy policy

_Last updated: 2026-08-03_

Video Player Resizer is a browser extension that lets you resize video players
on the page you are viewing. It does not operate a server, send page contents
to a developer, show advertising, or use analytics and tracking services.

## Information the extension handles

To provide its resizing feature, the extension reads the current page's
document structure and video-player geometry locally in the browser. It may
also handle the current site's hostname so that settings can be scoped to that
site. This information is used only to find the player, draw the local resize
controls, and restore the user's choices on a later visit.

The extension stores settings, remembered dimensions, and an optional manual
target path in Chrome extension storage (`storage.sync` for settings and
`storage.local` for page-specific state). These values remain on the user's
device and, where Chrome sync is enabled, are handled by Chrome's sync service
under the user's Google account settings. Video content, page text, account
credentials, cookies, form values, URLs beyond the site key, and browsing
history are not collected or transmitted by Video Player Resizer.

## Sharing and retention

Video Player Resizer does not sell, share, or transfer the information it
handles to the developer or to third parties. The extension keeps stored
settings until the user changes or clears them, uninstalls the extension, or
clears Chrome extension data. The extension has no separate developer-side
account or database from which a user must request deletion.

## Contact

Support contact details will be listed in the Chrome Web Store item before
publication. This policy should be hosted at that public support domain and
entered in the item's Privacy practices tab before submitting the extension.
