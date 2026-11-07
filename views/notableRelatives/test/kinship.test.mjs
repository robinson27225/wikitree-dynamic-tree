import { test } from "node:test";
import assert from "node:assert/strict";
import { parentGraph, relationshipNamer, describeRelationship, relationshipFromSteps } from "../kinship.js";

// 1 & 2 are a couple with children 3 (male) and 4 (female). 5 is 3's son, 6 is 4's son.
// 7 (the starting profile) is 5's son; 8 is 6's son; 9 is 8's daughter.
// 10 is 1's son with another wife, 11.
const family = [
    { id: 1, father: 0, mother: 0 },
    { id: 2, father: 0, mother: 0 },
    { id: 3, father: 1, mother: 2 },
    { id: 4, father: 1, mother: 2 },
    { id: 5, father: 3, mother: 0 },
    { id: 6, father: 0, mother: 4 },
    { id: 7, father: 5, mother: 0 },
    { id: 8, father: 6, mother: 0 },
    { id: 9, father: 8, mother: 0 },
    { id: 10, father: 1, mother: 11 },
    { id: 11, father: 0, mother: 0 },
    { id: 20, father: 0, mother: 0 },
];
const graph = parentGraph(family);
const fromRoot = relationshipNamer(graph, 7);

test("direct ancestors and descendants", () => {
    assert.equal(fromRoot(5, "Male", 1).label, "father");
    assert.equal(fromRoot(3, "Male", 2).label, "grandfather");
    assert.equal(fromRoot(2, "Female", 3).label, "great-grandmother");
    assert.equal(relationshipNamer(graph, 1)(9, "Female", 4).label, "2nd great-granddaughter");
    assert.equal(relationshipNamer(graph, 1)(5, "Male", 2).label, "grandson");
});

test("aunts, uncles and cousins", () => {
    assert.equal(fromRoot(4, "Female", 4).label, "great-aunt");
    assert.equal(fromRoot(8, "Male", 6).label, "2nd cousin");
    assert.equal(fromRoot(9, "Female", 7).label, "2nd cousin once removed");
    assert.equal(relationshipNamer(graph, 5)(8, "Male", 5).label, "1st cousin once removed");
    assert.equal(relationshipNamer(graph, 5)(6, "Male", 4).label, "1st cousin");
});

test("half only when the other parents are known and differ", () => {
    assert.equal(relationshipNamer(graph, 3)(4, "Female", 1).label, "sister");
    assert.equal(relationshipNamer(graph, 3)(10, "Male", 1).label, "half brother");
    // 5 and 6 descend from 3 and 4 by one recorded parent each; their parents 3 and 4 are full siblings.
    assert.equal(relationshipNamer(graph, 5)(6, "Male", 3).label, "1st cousin");
    // One parent unknown: not called half.
    const g = parentGraph([
        { id: 1, father: 0, mother: 0 },
        { id: 2, father: 1, mother: 0 },
        { id: 3, father: 1, mother: 0 },
    ]);
    assert.equal(relationshipNamer(g, 2)(3, "Male", 1).label, "brother");
});

test("no shared ancestor means marriage", () => {
    assert.deepEqual(fromRoot(20, "Female", 1), { label: "wife", isBlood: false });
    assert.deepEqual(fromRoot(20, "Male", 3), { label: "related by marriage", isBlood: false });
    assert.equal(fromRoot(7, "Male", 0).label, "starting profile");
});

test("describeRelationship wording", () => {
    assert.equal(describeRelationship(5, 2, false, ""), "1st cousin 3 times removed");
    assert.equal(describeRelationship(4, 1, false, "Male"), "2nd great-uncle");
    assert.equal(describeRelationship(1, 3, true, "Female"), "half great-niece");
    assert.equal(describeRelationship(12, 12, false, ""), "11th cousin");
});

test("a closer marriage link comes first", () => {
    // 9 is 7's 2nd cousin once removed by blood (6 steps: up 3, across, down 3), but reached at degree 1 by marriage.
    assert.deepEqual(fromRoot(9, "Female", 1), { label: "wife (also 2nd cousin once removed)", isBlood: false });
    assert.deepEqual(fromRoot(9, "Female", 3), {
        label: "related by marriage (also 2nd cousin once removed)",
        isBlood: false,
    });
    assert.deepEqual(fromRoot(9, "Female", 6), { label: "2nd cousin once removed", isBlood: true });
    assert.deepEqual(fromRoot(8, "Male", 5), { label: "2nd cousin", isBlood: true });
    assert.deepEqual(relationshipNamer(graph, 3)(4, "Female", 1), { label: "sister", isBlood: true });
    assert.equal(fromRoot(9, "Female", null).label, "2nd cousin once removed");
});

test("relationshipFromSteps reads a connection path", () => {
    const label = (steps, g = "") => relationshipFromSteps(steps, g).label;
    assert.equal(label(["parent", "parent"], "Male"), "grandfather");
    assert.equal(label(["child", "child"], "Female"), "granddaughter");
    assert.equal(label(["parent", "sibling", "child"]), "1st cousin");
    assert.equal(label(["parent", "parent", "sibling", "child"], "Female"), "1st cousin once removed");
    assert.equal(label(["sibling"], "Male"), "brother");
    assert.equal(label(["spouse"], "Female"), "wife");
    assert.equal(label(["child", "spouse", "parent"]), "related by marriage");
    assert.equal(relationshipFromSteps(["parent", "spouse"], "").isBlood, false);
});
