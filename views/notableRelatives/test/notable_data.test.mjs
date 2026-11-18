import { test } from "node:test";
import assert from "node:assert/strict";
import {
    plusSettings,
    fetchCc7,
    fetchPlusNotableIds,
    fetchProfiles,
    fetchConnection,
    applyConnection,
    buildRecords,
    applyFilters,
    facets,
    groupRecords,
    descendantsQueries,
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

const person = (Id, Degrees, extra = {}) => ({
    Id,
    Name: `P-${Id}`,
    Father: 0,
    Mother: 0,
    Meta: { Degrees },
    ...extra,
});

test("fetchCc7 asks one degree at a time and follows pages within a degree", async () => {
    const { api, calls } = fakeApi([
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
    const root = { status: "", people: { 1: person(1, 0) } };
    const same = { status: MAX, people: { 2: person(2, 1) } };
    const { api, calls } = fakeApi([root, same, same, { status: "", people: {} }]);
    await fetchCc7(1, { api, degrees: 2 });
    assert.equal(calls.length, 4);

    const failing = fakeApi([root, { status: "Limit exceeded", people: {} }]);
    await assert.rejects(fetchCc7(1, { api: failing.api }), /Limit exceeded/);

    const partial = fakeApi([
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
    assert.deepEqual(res, { ids: [722, 726], dataDate: "2026-11-01" });
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

test("descendantsQueries gives each ancestor its own NotableProfile and splits long queries", () => {
    // Numeric ids: WikiTree+ splits an unquoted "Söderblom-7" or "O'Brien-1" and finds nothing.
    assert.deepEqual(descendantsQueries([21773300, 2]), [
        "Descendants=21773300 NotableProfile OR Descendants=2 NotableProfile",
    ]);
    const many = Array.from({ length: 200 }, (_, i) => 10000000 + i);
    const queries = descendantsQueries(many, 1000);
    assert.ok(queries.length > 1);
    assert.ok(queries.every((q) => encodeURIComponent(q).length <= 1000));
    assert.equal(queries.join(" OR ").split(" OR ").length, 200, "every ancestor is asked about once");
    assert.deepEqual(descendantsQueries([]), []);
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

test("searchAncestral finds ancestors, descendants and cousins, nearest generation first", async () => {
    // Ancestors: 2, 3 (parents, gen 1) and 4 (grandparent, gen 2). Descendant: 10 (child).
    const apiPages = {
        "ancestors:1": { 2: person(2, 1, { Name: "Dad-2" }), 3: person(3, 1, { Name: "Mum-3" }) },
        "ancestors:2": { 4: person(4, 2, { Name: "Gran-4" }) },
        "ancestors:3": {},
        "descendants:1": { 10: person(10, 1) },
        "descendants:2": {},
    };
    const api = async (data) => {
        const relation = data.ancestors ? "ancestors" : "descendants";
        return [{ status: "", people: apiPages[`${relation}:${data[relation]}`] || {} }];
    };
    const plusAnswers = new Map([
        ["Ancestors=1 NotableProfile", [4, 77]], // 4 is within reach, 77 further back
        ["Descendants=1 NotableProfile", [10]],
        ["Descendants=2 NotableProfile OR Descendants=3 NotableProfile", [10, 20, 21]],
        ["Descendants=4 NotableProfile", [2, 20, 30]],
    ]);
    const asked = [];
    const fetchFn = async (url) => {
        const query = decodeURIComponent(/Query=([^&]*)/.exec(url)[1]);
        asked.push(query);
        return {
            ok: true,
            json: async () => ({
                response: { profiles: plusAnswers.get(query) || [] },
                debug: { dataDate: "2026-11-01" },
            }),
        };
    };
    const found = [];
    const result = await searchAncestral({
        rootId: 1,
        generations: 3,
        api,
        fetchFn,
        onFound: (f) => found.push([f.kind, f.generation ?? null, f.ids]),
    });
    assert.deepEqual(found, [
        ["ancestor", null, [4]],
        ["ancestor-far", null, [77]],
        ["descendant", null, [10]],
        ["cousin", 1, [20, 21]],
        ["cousin", 2, [30]],
    ]);
    assert.equal(result.dataDate, "2026-11-01");
    assert.equal(result.ancestors.get(4).degree, 2);
    assert.equal(result.descendants.get(10).degree, 1);
    assert.equal(asked.length, 4, "generation 3 has no ancestors, so nothing is asked");
});

test("searchAncestral never retries a failed WikiTree+ search, and stops searching after it", async () => {
    const api = async (data) => [
        {
            status: "",
            people:
                data.ancestors === 1
                    ? { 2: person(2, 1, { Name: "Dad-2" }) }
                    : data.ancestors === 2
                      ? { 4: person(4, 2) }
                      : {},
        },
    ];
    const asked = [];
    const fetchFn = async (url) => {
        asked.push(url);
        if (url.includes("Descendants%3D2%20")) return { ok: false, status: 500 };
        return { ok: true, json: async () => ({ response: { profiles: [] } }) };
    };
    const result = await searchAncestral({ rootId: 1, generations: 3, api, fetchFn });
    assert.equal(asked.filter((u) => u.includes("Descendants%3D2%20")).length, 1, "asked once, not retried");
    assert.ok(!asked.some((u) => u.includes("Descendants%3D4%20")), "generation 2 is not searched after the failure");
    assert.equal(result.failedQueries, 1);
    assert.equal(result.stoppedAt, 1);
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
    const old = build("ancestor-far", [77]);
    assert.deepEqual([old.groupKey, old.groupHeading], ["anc-far", "Notable ancestors more than 12 generations back"]);
    const cousin = build("cousin", [30], 9);
    assert.deepEqual(
        [cousin.groupKey, cousin.groupHeading, cousin.groupNote, cousin.relationship, cousin.countries],
        [
            "g9",
            "Shared 7th great-grandparents",
            "up to 8th cousins, some removed",
            "shares the starting profile's 7th great-grandparents",
            ["Ireland"],
        ]
    );
    assert.equal(build("cousin", [99], 3), undefined, "a profile WikiTree did not return is skipped");
    const sorted = groupRecords([cousin, old, gran, build("descendant", [10])]).map((g) => g.key);
    assert.deepEqual(sorted, ["anc", "desc", "g9", "anc-far"]);
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
    notablesInCc7,
    withRetry,
    isNetworkError,
    DIRECT_LINE_GROUPS,
} from "../notable_data.js";

test("fetchAllNotableIds pages through every notable profile and asks only once", async () => {
    resetAllNotableIds();
    const urls = [];
    const fetchFn = async (u) => {
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
    assert.deepEqual([...DIRECT_LINE_GROUPS].sort(), ["anc", "anc-far", "desc"]);
});

// ---------- 0.2.0: birth and adoptive parents ----------

import { parentOptions, chosenParents, ancestorsFrom, notableAncestorsQuery } from "../notable_data.js";

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

test("notableAncestorsQuery asks from the chosen parents, by numeric id, with each parent itself", () => {
    assert.equal(notableAncestorsQuery(1, null, new Map()), "Ancestors=1 NotableProfile");
    const ancestors = new Map([
        [50, { id: 50, name: "Söderblom-7" }],
        [21, { id: 21, name: "" }],
    ]);
    assert.equal(
        notableAncestorsQuery(1, [50, 21], ancestors),
        'Ancestors=50 NotableProfile OR WikiTreeID="Söderblom-7" NotableProfile OR Ancestors=21 NotableProfile'
    );
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
    const result = await searchAncestral({ rootId: 1, generations: 2, parentIds: bio, api, fetchFn });
    assert.deepEqual([...result.ancestors.keys()].sort(), [21, 50]);
    assert.ok(asked[0].startsWith("Ancestors=50 NotableProfile OR "), asked[0]);
    assert.ok(!asked.some((q) => /\b40\b/.test(q)), "the adoptive father is not searched");
    assert.ok(asked.includes("Descendants=50 NotableProfile OR Descendants=21 NotableProfile"));
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

test("descendantsQueries puts at most 20 ancestors in one WikiTree+ request", () => {
    const ids = Array.from({ length: 45 }, (_, i) => i + 1);
    const queries = descendantsQueries(ids);
    assert.deepEqual(
        queries.map((q) => q.split(" OR ").length),
        [20, 20, 5]
    );
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
