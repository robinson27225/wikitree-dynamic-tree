// the view uses the Tree Apps page's own WikiTreeAPI global
global.WikiTreeAPI = {
    getPeople: (...args) => global.mockGetPeople(...args),
};

const {
    MAX_CC_PAGES,
    fetchAncestors,
    fetchNearby,
    fetchScope,
} = require("../../views/surnameTree/surname_tree_data.js");

const person = (Id, extra = {}) => ({ Id, Name: `X-${Id}`, LastNameAtBirth: `Name${Id}`, ...extra });

// a pretend tree: 1 was adopted by 2 and 3 (2's parents are 8 and 9); 1's birth parents are 4 and 5; 4's parents are 6 and 7
const TREE = {
    1: person(1, { Father: 2, Mother: 3, BioFather: 4, BioMother: 5, DataStatus: { Father: 5, Mother: 5 } }),
    2: person(2, { Father: 8, Mother: 9, DataStatus: { Father: 20, Mother: 20 } }),
    3: person(3),
    4: person(4, { Father: 6, Mother: 7, DataStatus: { Father: 20, Mother: 20 } }),
    5: person(5),
    6: person(6),
    7: person(7),
    8: person(8),
    9: person(9),
};

const lookup = (k) => Object.values(TREE).find((p) => p.Id === Number(k) || p.Name === k);

beforeEach(() => {
    global.mockGetPeople = jest.fn((app, keys) => {
        const people = {};
        [].concat(keys).forEach((k) => {
            const found = lookup(k);
            if (found) people[found.Id] = found;
        });
        return Promise.resolve(["", {}, people]);
    });
});

const summary = (result) =>
    Object.fromEntries(result.entries.map((e) => [e.person.Id, e.bio && e.adopt ? "both" : e.bio ? "bio" : "adopt"]));

describe("fetchAncestors", () => {
    it("follows birth parents and adoptive parents, marking each person by how they are connected", async () => {
        expect(summary(await fetchAncestors("X-1", 3))).toEqual({
            1: "bio",
            4: "bio",
            5: "bio",
            6: "bio",
            7: "bio",
            2: "adopt",
            3: "adopt",
            8: "adopt",
            9: "adopt",
        });
    });

    it("stops after the number of generations asked for", async () => {
        expect(Object.keys(summary(await fetchAncestors("X-1", 1))).sort()).toEqual(["1", "2", "3", "4", "5"]);
        expect(Object.keys(summary(await fetchAncestors("X-1", 0)))).toEqual(["1"]);
    });

    it("asks for the parent fields it needs, and fetches a generation's parents together", async () => {
        await fetchAncestors("X-1", 2);
        expect(global.mockGetPeople.mock.calls[0][2]).toEqual(
            expect.arrayContaining(["BioFather", "BioMother", "DataStatus"])
        );
        // the root, then its four parents in one request, then their parents in one request
        expect(global.mockGetPeople).toHaveBeenCalledTimes(3);
        expect([].concat(global.mockGetPeople.mock.calls[1][1]).sort()).toEqual([2, 3, 4, 5]);
    });

    it("reports progress, and copes with a profile that cannot be found", async () => {
        const progress = jest.fn();
        await fetchAncestors("X-1", 1, progress);
        expect(progress).toHaveBeenCalled();
        expect(await fetchAncestors("X-404", 3)).toEqual({ entries: [] });
    });

    it("marks a person reached both ways as both", async () => {
        TREE[10] = person(10, { Father: 11, Mother: 4, DataStatus: { Father: 5, Mother: 20 } }); // 4 is a birth parent via 10's mother
        TREE[11] = person(11, { Father: 4, DataStatus: { Father: 20 } }); // 11, 10's adoptive father, is 4's child, so 4 is also above 11
        const result = await fetchAncestors("X-10", 3);
        expect(summary(result)[4]).toBe("both");
        delete TREE[10];
        delete TREE[11];
    });
});

describe("fetchNearby", () => {
    const page = (from, n, extra = {}) =>
        Object.fromEntries(Array.from({ length: n }, (_, i) => [from + i, person(from + i, extra)]));

    it("reads pages until the API stops saying there are more, and reports progress", async () => {
        global.mockGetPeople = jest
            .fn()
            .mockResolvedValueOnce(["Maximum number of profiles reached", {}, { ...page(1, 1000), 1: TREE[1] }])
            .mockResolvedValueOnce(["", {}, page(1001, 40)]);
        const progress = jest.fn();
        const result = await fetchNearby("X-1", 7, progress);
        expect(result.truncated).toBe(false);
        expect(progress.mock.calls.map((c) => c[0])).toEqual([1000, 1040]);
        expect(global.mockGetPeople.mock.calls[0][3]).toEqual({ nuclear: 7, start: 0, limit: 1000 });
        expect(global.mockGetPeople.mock.calls[1][3]).toEqual({ nuclear: 7, start: 1000, limit: 1000 });
        expect(global.mockGetPeople.mock.calls[0][2]).toEqual(
            expect.arrayContaining(["Spouses", "BioFather", "BirthLocation"])
        );
    });

    it("works out who is connected by birth and who by adoption", async () => {
        global.mockGetPeople = jest.fn(() =>
            Promise.resolve(["", {}, { 1: TREE[1], 2: TREE[2], 4: TREE[4], 6: TREE[6] }])
        );
        const result = await fetchNearby("X-1", 7);
        expect(summary(result)).toEqual({ 1: "bio", 4: "bio", 6: "bio", 2: "adopt" });
    });

    it("limits the answer to the degrees asked for", async () => {
        global.mockGetPeople = jest.fn(() => Promise.resolve(["", {}, { 1: TREE[1], 4: TREE[4], 6: TREE[6] }]));
        expect(Object.keys(summary(await fetchNearby("X-1", 1))).sort()).toEqual(["1", "4"]);
    });

    it("fetches the profile itself when the answer does not include it", async () => {
        global.mockGetPeople = jest.fn((app, keys, fields, options) =>
            Promise.resolve(options ? ["", {}, { 4: TREE[4], 6: TREE[6] }] : ["", {}, { 1: TREE[1] }])
        );
        expect(Object.keys(summary(await fetchNearby("X-1", 7))).sort()).toEqual(["1", "4", "6"]);
    });

    it("gives up after the most pages and says it was cut short", async () => {
        global.mockGetPeople = jest.fn(() =>
            Promise.resolve(["Maximum number of profiles reached", {}, { 1: TREE[1] }])
        );
        const result = await fetchNearby("X-1", 7);
        expect(global.mockGetPeople).toHaveBeenCalledTimes(MAX_CC_PAGES);
        expect(result.truncated).toBe(true);
    });
});

describe("fetchScope", () => {
    it("picks the right fetch for each reach", async () => {
        expect(Object.keys(summary(await fetchScope("ancestors", "X-1", 1))).sort()).toEqual(["1", "2", "3", "4", "5"]);
        global.mockGetPeople = jest.fn(() => Promise.resolve(["", {}, { 1: TREE[1] }]));
        expect(Object.keys(summary(await fetchScope("cc7", "X-1", 7)))).toEqual(["1"]);
        expect(global.mockGetPeople.mock.calls[0][3]).toEqual(expect.objectContaining({ nuclear: 7 }));
    });
});
