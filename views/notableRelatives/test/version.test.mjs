import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION, AUTHOR_ID, AUTHOR_URL, HELP_URL } from "../notable_data.js";

test("the version is semantic and matches the newest CHANGELOG entry", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
    const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const newest = /^## (\d+\.\d+\.\d+) /m.exec(changelog);
    assert.ok(newest, "CHANGELOG.md has a version heading");
    assert.equal(newest[1], VERSION);
});

test("the credit line links to the author's profile and the Help page", () => {
    assert.equal(AUTHOR_ID, "Robinson-27225");
    assert.equal(AUTHOR_URL, "https://www.wikitree.com/wiki/Robinson-27225");
    assert.equal(HELP_URL, "https://www.wikitree.com/wiki/Space:Notable_Relatives");
});
