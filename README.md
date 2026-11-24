# Shoo for YouTube

Block YouTube channels and title keywords you choose. Imports BlockTube and Channel Blocker lists.

Free, open source (GPL-3.0), Chrome only for now. [Install from the Chrome Web Store](https://chromewebstore.google.com/detail/pcihlbcfalicbiclgcfndjhigpeffbcl)

## What it does

- Hover a video in search results or next to the player and press ⊘. Every video from that channel is hidden on the page at once, and stays hidden on later pages. Playlists and mixes you open are the exception: Shoo leaves them as they are, on the playlist page and in their list next to the player. Videos from that channel can still show up and play there. The slot shows "Shoo hid videos from <channel>" and Undo.
- Home and Subscriptions use the same cards; they have not been checked with a signed-in account yet.
- On a watch page or a channel page, "Hide this channel's videos" sits next to Subscribe. The video keeps playing.
- Words: add plain words or phrases. They are matched against video titles only. A word also hides longer words that start with it ("alpha" hides "alphas"). Words of 3 letters or fewer match whole words only ("AI" hides "AI tools", not "air"). No regex.
- Collabs ("A and B"): hidden if any channel whose name YouTube shows matches.
- In the popup, "Show hidden on this page" brings the hidden videos back dimmed, each with its reason and a button that takes that channel or word off your list.
- Import from BlockTube (`blocktube_backup.json`), Channel Blocker (`.save`), a plain list, or Shoo's own export. A plain list has one `@handle`, channel ID, `youtube.com/@handle` or `youtube.com/channel/UC…` link, or name per line; other YouTube links, such as video links, are skipped. Imports always merge. "Undo import" takes back only that import: the channels and words it added, and the names, @handles or IDs it filled into channels you already had. What you added since stays.
- If YouTube changes its pages so that Shoo can't tell channels apart, or a hidden channel shows up again, the toolbar icon shows "!".

## What it can't do

- Next to the player and in collabs, YouTube shows only a channel's name, not a link. There Shoo compares names: it may also hide another channel with the same name, and it misses a renamed channel until it sees it in search.
- The Shorts shelf in search shows only titles, so only words work there.
- Channels with an ID but no name are matched where YouTube shows channel IDs (hashtag pages, a few search cards) until Shoo sees their name. To teach it sooner, open the channel from Shoo's list page: on the channel's page Shoo learns its name.
- It doesn't hide comments, Shorts in the Shorts player, or single videos. It doesn't detect AI videos.

## Privacy

The list stays in Chrome's local storage on your device. The extension makes no network requests and has no analytics. It reads the page's HTML: links, names and titles, plus the channel ID tag on a channel page. It never touches the data YouTube's scripts load, network responses or the player. Permissions: `storage` and `https://www.youtube.com/*`. See [PRIVACY.md](PRIVACY.md).

## Develop

```
npm install
npm test          # logic, locales, manifest, store limits
npm run build     # dist/chrome (load unpacked) + dist/shoo-chrome-<version>.zip
npm run e2e       # live YouTube in Chrome for Testing, signed out
```

YouTube refuses playback in automation, so checks that need a playing video are reported as NOT TESTABLE and are done by hand.

## License

GPL-3.0. See [LICENSE](LICENSE).
