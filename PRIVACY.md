# Privacy: Shoo for YouTube

Shoo sends nothing to anyone. What it keeps, it keeps in Chrome on your device.

- Your list of channels and words is saved in Chrome's local extension storage (`chrome.storage.local`) on your device. It is not synced and not uploaded. A channel entry holds the channel's name, @handle and channel ID, whichever are known, and when and how it was added.
- When Shoo sees a channel from your list by its @handle or ID, it updates that entry on its own, so the entry still matches after a rename. This happens on a video card that links to the channel (not on collabs) and on the channel's own page. Shoo writes the channel's current name into the entry and adds the @handle or ID if it is missing. A card with one @handle link and one ID link fills in both. Nothing else from the page goes into your list: no video titles, no page addresses, no watch history.
- For each open tab, Shoo keeps the state of its "!" badge in Chrome's session extension storage (`chrome.storage.session`). That is the page type (for example search or a video page), where its check failed, and when it checked. This is dropped when the tab reloads or closes, and Chrome clears it when the browser closes.
- The extension makes no network requests: no analytics, no remote configuration, no filter lists from the internet.
- On youtube.com it reads the page itself: links, channel names and video titles, to decide what to hide. On a channel page it also reads the channel's ID from the page's HTML (the `<meta itemprop="identifier">` tag). That ID isn't shown on screen. Shoo doesn't read the data YouTube's scripts load (such as `ytInitialData`), change network responses, or touch the player.
- Export writes a file only when you press Export. Import reads only the file or text you give it.
- "Report a problem" in the menu opens a Google Form. Its link already carries four values Shoo fills in:
  - Shoo's version;
  - your browser's name and version, and Chrome's language;
  - the type of page you were on, for example search, a video page or Home;
  - where Shoo found a problem, if it found one: search results, Subscriptions, Home or next to the player.

  The fifth field is what you write. The form doesn't ask for your email. Shoo sends none of this itself. Opening the form loads Google's page with those four values in its address, and your report is saved only when you press Submit. Google's privacy policy applies to the form.

Permissions: `storage` (to keep your list) and `https://www.youtube.com/*`. The YouTube access lets Shoo hide cards on YouTube and lets the menu check that the current tab is YouTube. It also lets the welcome page find YouTube tabs you opened before installing Shoo and reload them when you press its button. Shoo doesn't store or send the addresses or titles of your tabs.
