# Notable Relatives

A Tree App view that lists the notable people within 7 degrees (CC7) of a profile, grouped by degree, with filters
for category, country, place, notable marker, and name.

Open it from any profile's Tree Apps, or go to
`https://apps.wikitree.com/apps/wikitree-dynamic-tree/#name=<WikiTree-ID>&view=notableRelatives`.

**Idea:** Blake Ashton ([Ashton-4458](https://www.wikitree.com/wiki/Ashton-4458)), in an answer posted 7 November 2026
to the G2G question
[WikiTree Days Saturday Question: If you could invent one new WikiTree tool, what would it do?](https://www.wikitree.com/g2g/2105562/wikitree-days-saturday-question-could-invent-wikitree-would?show=2105577#a2105577)

## How it works

1. **WikiTree+** finds the notable profiles: `CC7=<WikiTree-ID> NotableProfile`. `NotableProfile` means any notable
   template, so it includes every profile with the `{{Notability}}` template and every profile with a Notables
   Sticker. WikiTree+ returns profile ids only, and its data is a few days behind WikiTree.
2. **WikiTree API `getPeople`** lists the CC7, one degree at a time (`nuclear=d`, `minGeneration=d`). Each relative's
   degree comes from `Meta.Degrees`, and their parents come from `Father`/`Mother`. Asking one degree at a time
   matters: a single paged request for all 7 degrees skips people, because getPeople keeps no fixed order between
   pages.
3. **`getPeople`** again, for the notables only, gets names, dates, places, photos, `Categories` and `Templates`.
4. Some notables appear in WikiTree+'s CC7 but not in the API's list. This happens when the API, without a login,
   does not go on past living, privacy-limited profiles. For those, **`getConnections`** finds the shortest path
   (three lookups at a time, after the list is shown). With Apps Login there are far fewer of these.
5. **Relationships** (`kinship.js`) are worked out from the parent links: the closest shared ancestor, then the
   generations down each side. "Half" is used only when both other parents are known and different. When a
   marriage link is closer than the blood link, the marriage comes first, e.g. "husband (also 2nd cousin once
   removed)".

Filters are kept in the URL hash (`degree`, `cat`, `loc`, `place`, `marker`, `q`), so a filtered list can be
shared.

## Files

| File                    | What it does                                                                |
| ----------------------- | --------------------------------------------------------------------------- |
| `notableRelatives.js`   | The view: layout, progress, filters, cards, CSV download                    |
| `notable_data.js`       | WikiTree+ and API calls, joining, filters, facets, CSV (no DOM)             |
| `kinship.js`            | Relationship names from parent links or a connection path (no DOM)          |
| `notableRelatives.css`  | Styles, all scoped under `.nr-view`                                         |
| `test/`                 | `node --test views/notableRelatives/test/` (Node 22 or later, no installs) |

## Uploading to the Apps server

The WikiTree API only answers browser requests from `apps.wikitree.com`, so test there. Upload the whole Dynamic
Tree app, not just this folder, because the view needs `tree.js`, `WikiTreeAPI.js`, `index.html` and `index.js`.

1. Make a clean copy, leaving out git files and tests:

    ```bash
    rsync -a --delete --exclude .git --exclude .github --exclude .claude --exclude node_modules \
      --exclude views/notableRelatives/test ~/code/wikitree-dynamic-tree/ ~/code/wikitree-dynamic-tree-upload/
    ```

2. Upload the contents of `~/code/wikitree-dynamic-tree-upload/` to `apps/robinson27225/wikitree-dynamic-tree/` on
   the Apps server (see [Help:WikiTree Apps Server](https://www.wikitree.com/wiki/Help:WikiTree_Apps_Server)).
3. Open `https://apps.wikitree.com/apps/robinson27225/wikitree-dynamic-tree/#name=Windsor-1&view=notableRelatives`.
   You should see about 888 notables. Try Apps Login too, and check that fewer need a connection lookup.
