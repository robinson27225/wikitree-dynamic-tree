# Notable Relatives

A Tree App view that finds the notable people related to a profile, grouped by how closely they are related, with
filters for category, country, place, notable marker, and name.

**Help page:** [Space:Notable_Relatives](https://www.wikitree.com/wiki/Space:Notable_Relatives). **Version:** shown at
the bottom of the view with links to the author's profile ([Robinson-27225](https://www.wikitree.com/wiki/Robinson-27225))
and the Help page; history in [CHANGELOG.md](CHANGELOG.md).

Open it from any profile's Tree Apps, or go to
`https://apps.wikitree.com/apps/wikitree-dynamic-tree/#name=<WikiTree-ID>&view=notableRelatives`.

**Idea:** Blake Ashton ([Ashton-4458](https://www.wikitree.com/wiki/Ashton-4458)), in an answer posted 7 November 2026
to the G2G question
[WikiTree Days Saturday Question: If you could invent one new WikiTree tool, what would it do?](https://www.wikitree.com/g2g/2105562/wikitree-days-saturday-question-could-invent-wikitree-would?show=2105577#a2105577).
Inspired by Relative Finder, which finds famous relatives on FamilySearch.

## Two searches

### Shared ancestors (default)

Finds notable ancestors, notable descendants, and notable cousins through shared ancestors up to 15 generations
back. You choose 3–15 generations; the default is 12.

1. **Ancestors** come from the WikiTree API, one generation at a time (`getPeople ancestors=g minGeneration=g`).
2. **Notable ancestors** come from one WikiTree+ query, `Ancestors=<ID> NotableProfile`, which covers every
   generation. Those within the chosen generations are named exactly ("6th great-grandfather"). Older ones are
   listed in their own group.
3. **Notable descendants** come from one WikiTree+ query, `Descendants=<ID> NotableProfile`. Their generations come
   from the API.
4. **Notable cousins**: for each generation of ancestors, nearest first, WikiTree+ is asked for their notable
   descendants: `Descendants=A NotableProfile OR Descendants=B NotableProfile …`. These run in batches of about
   3,000 characters. WikiTree+ binds AND tighter than OR, so each ancestor needs its own `NotableProfile`. Each
   notable goes in the group of the first generation it turns up in, which is its **closest shared ancestors**
   ("Shared 7th great-grandparents: up to 8th cousins, some removed"). An older cousin who shares those ancestors
   is a closer cousin, removed: shared 3rd great-grandparents can make a 2nd cousin twice removed.

Results appear group by group as each generation finishes. Stop keeps what has been found so far. Each card's
**Relationship** link opens WikiTree's Relationship Finder for the exact relationship. Working that out here would
mean reading each notable's whole ancestry: about 40 seconds for one royal, and a search can turn up thousands of
notables.

Measured for one member's tree (Robinson-27225, 1,649 ancestors in 12 generations): 1,786 notables by generation 10.
At 15 generations, about 11,000 notables. Time depends on how busy WikiTree+ is: generations 1–10 took 25 seconds
to 2 minutes, and generations 13–15 can add several minutes.

### Within 7 degrees

`CC7=<ID> NotableProfile` from WikiTree+, plus each relative's degree from `getPeople nuclear=d minGeneration=d`.
This search includes in-laws. Some notables appear in WikiTree+'s CC7 that the API's list didn't reach. That
happens when the API, without a login, won't go on past living, privacy-limited profiles. For those, the shortest
path comes from `getConnections`. Relationships are named from the parent links (`kinship.js`). When a marriage link
is closer than the blood link, the marriage comes first, e.g. "husband (also 2nd cousin once removed)".

### Both searches

`NotableProfile` means any notable template, so it includes the `{{Notability}}` template and the Notables Sticker.
The search and filters are kept in the URL hash (`mode`, `gens`, `group`, `cat`, `loc`, `place`, `marker`, `q`), so a
list can be shared. Finished searches are kept in memory, so switching between them is instant.

## Logo

`images/notable-relatives-logo.svg` (on the dark-green tile, shown in the view header) and
`images/notable-relatives-mark.svg` (no tile), with PNG copies at 512, 192 and 32 px for G2G posts or a free-space
page. How it was made: `images/logo.brief.md`.

## Files

| File                   | What it does                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `notableRelatives.js`  | The view: search choice, progress, filters, groups, cards, CSV download           |
| `notable_data.js`      | WikiTree+ and API calls, both searches, records, filters, facets, CSV (no DOM)    |
| `kinship.js`           | Relationship names from parent links or a connection path (no DOM)                |
| `notableRelatives.css` | Styles, all scoped under `.nr-view`                                               |
| `CHANGELOG.md`         | Version history; the newest entry must match `VERSION` in `notable_data.js`       |
| `images/`              | The logo (SVG and PNG) and its brief                                              |
| `test/`                | `node --test views/notableRelatives/test/` (Node 22 or later, nothing to install) |

## Uploading to the Apps server

The app is uploaded from its own folder, `~/code/notable-relatives`, the same way as `~/code/genealogy-report`. That
folder is the whole Tree Apps site (the view needs `tree.js`, `WikiTreeAPI.js`, `index.html` and `index.js`) with this
view and its drafts (`views/notableRelatives/docs/`: the Space page markup, the G2G post, and the Space page images).
The code and tests live in the git repo, `~/code/wikitree-dynamic-tree` (branch `notableRelatives`).

1. After changing the code in the repo, refresh the folder (the tests stay in the repo):

    ```bash
    rsync -a --delete --exclude .git --exclude .github --exclude .claude --exclude node_modules \
      --exclude views/notableRelatives/test ~/code/wikitree-dynamic-tree/ ~/code/notable-relatives/
    ```

2. Upload the contents of `~/code/notable-relatives/` to `apps/robinson27225/notable-relatives/` on the Apps server
   (see [Help:WikiTree Apps Server](https://www.wikitree.com/wiki/Help:WikiTree_Apps_Server)). The
   `views/notableRelatives/docs/` folder holds drafts and does not need to be uploaded.
3. Open `https://apps.wikitree.com/apps/robinson27225/notable-relatives/index.html#view=notableRelatives`, enter a
   WikiTree ID, and click GO. Hard-refresh if the version at the bottom is not the one you uploaded.
