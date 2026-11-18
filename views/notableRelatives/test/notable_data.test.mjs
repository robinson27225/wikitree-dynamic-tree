import { test } from "node:test";
import assert from "node:assert/strict";
import {
    plusSettings,
    plusSearchUrl,
    fetchCc7,
    fetchPlusNotableIds,
    fetchProfiles,
    fetchConnection,
    applyConnection,
    buildRecords,
    applyFilters,
    facets,
    groupRecords,
    descendantsQuery,
    topAncestors,
    fetchByGeneration,
    searchAncestral,
    buildAncestralRecords,
    toCsv,
    countryOf,
    formatDate,
    markersOf,
    PAGE_LIMIT,
} from "../notable_data.js";

const MAX = "Maximum number of profiles (1025) reached.";

function fakeApi(pages) {
    const calls = [];
    const api = async (data) => {
        calls.push(data);
        const page = pages[calls.length - 1];
        if (!page) throw new Error("unexpected extra call");
        return [{ status: page.status, resultByKey: {}, people: page.people }];
    };
    return { api, calls };
}

plusSettings.pauseMs = 0; // no pause between WikiTree+ requests in tests

/** A fake WikiTree API for which the family is always too big for one call, so the generation walk is tested. */
const tooBigForOneCall = (api) => async (data) =>
    data.minGeneration === undefined && (data.ancestors || data.nuclear)
        ? [{ status: "Maximum number of profiles (1025) reached.", resultByKey: {}, people: {} }]
        : api(data);

const person = (Id, Degrees, extra = {}) => ({
    Id,
    Name: `P-${Id}`,
    Father: 0,
    Mother: 0,
    Meta: { Degrees },
    ...extra,
});

test("fetchCc7, for a family too big for one call, asks one degree at a time and follows pages", async () => {
    const { api, calls } = fakeApi([
        { status: MAX, people: {} },
        { status: "", people: { 1: person(1, undefined, { Father: 7 }) } },
        { status: "", people: { 2: person(2, 1, { Father: 1 }) } },
        { status: MAX, people: { 3: person(3, 2) } },
        { status: "", people: { 3: person(3, 2), 4: person(4, 2) } },
        { status: "", people: {} },
    ]);
    const progress = [];
    const { people, isPartial } = await fetchCc7(1, { api, degrees: 7, onProgress: (n, d) => progress.push([n, d]) });
    assert.deepEqual(
        calls.map((c) => [c.nuclear, c.minGeneration, c.start]),
        [
            [7, undefined, undefined],
            [undefined, undefined, undefined],
            [1, 1, 0],
            [2, 2, 0],
            [2, 2, PAGE_LIMIT],
            [3, 3, 0],
        ],
        "stops after a degree that adds nobody"
    );
    assert.equal(isPartial, false);
    assert.deepEqual([...people.keys()].sort(), [1, 2, 3, 4]);
    assert.equal(people.get(1).degree, 0);
    assert.equal(people.get(1).father, 7, "the starting profile's parents come from the first call");
    assert.equal(people.get(2).father, 1);
    assert.deepEqual(progress, [
        [2, 1],
        [3, 2],
        [4, 2],
        [4, 3],
    ]);
});

test("fetchCc7 stops paging when a page adds nobody, and reports other errors", async () => {
    const tooBig = { status: MAX, people: {} };
    const root = { status: "", people: { 1: person(1, 0) } };
    const same = { status: MAX, people: { 2: person(2, 1) } };
    const { api, calls } = fakeApi([tooBig, root, same, same, { status: "", people: {} }]);
    await fetchCc7(1, { api, degrees: 2 });
    assert.equal(calls.length, 5);

    const failing = fakeApi([tooBig, root, { status: "Limit exceeded", people: {} }]);
    await assert.rejects(fetchCc7(1, { api: failing.api }), /Limit exceeded/);

    const partial = fakeApi([
        tooBig,
        root,
        { status: "Something odd", people: { 2: person(2, 1) } },
        { status: "", people: {} },
    ]);
    assert.equal((await fetchCc7(1, { api: partial.api, degrees: 2 })).isPartial, true);
});

test("fetchPlusNotableIds asks WikiTree+ for NotableProfile in the CC7", async () => {
    let url;
    const fetchFn = async (u) => {
        url = u;
        return {
            ok: true,
            json: async () => ({ response: { found: 2, profiles: [722, 726] }, debug: { dataDate: "2026-11-01" } }),
        };
    };
    const res = await fetchPlusNotableIds(722, { fetchFn });
    assert.deepEqual(res, { ids: [722, 726], dataDate: "2026-11-01", isCut: false });
    assert.match(url, /WTWebProfileSearch\/TA-notableRelatives\.json\?Query=CC7%3D722%20NotableProfile/);
    assert.match(url, /appID=TA-notableRelatives/);

    const none = await fetchPlusNotableIds(9, {
        fetchFn: async () => ({ ok: true, json: async () => ({ response: { found: 0 } }) }),
    });
    assert.deepEqual(none.ids, []);
    await assert.rejects(fetchPlusNotableIds(9, { fetchFn: async () => ({ ok: false, status: 500 }) }), /HTTP 500/);
});

test("fetchProfiles asks in chunks of 1000", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => i + 1);
    const seen = [];
    const api = async (data) => {
        const keys = data.keys.split(",").map(Number);
        seen.push(keys.length);
        return [{ status: "", people: Object.fromEntries(keys.map((k) => [k, { Id: k, Name: `P-${k}` }])) }];
    };
    const profiles = await fetchProfiles(ids, { api });
    assert.deepEqual(seen, [1000, 500]);
    assert.equal(profiles.size, 1500);
});

test("small helpers", () => {
    assert.equal(countryOf("Kensington, London, England"), "England");
    assert.equal(countryOf("Boston, Massachusetts, USA"), "United States");
    assert.equal(countryOf("Boston, Massachusetts, United States of America"), "United States");
    assert.equal(countryOf(""), "");
    assert.equal(formatDate("1850-03-07"), "7 Mar 1850");
    assert.equal(formatDate("1850-03-00"), "Mar 1850");
    assert.equal(formatDate("1850-00-00"), "1850");
    assert.equal(formatDate("0000-00-00"), "");
    assert.deepEqual(markersOf([{ name: "Notability" }, { name: "Notables Sticker" }]), ["notability", "sticker"]);
    assert.deepEqual(markersOf([{ name: "European Aristocrat" }]), ["other"]);
    assert.deepEqual(markersOf(undefined), ["other"]);
});

// A tiny CC7: 1 is the starting profile, 2 its father, 3 its grandfather, 4 an uncle, 5 a spouse.
const cc7 = new Map(
    [
        { id: 1, father: 2, mother: 0, degree: 0, gender: "Male" },
        { id: 2, father: 3, mother: 0, degree: 1, gender: "Male" },
        { id: 3, father: 0, mother: 0, degree: 2, gender: "Male" },
        { id: 4, father: 3, mother: 0, degree: 3, gender: "Male" },
        { id: 5, father: 0, mother: 0, degree: 1, gender: "Female" },
    ].map((p) => [p.id, { name: `P-${p.id}`, ...p }])
);
const profiles = new Map(
    [
        {
            Id: 3,
            Name: "Guinness-49",
            Derived: { ShortName: "Arthur Guinness" },
            Gender: "Male",
            BirthDate: "1725-09-28",
            BirthLocation: "Celbridge, County Kildare, Ireland",
            DeathLocation: "Dublin, Ireland",
            Categories: ["Ireland,_Philanthropists", "Ireland,_Notables"],
            Templates: [{ name: "Notables Sticker", params: {} }],
            PhotoData: { url: "/photo.php/2/20/Guinness-49.jpg" },
        },
        {
            Id: 4,
            Name: "Plunket-1",
            FirstName: "William",
            LastNameAtBirth: "Plunket",
            Gender: "Male",
            BirthDate: "1764-07-01",
            BirthLocation: "Enniskillen, Fermanagh, Ireland",
            Categories: ["Ireland,_Notables"],
            Templates: [{ name: "Notability" }],
        },
        {
            Id: 5,
            Name: "Spencer-40",
            Gender: "Female",
            BirthDate: "1961-07-01",
            BirthLocation: "Sandringham, Norfolk, England",
            Categories: ["England,_Notables"],
            Templates: [{ name: "Notability" }, { name: "European Aristocrat" }],
        },
        {
            Id: 9,
            Name: "Far-9",
            Gender: "Female",
            BirthDate: "1900-00-00",
            Categories: [],
            Templates: [{ name: "Wikidata" }],
        },
    ].map((p) => [p.Id, p])
);
const records = buildRecords({ notableIds: [3, 4, 5, 9, 99], cc7, profiles, rootId: 1 });
const byId = (id) => records.find((r) => r.id === id);

test("buildRecords joins WikiTree+, degrees and details", () => {
    assert.equal(records.length, 4, "an id WikiTree did not return is dropped");
    assert.deepEqual(
        [byId(3).name, byId(3).degree, byId(3).relationship, byId(3).isBlood],
        ["Arthur Guinness", 2, "grandfather", true]
    );
    assert.deepEqual(
        byId(3).categories,
        ["Ireland, Notables", "Ireland, Philanthropists"],
        "Notables categories first"
    );
    assert.deepEqual(byId(3).countries, ["Ireland"]);
    assert.equal(byId(3).photoUrl, "https://www.wikitree.com/photo.php/2/20/Guinness-49.jpg");
    assert.equal(byId(3).birthDate, "28 Sep 1725");
    assert.equal(byId(4).name, "William Plunket");
    assert.equal(byId(4).relationship, "uncle");
    assert.deepEqual([byId(5).relationship, byId(5).isBlood], ["wife", false]);
    assert.deepEqual(byId(5).markers, ["notability"]);
    assert.equal(byId(9).degree, null, "not reached by the API: unknown degree");
});

test("applyFilters", () => {
    const ids = (f) =>
        applyFilters(records, f)
            .map((r) => r.id)
            .sort();
    assert.deepEqual(ids({}), [3, 4, 5, 9]);
    assert.deepEqual(ids({ groups: new Set(["d1", "d2"]) }), [3, 5]);
    assert.deepEqual(ids({ groups: new Set(["unknown"]) }), [9]);
    assert.deepEqual(ids({ category: "Ireland, Notables" }), [3, 4]);
    assert.deepEqual(ids({ country: "England" }), [5]);
    assert.deepEqual(ids({ place: "dublin" }), [3]);
    assert.deepEqual(ids({ marker: "notability" }), [4, 5]);
    assert.deepEqual(ids({ q: "plunket" }), [4]);
    assert.deepEqual(ids({ country: "Ireland", marker: "sticker" }), [3]);
});

test("facets and grouping", () => {
    const f = facets(records);
    assert.deepEqual(f.countries, [
        ["Ireland", 2],
        ["England", 1],
    ]);
    assert.deepEqual(f.categories[0], ["Ireland, Notables", 2]);
    assert.deepEqual(f.markers, [
        ["notability", 2],
        ["other", 1],
        ["sticker", 1],
    ]);
    assert.deepEqual(
        f.groups.map((g) => [g.key, g.short, g.count]),
        [
            ["d1", "1", 1],
            ["d2", "2", 1],
            ["d3", "3", 1],
            ["unknown", "Unknown", 1],
        ]
    );
    assert.deepEqual(
        groupRecords(records).map((g) => [g.key, g.heading, g.records.map((r) => r.id)]),
        [
            ["d1", "1 degree away", [5]],
            ["d2", "2 degrees away", [3]],
            ["d3", "3 degrees away", [4]],
            ["unknown", "Degree not found", [9]],
        ]
    );
});

test("toCsv quotes commas and names markers", () => {
    const csv = toCsv([byId(3)]).split("\r\n");
    assert.equal(csv.length, 2);
    assert.match(csv[0], /^Group,Relationship,Name,WikiTree ID/);
    assert.match(
        csv[1],
        /^2 degrees away,grandfather,Arthur Guinness,Guinness-49,28 Sep 1725,"Celbridge, County Kildare, Ireland"/
    );
    assert.match(csv[1], /Notables Sticker/);
    assert.match(csv[1], /https:\/\/www\.wikitree\.com\/wiki\/Guinness-49$/);
});

test("fetchConnection and applyConnection fill in a missing degree", async () => {
    let asked;
    const api = async (data) => {
        asked = data;
        return [
            {
                pathLength: 4,
                path: [
                    { Name: "Windsor-1" },
                    { Name: "Windsor-24", pathType: "sibling" },
                    { Name: "Armstrong-Jones-2", pathType: "child" },
                    { Name: "Stanhope-111", pathType: "spouse" },
                ],
            },
        ];
    };
    const conn = await fetchConnection("Windsor-1", "Stanhope-111", { api });
    assert.deepEqual(asked, { appId: "notableRelatives", action: "getConnections", keys: "Windsor-1,Stanhope-111" });
    assert.deepEqual(conn, { degree: 3, steps: ["sibling", "child", "spouse"] });

    const r = applyConnection({ degree: null, gender: "Female", relationship: "related by marriage" }, conn);
    assert.deepEqual([r.degree, r.relationship, r.isBlood], [3, "related by marriage", false]);
    const nephew = applyConnection({ degree: null, gender: "Male" }, { degree: 2, steps: ["sibling", "child"] });
    assert.deepEqual([nephew.degree, nephew.relationship, nephew.isBlood], [2, "nephew", true]);

    assert.equal(await fetchConnection("A-1", "B-1", { api: async () => [{ path: [] }] }), null);
    const untouched = { degree: null };
    assert.equal(applyConnection(untouched, null).degree, null);
});

test('descendantsQuery puts every id in one descendants="..." term', () => {
    // Numeric ids: WikiTree+ splits an unquoted "Söderblom-7" or "O'Brien-1" and finds nothing.
    assert.equal(descendantsQuery([21773300, 2]), 'descendants="21773300,2" NotableProfile');
    assert.ok(!descendantsQuery([1, 2, 3]).includes(" OR "), "never several Descendants searches");
});

test("topAncestors keeps only the furthest-back ancestor on each line", () => {
    // 2 and 3 are the parents; 4 and 5 are 2's parents; 3's parents are unknown.
    const tree = new Map([
        [2, { id: 2, father: 4, mother: 5, bioFather: 0, bioMother: 0 }],
        [3, { id: 3, father: 0, mother: 0, bioFather: 0, bioMother: 0 }],
        [4, { id: 4, father: 0, mother: 0, bioFather: 0, bioMother: 0 }],
        [5, { id: 5, father: 0, mother: 0, bioFather: 0, bioMother: 0 }],
    ]);
    assert.deepEqual(topAncestors(tree), [3, 4, 5]);
});

test("a very long search is sent by POST, which WikiTree+ allows when necessary", async () => {
    resetPlusQueue();
    let seen;
    const fetchFn = async (url, init) => {
        seen = { url, init };
        return json({ response: { profiles: [9] } });
    };
    const ids = Array.from({ length: 1000 }, (_, i) => 10000000 + i);
    const res = await fetchPlusIds(descendantsQuery(ids), { fetchFn, maxProfiles: 1000000 });
    assert.deepEqual(res.ids, [9]);
    assert.equal(seen.init.method, "POST");
    assert.ok(!seen.url.includes("Query="), "the search is in the body, not the address");
    assert.equal(seen.init.body.get("Query"), descendantsQuery(ids));
    assert.equal(seen.init.body.get("MaxProfiles"), "1000000");
    assert.equal(seen.init.body.get("appID"), "TA-notableRelatives");
});

test("fetchByGeneration asks for ancestors one generation at a time", async () => {
    const { api, calls } = fakeApi([
        { status: "", people: { 2: person(2, 1), 3: person(3, 1) } },
        { status: "", people: { 4: person(4, 2) } },
        { status: "", people: {} },
    ]);
    const { people } = await fetchByGeneration(1, "ancestors", 5, { api });
    assert.deepEqual(
        calls.map((c) => [c.ancestors, c.minGeneration]),
        [
            [1, 1],
            [2, 2],
            [3, 3],
        ]
    );
    assert.deepEqual(
        [...people.values()].map((p) => [p.id, p.degree]),
        [
            [2, 1],
            [3, 1],
            [4, 2],
        ]
    );
});

test("searchAncestral finds ancestors, then descendants and cousins in ONE WikiTree+ search", async () => {
    // Ancestors: 2, 3 (parents) and 4 (2's father). Descendant: 10 (child).
    const apiPages = {
        "ancestors:1": {
            2: person(2, 1, { Name: "Dad-2", Father: 4 }),
            3: person(3, 1, { Name: "Mum-3" }),
        },
        "ancestors:2": { 4: person(4, 2, { Name: "Gran-4" }) },
        "ancestors:3": {},
        "descendants:1": { 10: person(10, 1) },
        "descendants:2": {},
    };
    const api = async (data) => {
        const relation = data.ancestors ? "ancestors" : "descendants";
        return [{ status: "", people: apiPages[`${relation}:${data[relation]}`] || {} }];
    };
    // 3 and 4 are the furthest back on their lines (2 is covered by 4). One answer for everything: the asked ids and
    // the ancestors below them (3, 4, 2), the starting profile, a descendant (10) and cousins (20, 21, 30).
    const plusAnswers = new Map([['descendants="3,4" NotableProfile', [1, 3, 4, 2, 10, 20, 21, 30]]]);
    const asked = [];
    const fetchFn = async (url) => {
        const query = decodeURIComponent(/Query=([^&]*)/.exec(url)[1]);
        asked.push(query);
        return json({ response: { profiles: plusAnswers.get(query) || [] }, debug: { dataDate: "2026-11-01" } });
    };
    const found = [];
    const result = await searchAncestral({
        rootId: 1,
        generations: 3,
        api: tooBigForOneCall(api),
        fetchFn,
        onFound: (f) => found.push([f.kind, f.ids]),
    });
    assert.deepEqual(found, [
        ["ancestor", [3, 4, 2]],
        ["descendant", [10]],
        ["cousin", [20, 21, 30]],
    ]);
    assert.deepEqual(asked, ['descendants="3,4" NotableProfile'], "one search in all");
    assert.equal(result.dataDate, "2026-11-01");
    assert.equal(result.ancestors.get(4).degree, 2);
    assert.equal(result.descendants.get(10).degree, 1);
});

test("searchAncestral never retries its one WikiTree+ search", async () => {
    const api = async (data) => [{ status: "", people: data.ancestors === 1 ? { 2: person(2, 1) } : {} }];
    const asked = [];
    const found = [];
    const fetchFn = async (url) => {
        asked.push(url);
        return { ok: false, status: 500 };
    };
    const result = await searchAncestral({
        rootId: 1,
        generations: 3,
        api,
        fetchFn,
        onFound: (f) => found.push(f.kind),
    });
    assert.equal(asked.length, 1, "not retried");
    assert.equal(result.failedQueries, 1);
    assert.deepEqual(found, []);
});

test("buildAncestralRecords labels each kind", () => {
    const profilesById = new Map([
        [4, { Id: 4, Name: "Gran-4", Gender: "Female", BirthDate: "1900-01-01" }],
        [10, { Id: 10, Name: "Kid-10", Gender: "Male" }],
        [30, { Id: 30, Name: "Cousin-30", Gender: "Male", BirthLocation: "Cork, Ireland" }],
        [77, { Id: 77, Name: "Old-77", Gender: "Male" }],
    ]);
    const ancestors = new Map([[4, { id: 4, degree: 2 }]]);
    const descendants = new Map([[10, { id: 10, degree: 1 }]]);
    const build = (kind, ids, generation) =>
        buildAncestralRecords({
            kind,
            ids,
            generation,
            profiles: profilesById,
            ancestors,
            descendants,
            generations: 12,
        })[0];
    const gran = build("ancestor", [4]);
    assert.deepEqual(
        [gran.relationship, gran.groupKey, gran.groupHeading],
        ["grandmother", "anc", "Notable ancestors"]
    );
    assert.equal(build("descendant", [10]).relationship, "son");
    const cousin = build("cousin", [30], 9);
    assert.deepEqual(
        [cousin.groupKey, cousin.groupHeading, cousin.groupNote, cousin.relationship, cousin.countries],
        [
            "cousins",
            "Notable cousins",
            "share ancestors with the starting profile up to 12 generations back",
            "cousin through shared ancestors",
            ["Ireland"],
        ]
    );
    assert.equal(build("cousin", [99], 3), undefined, "a profile WikiTree did not return is skipped");
    const sorted = groupRecords([cousin, gran, build("descendant", [10])]).map((g) => g.key);
    assert.deepEqual(sorted, ["anc", "desc", "cousins"]);
});

test("rate limits are recognised and never drop notables silently", async () => {
    const { isLimitError, LIMIT_MESSAGE } = await import("../notable_data.js");
    assert.equal(isLimitError("Limit exceeded."), true);
    assert.equal(isLimitError(new Error("HTTP error! Status: 429: Too Many Requests")), true);
    assert.equal(isLimitError(new Error("HTTP error! Status: 500: Server Error")), false);
    assert.match(LIMIT_MESSAGE, /Wait a few minutes/);

    const limited = async () => [{ status: "Limit exceeded." }];
    await assert.rejects(
        fetchProfiles([1, 2], { api: limited }),
        /could not read the notable profiles: Limit exceeded/
    );
    const fine = async () => [{ status: "", people: { 1: { Id: 1, Name: "A-1" } } }];
    assert.equal((await fetchProfiles([1], { api: fine })).size, 1);
});

// ---------- 0.2.0 ----------

import {
    fetchAllNotableIds,
    resetAllNotableIds,
    resetPlusDataDate,
    notablesInCc7,
    withRetry,
    isNetworkError,
    DIRECT_LINE_GROUPS,
} from "../notable_data.js";

test("fetchAllNotableIds pages through every notable profile and asks only once", async () => {
    resetAllNotableIds();
    resetPlusDataDate();
    const urls = [];
    const fetchFn = async (u) => {
        if (u.includes("DataDates.json")) return { ok: true, json: async () => ({ dataDate: "2026-11-08" }) };
        urls.push(u);
        const index = Number(/PageIdx=(\d+)/.exec(u)[1]);
        const profiles = index === 0 ? Array.from({ length: 100000 }, (_, i) => i + 1) : [200001, 200002];
        return {
            ok: true,
            json: async () => ({ response: { found: 100002, profiles }, debug: { dataDate: "2026-11-08" } }),
        };
    };
    const res = await fetchAllNotableIds({ fetchFn });
    assert.equal(res.ids.size, 100002);
    assert.ok(res.ids.has(200002));
    assert.equal(res.dataDate, "2026-11-08");
    assert.equal(urls.length, 2);
    assert.match(urls[0], /Query=NotableProfile&MaxProfiles=1000000&PageSize=100000&PageIdx=0/);
    await fetchAllNotableIds({ fetchFn });
    assert.equal(urls.length, 2, "the list is kept for the page");
    resetAllNotableIds();
});

test("notablesInCc7 finds notables the WikiTree+ CC7 misses behind a private profile", () => {
    // Palotay-1 -> private husband -> Andrew -> Imre -> Miklós -> Albert (Szent-Györgyi-5, notable, degree 5)
    const cc7 = new Map([
        [1, { id: 1, degree: 0 }],
        [2, { id: 2, degree: 1 }],
        [3, { id: 3, degree: 2 }],
        [6, { id: 6, degree: 5 }],
    ]);
    const all = new Set([6, 99, 1]);
    assert.deepEqual(notablesInCc7(cc7, all, [], 1), [6]);
    assert.deepEqual(notablesInCc7(cc7, all, [6, 50], 1).sort(), [50, 6].sort(), "WikiTree+ CC7 ids are added once");
});

test("withRetry tries again when the connection drops, but not for other errors", async () => {
    let calls = 0;
    const flaky = async () => {
        calls++;
        if (calls < 3) throw new TypeError("Failed to fetch");
        return "ok";
    };
    assert.equal(await withRetry(flaky, { delays: [1, 1] }), "ok");
    assert.equal(calls, 3);

    let other = 0;
    await assert.rejects(
        withRetry(
            async () => {
                other++;
                throw new Error("WikiTree could not read the notable profiles: Limit exceeded.");
            },
            { delays: [1, 1] }
        ),
        /Limit exceeded/
    );
    assert.equal(other, 1);

    await assert.rejects(
        withRetry(
            async () => {
                throw new TypeError("Failed to fetch");
            },
            { delays: [1] }
        ),
        /Failed/
    );
    assert.ok(isNetworkError(new TypeError("Failed to fetch")));
    assert.ok(isNetworkError(new TypeError("NetworkError when attempting to fetch resource.")));
    assert.ok(isNetworkError(new TypeError("Load failed")));
    assert.ok(!isNetworkError({ name: "AbortError", message: "Failed to fetch" }));
    assert.ok(!isNetworkError(new Error("Limit exceeded.")));
});

test("the direct line groups are the ancestor and descendant groups", () => {
    assert.deepEqual([...DIRECT_LINE_GROUPS].sort(), ["anc", "desc"]);
});

// ---------- 0.2.0: birth and adoptive parents ----------

import {
    parentOptions,
    chosenParents,
    ancestorsFrom,
    relativesQuery,
    couplesOf,
    onePartnerPerCouple,
} from "../notable_data.js";

test("parentOptions matches the Genealogy Report: birth parents fall back to the listed ones", () => {
    // Wright-33630: adoptive father listed, birth father recorded, mother the same.
    const wright = parentOptions({ Father: 40387616, Mother: 21130573, BioFather: 50159746, BioMother: null });
    assert.deepEqual(wright.main, [40387616, 21130573]);
    assert.deepEqual(wright.bio, [50159746, 21130573]);
    assert.equal(wright.hasAlternate, true);
    assert.deepEqual(wright.hiddenBio, []);

    assert.equal(parentOptions({ Father: 2, Mother: 3 }).hasAlternate, false);
    assert.equal(chosenParents(parentOptions({ Father: 2, Mother: 3 }), "bio"), null, "no choice: follow everyone");

    // Jobs-9: both birth parents private to the viewer (negative ids).
    const jobs = parentOptions({ Father: 9041277, Mother: 9041286, BioFather: -1, BioMother: -2 });
    assert.equal(jobs.hasAlternate, true);
    assert.deepEqual(jobs.hiddenBio, ["father", "mother"]);
    assert.deepEqual(chosenParents(jobs, "bio"), []);
    assert.deepEqual(chosenParents(jobs, "both"), [9041277, 9041286]);
});

test("chosenParents gives the parents for Biological, Adoptive and Both", () => {
    const o = parentOptions({ Father: 40, Mother: 21, BioFather: 50 });
    assert.deepEqual(chosenParents(o, "bio"), [50, 21]);
    assert.deepEqual(chosenParents(o, "main"), [40, 21]);
    assert.deepEqual(chosenParents(o, "both"), [40, 21, 50]);
});

test("ancestorsFrom keeps only the chosen side, through listed and birth parents above it", () => {
    const tree = new Map([
        [40, { id: 40, degree: 1, father: 41, mother: 0, bioFather: 0, bioMother: 0 }], // adoptive father
        [41, { id: 41, degree: 2, father: 0, mother: 0, bioFather: 0, bioMother: 0 }],
        [50, { id: 50, degree: 1, father: 0, mother: 0, bioFather: 51, bioMother: 0 }], // birth father
        [51, { id: 51, degree: 2, father: 0, mother: 0, bioFather: 0, bioMother: 0 }],
        [21, { id: 21, degree: 1, father: 22, mother: 0, bioFather: 0, bioMother: 0 }], // mother
        [22, { id: 22, degree: 2, father: 0, mother: 0, bioFather: 0, bioMother: 0 }],
    ]);
    assert.deepEqual([...ancestorsFrom(tree, [50, 21]).keys()].sort(), [21, 22, 50, 51]);
    assert.deepEqual([...ancestorsFrom(tree, [40, 21]).keys()].sort(), [21, 22, 40, 41]);
});

test("relativesQuery is one descendants search, by numeric id", () => {
    // No Format parameter is needed: ".json" in the address says it.
    assert.equal(
        relativesQuery(41379356, null, [41379356, 48670305]),
        'descendants="41379356,48670305" NotableProfile'
    );
    assert.equal(relativesQuery(1, [], []), "", "nothing to ask: an empty query, which is never sent");
});

test("searchAncestral with Biological searches only the birth parents' side", async () => {
    // Listed father 40 (adoptive), birth father 50, mother 21. The API returns all three at generation 1.
    const apiPages = {
        "ancestors:1": {
            40: person(40, 1, { Name: "Adopt-40" }),
            50: person(50, 1, { Name: "Bio-50" }),
            21: person(21, 1, { Name: "Mum-21" }),
        },
        "ancestors:2": {},
    };
    const api = async (data) => {
        const relation = data.ancestors ? "ancestors" : "descendants";
        return [{ status: "", people: apiPages[`${relation}:${data[relation]}`] || {} }];
    };
    const asked = [];
    const fetchFn = async (url) => {
        asked.push(decodeURIComponent(/Query=([^&]*)/.exec(url)[1]));
        return { ok: true, json: async () => ({ response: { profiles: [] } }) };
    };
    const bio = chosenParents(parentOptions({ Father: 40, Mother: 21, BioFather: 50 }), "bio");
    const result = await searchAncestral({
        rootId: 1,
        generations: 2,
        parentIds: bio,
        api: tooBigForOneCall(api),
        fetchFn,
    });
    assert.deepEqual([...result.ancestors.keys()].sort(), [21, 50]);
    assert.deepEqual(asked, ['descendants="50,21" NotableProfile']);
    assert.ok(!asked.some((q) => /\b40\b/.test(q)), "the adoptive father is not searched");
});

// ---------- private starting profiles ----------

import { PrivateProfileError, privateProfileMessage } from "../notable_data.js";

test("a private starting profile stops the walk with PrivateProfileError", async () => {
    // What WikiTree answers for Goodine-41 when the viewer may not see it.
    const api = async () => [
        {
            status: "",
            resultByKey: { 18749863: { Id: 18749863, status: "Ancestor/Descendant permission denied." } },
            people: { "-1": { Id: -1, Meta: { Degrees: 0 } } },
        },
    ];
    await assert.rejects(fetchByGeneration(18749863, "ancestors", 3, { api }), (err) => {
        assert.ok(err instanceof PrivateProfileError);
        assert.match(err.message, /permission denied/);
        return true;
    });
});

test("privateProfileMessage points to Apps Login or the Trusted List, like the other Tree Apps", () => {
    const out = privateProfileMessage("Goodine-41", { isLoggedIn: false });
    assert.match(out, /could not be retrieved for Goodine-41/);
    assert.match(out, /Apps Login/);
    const inn = privateProfileMessage("Goodine-41", { isLoggedIn: true, name: "Robinson-27225" });
    assert.match(inn, /logged in to the Tree Apps as Robinson-27225/);
    assert.match(inn, /Trusted List/);
});

// ---------- review fixes and WikiTree+ etiquette ----------

import { plusQueue, resetPlusQueue, PlusUnavailableError, untilAborted, isServerError } from "../notable_data.js";

const json = (body) => ({ ok: true, status: 200, json: async () => body });

test("WikiTree+ requests run one at a time, never in parallel", async () => {
    resetPlusQueue();
    let running = 0;
    let most = 0;
    const fetchFn = async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return json({ response: { profiles: [1] } });
    };
    await Promise.all(Array.from({ length: 13 }, (_, i) => fetchPlusNotableIds(i + 1, { fetchFn })));
    assert.equal(most, 1);
});

test("a stopped search drops its waiting WikiTree+ requests but lets a started one finish", async () => {
    resetPlusQueue();
    const started = [];
    let finish;
    const slow = new Promise((r) => (finish = r));
    const fetchFn = async (url) => {
        started.push(url);
        if (started.length === 1) await slow;
        return json({ response: { profiles: [] } });
    };
    const controller = new AbortController();
    const first = fetchPlusNotableIds(1, { fetchFn, signal: controller.signal });
    const second = fetchPlusNotableIds(2, { fetchFn, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await assert.rejects(first, { name: "AbortError" });
    await assert.rejects(second, { name: "AbortError" });
    // A new search waits for the started request instead of running beside it.
    const third = fetchPlusNotableIds(3, { fetchFn });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(started.length, 1, "nothing new starts while the first request is still on the server");
    finish();
    await third;
    assert.equal(started.length, 2, "the waiting request of the stopped search was dropped");
});

test("a WikiTree+ refusal stops all requests from the page for a while", async () => {
    resetPlusQueue();
    let calls = 0;
    const refuse = async () => {
        calls++;
        return { ok: false, status: 429 };
    };
    await assert.rejects(fetchPlusNotableIds(1, { fetchFn: refuse }), PlusUnavailableError);
    await assert.rejects(fetchPlusNotableIds(2, { fetchFn: refuse }), PlusUnavailableError);
    assert.equal(calls, 1, "the second request is not sent");
    resetPlusQueue();
});

test("a WikiTree+ error answer is an error, not an empty result", async () => {
    resetPlusQueue();
    const fetchFn = async () => json({ response: { error: "Query too long" } });
    await assert.rejects(fetchPlusNotableIds(1, { fetchFn }), /Query too long/);
});

test("untilAborted rejects on abort without waiting for the work", async () => {
    const controller = new AbortController();
    const never = new Promise(() => {});
    const p = untilAborted(never, controller.signal);
    controller.abort();
    await assert.rejects(p, { name: "AbortError" });
});

test("only one partner of each couple is asked about", () => {
    // 1206231 and 19671599 are a couple: they share their descendants.
    const people = [{ father: 1206231, mother: 19671599, bioFather: 0, bioMother: 0 }];
    const couples = couplesOf(people);
    assert.deepEqual(onePartnerPerCouple([1206231, 19671599, 77], couples), [1206231, 77]);
    // A father with two wives who are both ancestors (pedigree collapse) covers both.
    const two = couplesOf([
        { father: 5, mother: 6, bioFather: 0, bioMother: 0 },
        { father: 5, mother: 7, bioFather: 0, bioMother: 0 },
    ]);
    assert.deepEqual(onePartnerPerCouple([5, 6, 7], two), [5]);
    // The starting profile's own parents come in as extra pairs.
    assert.deepEqual(onePartnerPerCouple([40, 21], couplesOf([], [[40, 21]])), [40]);
    // Someone whose partner is not in this generation is kept.
    assert.deepEqual(onePartnerPerCouple([6], two), [6]);
});

test("the one search names one partner of each couple at the top of each line", async () => {
    // 2 and 3 are the parents (a couple); 4 and 5 are 2's parents (a couple); 3's parents are unknown.
    const pages = {
        1: { 2: person(2, 1, { Father: 4, Mother: 5 }), 3: person(3, 1) },
        2: { 4: person(4, 2), 5: person(5, 2) },
        3: {},
    };
    const api = async (data) => [{ status: "", people: data.ancestors ? pages[data.ancestors] || {} : {} }];
    const asked = [];
    const fetchFn = async (url) => {
        asked.push(decodeURIComponent(/Query=([^&]*)/.exec(url)[1]));
        return json({ response: { profiles: [] } });
    };
    await searchAncestral({ rootId: 1, generations: 3, rootCouples: [[2, 3]], api: tooBigForOneCall(api), fetchFn });
    // 3 stays (its line ends there); 4 stands for the couple 4 and 5; 2 is covered by 4.
    assert.deepEqual(asked, ['descendants="3,4" NotableProfile']);
});

test("without ancestors, the starting profile's own descendants are searched", async () => {
    const api = async () => [{ status: "", people: {} }];
    const asked = [];
    const fetchFn = async (url) => {
        asked.push(decodeURIComponent(/Query=([^&]*)/.exec(url)[1]));
        return json({ response: { profiles: [] } });
    };
    await searchAncestral({ rootId: 1, generations: 3, api, fetchFn });
    assert.deepEqual(asked, ['descendants="1" NotableProfile']);
});

test("private placeholders are left out but do not end the walk", async () => {
    // Generation 1: two private parents (-1, -2). Generation 2: two private grandparents, also -1 and -2 in their
    // own answer. Generation 3: a public great-grandparent.
    const pages = {
        1: { "-1": { Id: -1, Meta: { Degrees: 1 } }, "-2": { Id: -2, Meta: { Degrees: 1 } } },
        2: { "-1": { Id: -1, Meta: { Degrees: 2 } }, "-2": { Id: -2, Meta: { Degrees: 2 } } },
        3: { 8: person(8, 3) },
        4: {},
    };
    const api = async (data) => [{ status: "", people: pages[data.ancestors] }];
    const { people } = await fetchByGeneration(1, "ancestors", 5, { api });
    assert.deepEqual([...people.keys()], [8]);
    assert.equal(people.get(8).degree, 3);
});

test("a walk that fails part way keeps the people found so far", async () => {
    const api = async (data) => {
        if (data.ancestors === 2) throw new Error("WikiTree could not list the relatives: Limit exceeded.");
        return [{ status: "", people: { 2: person(2, 1) } }];
    };
    const result = await fetchByGeneration(1, "ancestors", 4, { api });
    assert.equal(result.isPartial, true);
    assert.match(result.error.message, /Limit exceeded/);
    assert.deepEqual([...result.people.keys()], [2]);

    const failsAtOnce = async () => {
        throw new Error("Limit exceeded.");
    };
    await assert.rejects(fetchByGeneration(1, "ancestors", 4, { api: failsAtOnce }), /Limit exceeded/);
});

test("the descendants walk stops once the notable descendants are found", async () => {
    const asked = [];
    const api = async (data) => {
        asked.push(data.descendants);
        return [{ status: "", people: data.descendants === 1 ? { 10: person(10, 1) } : { 20: person(20, 2) } }];
    };
    const { people } = await fetchByGeneration(1, "descendants", 10, { api, stopWhenFound: new Set([10]) });
    assert.deepEqual(asked, [1]);
    assert.ok(people.has(10));
});

test("ancestorsFrom counts generations on the chosen side", () => {
    // 60 is a grandparent through the adoptive father (API degree 2) and a great-grandparent through the birth father.
    const tree = new Map([
        [40, { id: 40, degree: 1, father: 60, mother: 0, bioFather: 0, bioMother: 0 }],
        [50, { id: 50, degree: 1, father: 55, mother: 0, bioFather: 0, bioMother: 0 }],
        [55, { id: 55, degree: 2, father: 60, mother: 0, bioFather: 0, bioMother: 0 }],
        [60, { id: 60, degree: 2, father: 0, mother: 0, bioFather: 0, bioMother: 0 }],
    ]);
    const bio = ancestorsFrom(tree, [50]);
    assert.equal(bio.get(60).degree, 3);
    assert.equal(tree.get(60).degree, 2, "the full walk is not changed");
});

test("server errors from the WikiTree API are recognised and retried", async () => {
    assert.ok(isServerError(new Error("HTTP error! Status: 502: Bad Gateway")));
    assert.ok(!isServerError(new Error("HTTP error! Status: 429: Too Many Requests")));
    let calls = 0;
    const flaky = async () => {
        calls++;
        if (calls === 1) throw new Error("HTTP error! Status: 503: Service Unavailable");
        return "ok";
    };
    assert.equal(await withRetry(flaky, { delays: [1] }), "ok");
});

test("WikiTree+ dropping the query counts as a refusal", async () => {
    resetPlusQueue();
    let calls = 0;
    const fetchFn = async () => {
        calls++;
        return json({ request: { query: "" }, response: { error: "No search text." } });
    };
    await assert.rejects(fetchPlusNotableIds(1, { fetchFn }), PlusUnavailableError);
    await assert.rejects(fetchPlusNotableIds(2, { fetchFn }), PlusUnavailableError);
    assert.equal(calls, 1);
    resetPlusQueue();
});

// ---------- Help:App Policies and Help:WikiTree Plus API ----------

import { pacedApi, isSavedCurrent, savedRecord, refreshRecords, fetchPlusDataDate } from "../notable_data.js";

test("pacedApi keeps WikiTree API requests at least the spacing apart", async () => {
    const times = [];
    const api = pacedApi(async () => times.push(Date.now()), 30);
    await Promise.all([api({}), api({}), api({})]);
    assert.equal(times.length, 3);
    assert.ok(times[1] - times[0] >= 25 && times[2] - times[1] >= 25, times.join(","));
});

test("pacedApi drops a waiting request when its search is stopped", async () => {
    let calls = 0;
    const api = pacedApi(async () => calls++, 50);
    await api({});
    const controller = new AbortController();
    const waiting = api({}, controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: "AbortError" });
    assert.equal(calls, 1);
});

test("a saved result is current only for the same WikiTree+ data date, and never past 8 days", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    const saved = { savedAt: now - 2 * 86400000, dataDate: "2026-11-15" };
    assert.equal(isSavedCurrent(saved, "2026-11-15", now), true);
    assert.equal(isSavedCurrent(saved, "2026-11-22", now), false, "WikiTree+ has newer data");
    assert.equal(isSavedCurrent(saved, "", now), true, "date unknown: the age limit decides");
    assert.equal(isSavedCurrent({ ...saved, savedAt: now - 9 * 86400000 }, "", now), false);
    assert.equal(isSavedCurrent(null, "2026-11-15", now), false);
});

test("saved records keep no profile details, and are refreshed from WikiTree", () => {
    const record = {
        id: 7,
        name: "Ada Lovelace",
        birthPlace: "London, England",
        categories: ["Mathematicians"],
        groupKey: "g3",
        group: 3,
        relationship: "shares the starting profile's great-grandparents",
        order: 3,
    };
    const kept = savedRecord(record);
    assert.deepEqual(Object.keys(kept).sort(), ["group", "groupKey", "id", "order", "relationship"]);
    assert.ok(!JSON.stringify(kept).includes("Lovelace"));
    const profiles = new Map([[7, { Id: 7, Name: "Byron-9", FirstName: "Ada", LastNameAtBirth: "Byron" }]]);
    const [fresh] = refreshRecords([kept, { id: 8, groupKey: "g3" }], profiles);
    assert.equal(fresh.wtId, "Byron-9");
    assert.equal(fresh.name, "Ada Byron");
    assert.equal(fresh.groupKey, "g3");
    assert.equal(refreshRecords([{ id: 8 }], profiles).length, 0, "a profile WikiTree no longer returns is left out");
});

test("fetchPlusDataDate reads /DataDates.json once per page", async () => {
    resetPlusQueue();
    resetPlusDataDate();
    let calls = 0;
    const fetchFn = async (url) => {
        calls++;
        assert.match(url, /plus\.wikitree\.com\/DataDates\.json\?appID=TA-notableRelatives/);
        return json({ dataDate: "2026-11-15", categoriesDate: "2026-11-18" });
    };
    assert.equal(await fetchPlusDataDate({ fetchFn }), "2026-11-15");
    assert.equal(await fetchPlusDataDate({ fetchFn }), "2026-11-15");
    assert.equal(calls, 1);
    resetPlusDataDate();
});

test("a WikiTree+ answer cut at MaxProfiles makes the search partial", async () => {
    resetPlusQueue();
    const api = async (data) => [{ status: "", people: data.ancestors === 1 ? { 2: person(2, 1) } : {} }];
    const fetchFn = async (url) =>
        json({ response: { found: 100000, more: url.includes("descendants"), profiles: [] } });
    const result = await searchAncestral({ rootId: 1, generations: 2, api, fetchFn });
    assert.equal(result.isPartial, true);
});

// ---------- pauses and empty searches ----------

import { fetchPlusIds, plusUnavailableMessage, clearPlusPause, plusPause } from "../notable_data.js";

test("an empty search is never sent to WikiTree+", async () => {
    resetPlusQueue();
    let calls = 0;
    const fetchFn = async () => {
        calls++;
        return json({ request: { query: "" }, response: { error: "No search text." } });
    };
    assert.deepEqual(await fetchPlusIds("", { fetchFn }), { ids: [], dataDate: "", isCut: false });
    // Biological chosen while both birth parents are private: no parents to ask about, so no query at all.
    assert.deepEqual(await fetchPlusIds(relativesQuery(1, [], []), { fetchFn }), {
        ids: [],
        dataDate: "",
        isCut: false,
    });
    assert.equal(calls, 0);
    assert.equal(plusPause(), null, "no pause starts");
});

test("a pause says no search was sent, and Try now ends it", async () => {
    resetPlusQueue();
    let calls = 0;
    const refuse = async () => {
        calls++;
        return { ok: false, status: 429 };
    };
    const ok = async () => {
        calls++;
        return json({ response: { profiles: [5] } });
    };
    const first = await fetchPlusNotableIds(1, { fetchFn: refuse }).catch((e) => e);
    assert.equal(first.isPause, false);
    assert.match(plusUnavailableMessage(first), /turned away this search/);
    assert.match(plusUnavailableMessage(first), /too many requests/, "names what WikiTree+ answered");
    assert.match(plusUnavailableMessage(first), /Try WikiTree\+ now/);

    const second = await fetchPlusNotableIds(2, { fetchFn: ok }).catch((e) => e);
    assert.equal(second.isPause, true);
    assert.equal(calls, 1, "nothing sent during the pause");
    assert.match(plusUnavailableMessage(second), /No search was sent to WikiTree\+/);
    assert.ok(second.until > second.at);

    clearPlusPause();
    assert.deepEqual((await fetchPlusNotableIds(3, { fetchFn: ok })).ids, [5]);
    resetPlusQueue();
});

test("WikiTree+ addresses carry no Format parameter", () => {
    const url = plusSearchUrl('ancestors="1" NotableProfile');
    assert.ok(!/format=/i.test(url), url);
    assert.match(url, /\/WTWebProfileSearch\/TA-notableRelatives\.json\?Query=/);
});

// ---------- one WikiTree API call ----------

import { fetchFamily, descendantIdsOf, fetchInOneCall } from "../notable_data.js";

test("fetchFamily gets the profile, its ancestors and its descendants in ONE call", async () => {
    const calls = [];
    const api = async (data) => {
        calls.push(data);
        return [
            {
                status: "",
                resultByKey: { 1: { Id: 1 } },
                people: {
                    1: person(1, 0, { Father: 2, Mother: 3, FirstName: "Me" }),
                    2: person(2, 1, { Father: 4 }),
                    3: person(3, 1),
                    4: person(4, 2),
                    10: person(10, 1, { Father: 1 }),
                    11: person(11, 2, { Mother: 10 }),
                },
            },
        ];
    };
    const fam = await fetchFamily(1, 8, { api });
    assert.equal(calls.length, 1, "a single call");
    assert.deepEqual([calls[0].ancestors, calls[0].descendants, calls[0].minGeneration], [8, 10, undefined]);
    assert.equal(fam.root.FirstName, "Me");
    assert.deepEqual([...fam.ancestors.keys()].sort(), [2, 3, 4]);
    assert.deepEqual([...fam.descendants.keys()].sort(), [10, 11]);
    assert.equal(fam.ancestors.get(4).degree, 2);
    assert.equal(fam.descendants.get(11).degree, 2);
});

test("fetchFamily falls back to a generation walk when the family is too big for one call", async () => {
    const asked = [];
    const api = async (data) => {
        asked.push(data.minGeneration === undefined ? (data.ancestors ? "one" : "root") : `gen${data.ancestors}`);
        if (data.minGeneration === undefined && data.ancestors) return [{ status: MAX, people: {} }];
        if (!data.ancestors) return [{ status: "", people: { 1: person(1, 0) } }];
        return [{ status: "", people: data.ancestors === 1 ? { 2: person(2, 1) } : {} }];
    };
    const fam = await fetchFamily(1, 3, { api });
    assert.deepEqual(asked, ["one", "root", "gen1", "gen2"]);
    assert.deepEqual([...fam.ancestors.keys()], [2]);
    assert.equal(fam.descendants, null, "descendants are asked for later, only if needed");
});

test("descendantIdsOf follows parent links down, birth parents included", () => {
    const people = [
        { Id: 10, Father: 1 },
        { Id: 11, Mother: 10 },
        { Id: 12, BioFather: 11 },
        { Id: 2, Father: 4 },
    ];
    assert.deepEqual([...descendantIdsOf(1, people)].sort(), [10, 11, 12]);
});

test("fetchInOneCall reports a private starting profile", async () => {
    const api = async () => [
        {
            status: "",
            resultByKey: { 7: { Id: 7, status: "Ancestor/Descendant permission denied." } },
            people: { "-1": { Id: -1 } },
        },
    ];
    await assert.rejects(fetchInOneCall(7, { ancestors: 3 }, { api }), { name: "PrivateProfileError" });
});

// ---------- what to find ----------

test("relativesQuery asks only what was chosen", () => {
    assert.equal(relativesQuery(1, null, [3, 4], "ancestors"), 'ancestors="1" NotableProfile');
    assert.equal(relativesQuery(1, [50, 21], [3, 4], "ancestors"), 'ancestors="50,21" NotableProfile');
    assert.equal(relativesQuery(1, null, [3, 4], "relatives"), 'descendants="3,4" NotableProfile');
    assert.equal(relativesQuery(1, null, [3, 4], "all"), 'descendants="3,4" NotableProfile');
});

test("ancestors only: one call without descendants, and only ancestors within the chosen generations", async () => {
    const calls = [];
    const api = async (data) => {
        calls.push(data);
        return [{ status: "", resultByKey: {}, people: { 1: person(1, 0), 2: person(2, 1) } }];
    };
    const asked = [];
    const fetchFn = async (url) => {
        asked.push(decodeURIComponent(/Query=([^&]*)/.exec(url)[1]));
        return json({ response: { profiles: [1, 2, 77] } });
    };
    const found = [];
    await searchAncestral({
        rootId: 1,
        generations: 3,
        find: "ancestors",
        api,
        fetchFn,
        onFound: (f) => found.push([f.kind, f.ids]),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].descendants, undefined, "no descendants asked for");
    assert.deepEqual(asked, ['ancestors="1" NotableProfile']);
    assert.deepEqual(found, [["ancestor", [2]]], "77, further back than the chosen generations, is left out");
});

test("descendants and cousins only: the nearer ancestors in the answer are left out", async () => {
    const api = async () => [
        {
            status: "",
            resultByKey: {},
            people: { 1: person(1, 0, { Father: 2 }), 2: person(2, 1), 10: person(10, 1, { Father: 1 }) },
        },
    ];
    const asked = [];
    const fetchFn = async (url) => {
        asked.push(decodeURIComponent(/Query=([^&]*)/.exec(url)[1]));
        return json({ response: { profiles: [2, 1, 10, 20] } });
    };
    const found = [];
    await searchAncestral({
        rootId: 1,
        generations: 3,
        find: "relatives",
        api,
        fetchFn,
        onFound: (f) => found.push([f.kind, f.ids]),
    });
    assert.deepEqual(asked, ['descendants="2" NotableProfile']);
    assert.deepEqual(found, [
        ["descendant", [10]],
        ["cousin", [20]],
    ]);
});

// ---------- Relationship or Connection ----------

import { finderLink } from "../notable_data.js";

test("blood relatives link to the Relationship Finder, relatives by marriage to the Connection Finder", () => {
    const blood = finderLink("Palotay-1", "Kronberger-1", true);
    assert.equal(blood.label, "Relationship");
    assert.equal(
        blood.url,
        "https://www.wikitree.com/index.php?title=Special:Relationship&action=calculate" +
            "&person1Name=Palotay-1&person2Name=Kronberger-1"
    );
    const marriage = finderLink("Palotay-1", "Szent-Györgyi-5", false, { root: "J Palotay", other: "Albert" });
    assert.equal(marriage.label, "Connection");
    assert.equal(
        marriage.url,
        "https://www.wikitree.com/index.php?title=Special:Connection&action=connect" +
            "&person1Name=Palotay-1&person2Name=Szent-Gy%C3%B6rgyi-5"
    );
    assert.match(marriage.title, /Connection Finder for J Palotay and Albert, which follows marriages too/);
});

// ---------- logged in, but the profile still comes back private ----------

import { checkAppsLogin } from "../notable_data.js";

test("your own private profile never sends you to your own Trusted List", () => {
    const msg = privateProfileMessage("Raitt-92", { isLoggedIn: true, name: "Raitt-92", login: "ok" });
    assert.match(msg, /this is your own profile/);
    assert.match(msg, /Logout.*Apps Login/);
    assert.doesNotMatch(msg, /Trusted List/);
    // Spaces and case in the WikiTree ID do not matter.
    assert.match(privateProfileMessage("van Dyke-1", { isLoggedIn: true, name: "Van_Dyke-1" }), /your own profile/);
});

test("an expired Apps Login is named as the cause", () => {
    const msg = privateProfileMessage("Raitt-92", { isLoggedIn: true, name: "Raitt-92", login: "expired" });
    assert.match(msg, /no longer recognizes that login/);
    assert.match(msg, /Apps Login/);
    assert.doesNotMatch(msg, /Trusted List/);
});

test("checkAppsLogin asks the API's checkLogin", async () => {
    const asked = [];
    const answer = (result) => async (data) => {
        asked.push(data);
        return { clientLogin: { checkLogin: data.checkLogin, result } };
    };
    assert.equal(await checkAppsLogin(456, { api: answer("ok") }), "ok");
    assert.equal(await checkAppsLogin(456, { api: answer("error") }), "expired");
    assert.deepEqual([asked[0].action, asked[0].checkLogin], ["clientLogin", 456]);
    assert.equal(await checkAppsLogin(456, { api: async () => ({}) }), "unknown");
    assert.equal(
        await checkAppsLogin(456, {
            api: async () => {
                throw new TypeError("Failed to fetch");
            },
        }),
        "unknown"
    );
    assert.equal(await checkAppsLogin(null, { api: answer("ok") }), "unknown");
});

test("a refusal rests the app for 5 minutes, not longer", async () => {
    resetPlusQueue();
    const before = Date.now();
    const err = await fetchPlusNotableIds(1, { fetchFn: async () => ({ ok: false, status: 429 }) }).catch((e) => e);
    assert.ok(err.until - before <= 5 * 60 * 1000 + 1000 && err.until - before >= 5 * 60 * 1000 - 1000);
    resetPlusQueue();
});

// ---------- exact relationship on cousin cards ----------

import { fetchCousinRelationship } from "../notable_data.js";

test("a cousin's exact relationship comes from the path through a common ancestor", async () => {
    // Peasley-222 and Hammon-668: up 5 generations to the shared ancestor, then down 3.
    const asked = [];
    const api = async (data) => {
        asked.push(data);
        const steps = ["parent", "parent", "parent", "parent", "parent", "child", "child", "child"];
        return [{ status: "", path: [{ Name: "Peasley-222" }, ...steps.map((pathType) => ({ pathType }))] }];
    };
    assert.equal(
        await fetchCousinRelationship("Peasley-222", "Hammon-668", "Male", { api }),
        "2nd cousin twice removed"
    );
    assert.equal(asked[0].relation, 2, "shortest path through a common ancestor");
    assert.equal(asked[0].keys, "Peasley-222,Hammon-668");
});

test("no path, or one through a marriage, keeps the general label", async () => {
    const none = async () => [{ status: "", path: [] }];
    assert.equal(await fetchCousinRelationship("A-1", "B-2", "Female", { api: none }), null);
    const marriage = async () => [{ status: "", path: [{}, { pathType: "spouse" }, { pathType: "parent" }] }];
    assert.equal(await fetchCousinRelationship("A-1", "B-2", "Female", { api: marriage }), null);
});
