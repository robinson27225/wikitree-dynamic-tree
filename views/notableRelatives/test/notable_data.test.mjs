import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
    const res = await fetchPlusNotableIds("Windsor-1", { fetchFn });
    assert.deepEqual(res, { ids: [722, 726], dataDate: "2026-11-01" });
    assert.match(url, /WTWebProfileSearch\/TA-notableRelatives\.json\?Query=CC7%3DWindsor-1%20NotableProfile/);
    assert.match(url, /appID=TA-notableRelatives/);

    const none = await fetchPlusNotableIds("X-1", {
        fetchFn: async () => ({ ok: true, json: async () => ({ response: { found: 0 } }) }),
    });
    assert.deepEqual(none.ids, []);
    await assert.rejects(fetchPlusNotableIds("X-1", { fetchFn: async () => ({ ok: false, status: 500 }) }), /HTTP 500/);
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
    assert.deepEqual(descendantsQueries(["A-1", "B-2"]), [
        "Descendants=A-1 NotableProfile OR Descendants=B-2 NotableProfile",
    ]);
    const many = Array.from({ length: 200 }, (_, i) => `Surname-${1000 + i}`);
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
        ["Ancestors=Me-1 NotableProfile", [4, 77]], // 4 is within reach, 77 further back
        ["Descendants=Me-1 NotableProfile", [10]],
        ["Descendants=Dad-2 NotableProfile OR Descendants=Mum-3 NotableProfile", [10, 20, 21]],
        ["Descendants=Gran-4 NotableProfile", [2, 20, 30]],
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
        rootWtId: "Me-1",
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

test("searchAncestral retries a failed WikiTree+ query once, then counts it", async () => {
    const api = async (data) => [
        { status: "", people: data.ancestors === 1 ? { 2: person(2, 1, { Name: "Dad-2" }) } : {} },
    ];
    let failures = 0;
    const fetchFn = async (url) => {
        if (url.includes("Dad-2")) {
            failures++;
            return { ok: false, status: 500 };
        }
        return { ok: true, json: async () => ({ response: { profiles: [] } }) };
    };
    const result = await searchAncestral({ rootId: 1, rootWtId: "Me-1", generations: 2, api, fetchFn });
    assert.equal(failures, 2);
    assert.equal(result.failedQueries, 1);
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
