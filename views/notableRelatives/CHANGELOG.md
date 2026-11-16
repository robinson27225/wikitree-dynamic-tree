# Changelog

Versions are `0.x` while the app is in beta. The current version is shown at the bottom of the view, next to the links
to the author's profile and the Help page. To release: change `VERSION` in `notable_data.js` and add an entry here (a
test checks they agree), then upload. A fix raises the last number, a new feature the middle one. Documentation-only
changes (README, Space page drafts) don't get a new version.

## 0.2.0 (Not yet released)

Fixes and requests from the first testers on G2G.

-   **Everyone within 7 degrees now finds notables reached through a private profile.** WikiTree+'s own CC7 list stops
    at private profiles, so a notable 5 degrees away through a living spouse could be missed, logged in or not. The app
    now matches everyone within 7 degrees against WikiTree+'s list of all notable profiles. Reported by J Palotay
    (Palotay-1) and Helena Dalroth (Dalroth-3).
-   **"Direct line only" button** in the shared ancestors search shows just the notable ancestors and descendants, with
    no cousins. Requested by A. Groesser.
-   **Biological, Adoptive, or Both** for an adopted starting profile, as in the Genealogy Report. When the profile
    has birth parents recorded beside the parents it lists, a "Parents followed" choice appears in the shared
    ancestors search. Both is the default. Asked about by Patty LaPlante.
-   **Ancestors with accented, hyphenated, or apostrophe surnames are now searched.** WikiTree+ split a WikiTree ID
    such as "Söderblom-7", "Szent-Györgyi-4", or "O'Brien-1" and found nothing, so their notable relatives were
    silently missed. The searches now use each profile's number instead.
-   **Dropped connections no longer end a long search.** When the internet connection drops ("Failed to fetch"), the app
    tries again twice, and if it still fails it keeps the relatives found so far and says what happened. Reported by
    Debra Akin.

## 0.1.0 (16 November 2026)

The first version, for testers. Idea by Blake Ashton (Ashton-4458) on G2G, 7 November 2026, inspired by Relative
Finder.

-   **Shared ancestors search** (the default): notable ancestors, notable descendants, and notable cousins through shared
    ancestors up to 15 generations back (12 by default). Cousins are grouped by their closest shared ancestors, nearest
    first ("Shared 3rd great-grandparents: up to 4th cousins, some removed"). Results show as each generation is
    searched, with Stop and "Show more".
-   **Everyone within 7 degrees**: the CC7, in-laws included, grouped by degree, with relationships named from the
    parent links ("great-uncle", "husband (also 2nd cousin once removed)").
-   A card for each person with photo, dates, places, notable template, country, categories, and a **Relationship**
    link to WikiTree's Relationship Finder.
-   Filters by group, category, country, place, notable template, and name, kept in the address so a list can be
    shared. CSV download.
-   Logo (a gold star in a family tree) in the view header.
-   If WikiTree starts limiting requests ("Limit exceeded.") part way through a long search, the relatives found so
    far stay on screen with a note to wait a few minutes; a refused batch of profiles is reported, never dropped
    silently.
-   **Apps Login fix (shared Tree Apps code, `index.js` and `tree.js`):** the Apps Login button and the login check
    after signing in now send an app name. Without one, the WikiTree API answers `[{ "status": "Limit exceeded." }]`
    (HTTP 429) and the login never starts.
-   Version, **Created by Robinson-27225** (links to the author's profile), and **Help** (links to
    [Space:Notable_Relatives](https://www.wikitree.com/wiki/Space:Notable_Relatives)) at the bottom of the view.
