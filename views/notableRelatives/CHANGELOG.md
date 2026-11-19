# Changelog

Versions are `0.x` while the app is in beta. The current version is shown at the bottom of the view, next to the links
to the author's profile and the Help page. To release: change `VERSION` in `notable_data.js` and add an entry here (a
test checks they agree), then upload. A fix raises the last number, a new feature the middle one. Documentation-only
changes (README, Space page drafts) don't get a new version.

## 0.3.3 (19 November 2026)

-   **A search too big for WikiTree+ now says so, instead of quietly leaving relatives out.** WikiTree+ stops a
    descendants search once it has gone through about 100,000 descendants, without saying it stopped. Further back,
    the ancestors' descendants add up fast: for one tester, 8 generations went through about 11,000 descendants and
    found 4 notable cousins, while 10 generations reached that limit and lost all 4. The app now reads how far
    WikiTree+ got, and when a search reaches the limit it shows the relatives found with a notice that some are
    missing and that fewer generations back give a complete list. It still sends only one search. Results saved by
    earlier versions are searched again once, so an incomplete one gets its notice. Reported by Kerstetter-367.

## 0.3.2 (18 November 2026)

-   **When WikiTree+ blocks your internet connection, the message says so and how to fix it.** WikiTree+ blocks some
    ranges of internet addresses because of AI-bot traffic and answers them with a block page (HTTP 429), which the
    reader never saw. The app now tells that apart from WikiTree+ just being busy, explains it, shows the internet
    address the block page names (only on screen; it is never saved), and offers a **Message Aleš to be unblocked**
    link to WikiTree's private message page for Aleš Trtnik, who runs WikiTree+ and unblocks members who ask. The
    reason is repeated while the app rests. Reported by James Wall (Wall-6242).

## 0.3.1 (18 November 2026)

Fixes and a request from testing 0.3.0.

-   **Cousin cards show the exact relationship**, such as "2nd cousin twice removed", instead of "cousin through
    shared ancestors" (requested by Azure Robinson). It comes from WikiTree's shortest path through a common
    ancestor, as the Relationship Finder counts it, one paced WikiTree call per card on screen, and is saved with the
    result. A cousin whose path WikiTree cannot show (for example through a private profile) keeps the general label.
-   **Logged in, but your own private profile still came back private.** The Tree Apps showed "Logged into Apps"
    from a cookie on the Apps site even after WikiTree's own login had run out, so WikiTree treated the search as
    logged out. The Tree Apps now confirm the login with the API's `checkLogin` and show the Apps Login button again
    when it has run out (shared with all Tree Apps). Notable Relatives checks too before explaining a private
    profile, and never tells you to add yourself to your own Trusted List. Reported by Raitt-92.
-   **A search that cannot finish now says why in the results area**, not only in the red bar at the top of the page,
    which was easy to miss, so it looked as if the search just stopped without a count. Reported by James Wall
    (Wall-6242).
-   **When WikiTree+ turns a search away, the message says what it answered** (for example "too many requests",
    which usually means it is busy) and offers **Try WikiTree+ now** straight away. The rest after a refusal is now
    5 minutes instead of 15.

## 0.3.0 (18 November 2026)

Easier on WikiTree+ (one search per look), a choice of what to find, and more requests from testers.

-   **One WikiTree+ request per search**, `descendants="id,id,..." NotableProfile` (or
    `ancestors="id" NotableProfile` for ancestors only), instead of a request for each generation. Only the
    furthest-back ancestors on each line are listed, one partner of each couple, since everyone descended from a
    child is descended from that child's parents and a couple shares its descendants (suggested by Azure Robinson).
    Each list includes the people named in it, so the same answer holds the notable ancestors. WikiTree+ addresses
    no longer carry the old `Format` parameter, and a list too long for a web address is sent by POST.
-   **One WikiTree API call** gets the starting profile, its ancestors, and its descendants, when they fit in one
    answer (up to 1,000 relatives, enough for 8 generations in most trees). A bigger family is asked for a generation
    at a time. "Everyone within 7 degrees" also tries one call first.
-   **Choose what to find:** ancestors, descendants, and cousins (the default); ancestors only; or descendants and
    cousins only (requested by Azure Robinson). A narrower choice asks WikiTree+ a smaller question.
-   **Notable ancestors stay within the chosen generations** (requested by Azure Robinson). The separate
    "Older ancestors" group is gone.
-   **Cousins are one group,** "Notable cousins": a single answer cannot say which generation of shared ancestors
    each cousin comes from. Each card's Relationship link gives the exact relationship.
-   **Relatives by marriage link to the Connection Finder.** WikiTree's Relationship Finder follows blood lines
    only, so it came up empty for a notable related by marriage. Those cards now have a **Connection** link to
    WikiTree's Connection Finder, which follows marriages too; blood relatives keep the **Relationship** link.
    Suggested by J Palotay (Palotay-1).
-   **Clearer when WikiTree+ is unavailable.** After WikiTree+ turns a search away, the app gives it a rest for 15
    minutes. During that rest it now says that no search was sent, when the rest ends, and offers "Try WikiTree+
    now", instead of an error that looked as if WikiTree+ had just refused. The app also never sends an empty search
    (for example Biological when both birth parents are private), which WikiTree+ answered with an error that was
    taken for a refusal.
-   **Saved results follow WikiTree+'s weekly data:** they are kept until its data changes (checked with its tiny
    DataDates.json file, and never more than 8 days), instead of a fixed week. Only what WikiTree+ found is saved;
    names, dates, and places are read again from WikiTree when the result is shown (Help:App Policies). The list of
    all notable profiles is kept the same way.
-   **WikiTree API requests are paced** at least 300 ms apart, under the API's limit of 200 a minute per user
    (Help:App Policies). A WikiTree+ answer cut off at its profile limit now marks the search as incomplete.
-   **Starting profile lookup** (shared with all Tree Apps): the Tree Apps now check the WikiTree ID with
    getRelatives instead of getPerson. The messages for an unknown ID are unchanged.

## 0.2.0 (18 November 2026)

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
-   **Gentler on WikiTree+.** WikiTree+ had to block the app after it sent many heavy Descendants searches at once
    (reported by Aleš Trtnik, Trtnik-2). Now the app sends one WikiTree+ request at a time with a pause between,
    lets a request finish instead of abandoning it (so a new search never piles on top of an old one), never resends
    a failed search, asks about at most 20 ancestors per request, stops at once if WikiTree+ refuses, and waits for
    the generations box to settle before searching. The default is now 8 generations back instead of 12.
-   **Results are saved in this browser for a week**, so looking at the same person again asks WikiTree+ nothing.
    "Search again" asks afresh. The list of all notable profiles is saved for a day.
-   **Private starting profiles** now get the same message as the other Tree Apps: "Try the Apps Login" when logged
    out, or the Trusted List when logged in, instead of "WikiTree did not return the starting profile."
-   **More reliable long searches:** private relatives no longer end the ancestor search early; passing WikiTree
    server errors are retried; whatever goes wrong part way, the relatives already found stay on the page with a
    note; Stop works from the very start; "Everyone within 7 degrees" has a Stop button and keeps a partial list.
-   **Fixes:** the Biological / Adoptive / Both choice and generations now follow the chosen parents; a filter in a
    shared link that doesn't apply no longer hides everything; reopening a saved result no longer shows the previous
    person's parent choice; the notable descendants' generations are found without walking every descendant.
-   **Apps Login** (shared with all Tree Apps): a failed sign-in now shows the Apps Login button again instead of
    leaving the page silently logged out.
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
