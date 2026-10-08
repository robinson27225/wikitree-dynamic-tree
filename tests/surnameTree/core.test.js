/** @jest-environment node */
import {
    CELL,
    COLORS,
    LOOKS,
    lookById,
    HEIGHT,
    NAME_KINDS,
    SCOPES,
    WIDTH,
    joinUp,
    touching,
    birthYear,
    barkLines,
    boxOffsets,
    buildMasks,
    buildTree,
    chooseAngle,
    crownBalance,
    colorFor,
    categoryQuery,
    searchQuery,
    groupQuery,
    unseenNote,
    layoutToFill,
    BANNER_FONTS,
    BANNER_FRAME,
    buildBannerShape,
    frameOf,
    unseenRows,
    crownColors,
    chooseByRelation,
    countSurnames,
    fontSizeFor,
    formatDate,
    fullName,
    groupNames,
    groupSurnames,
    kindById,
    namesOf,
    splitNames,
    hashString,
    layoutWords,
    wordCells,
    hslToHex,
    lifeEvent,
    parentEdges,
    reachFrom,
    reachNearby,
    relationNote,
    scopeById,
    seededRandom,
    surnameOf,
} from "../../views/surnameTree/surname_tree_core.js";

const measure = (text, size) => text.length * size * 0.5;

describe("countSurnames", () => {
    it("counts each person once under their birth surname, ignoring case, most common first", () => {
        const people = [
            { LastNameAtBirth: "Smith", LastNameCurrent: "Jones" },
            { LastNameAtBirth: "SMITH" },
            { LastNameAtBirth: "smith" },
            { LastNameAtBirth: "Baker" },
            { LastNameAtBirth: "Able" },
        ];
        expect(countSurnames(people)).toEqual([
            { text: "SMITH", count: 3 },
            { text: "ABLE", count: 1 },
            { text: "BAKER", count: 1 },
        ]);
    });

    it("falls back to the current surname and skips unknown, private and empty names", () => {
        const people = [
            { LastNameAtBirth: "", LastNameCurrent: "Cave" },
            { LastNameAtBirth: "Unknown" },
            { LastNameAtBirth: "Private" },
            { LastNameAtBirth: "  " },
            null,
            {},
        ];
        expect(countSurnames(people)).toEqual([{ text: "CAVE", count: 1 }]);
    });

    it("copes with no list at all", () => {
        expect(countSurnames(undefined)).toEqual([]);
    });
});

describe("seededRandom and hashString", () => {
    it("repeats for the same seed and differs for another", () => {
        const a = seededRandom(7);
        const b = seededRandom(7);
        expect([a(), a(), a()]).toEqual([b(), b(), b()]);
        expect(seededRandom(8)()).not.toEqual(seededRandom(7)());
    });
    it("hashes the same text to the same number", () => {
        expect(hashString("Robinson-27225")).toBe(hashString("Robinson-27225"));
        expect(hashString("Robinson-27225")).not.toBe(hashString("Robinson-27226"));
    });
});

describe("fontSizeFor", () => {
    it("is biggest for the most common name and grows with the count", () => {
        expect(fontSizeFor(10, 1, 10, 100, 12)).toBe(100);
        expect(fontSizeFor(1, 1, 10, 100, 12)).toBe(12);
        expect(fontSizeFor(5, 1, 10, 100, 12)).toBeGreaterThan(fontSizeFor(2, 1, 10, 100, 12));
    });
    it("gives a middling size when every name is equally common", () => {
        expect(fontSizeFor(3, 3, 3, 100, 20)).toBe(60);
    });
});

describe("buildTree", () => {
    it("gives the same tree for the same seed and a different one for another", () => {
        expect(buildTree(7)).toEqual(buildTree(7));
        expect(buildTree(7).crown).not.toEqual(buildTree(8).crown);
        expect(buildTree(7).trunk).not.toEqual(buildTree(8).trunk);
    });

    it("varies in size, tint and number of limbs from tree to tree", () => {
        const trees = [1, 2, 3, 4, 5, 6, 7, 8].map(buildTree);
        expect(new Set(trees.map((t) => t.crown.length)).size).toBeGreaterThan(1);
        expect(new Set(trees.map((t) => t.trunk.length)).size).toBeGreaterThan(4);
        const hues = trees[0].crown.map((c) => Math.round(c.hue));
        expect(new Set(hues).size).toBeGreaterThan(5); // each clump of leaves has its own green
    });

    it("has no small bubbles on the outline: every clump of leaves is big", () => {
        const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
        const smallest = Math.min(...seeds.flatMap((seed) => buildTree(seed).crown.map((c) => c.r)));
        expect(smallest).toBeGreaterThanOrEqual(84.9);
        seeds.forEach((seed) => {
            const { crown } = buildTree(seed);
            expect(crown.length).toBeGreaterThanOrEqual(10);
            expect(crown.length).toBeLessThanOrEqual(12);
        });
    });

    it("keeps the crown inside the picture and the trunk rooted at the bottom middle", () => {
        [1, 2, 3, 4, 5, 6].forEach((seed) => {
            const tree = buildTree(seed);
            tree.crown.forEach((c) => {
                expect(c.x - c.r).toBeGreaterThanOrEqual(7);
                expect(c.x + c.r).toBeLessThanOrEqual(WIDTH - 7);
                expect(c.y - c.r).toBeGreaterThanOrEqual(7);
                expect(c.y + c.r).toBeLessThanOrEqual(651);
            });
            const base = tree.trunk[0];
            expect(Math.abs(base.x - 500)).toBeLessThanOrEqual(61);
            expect(base.y).toBeGreaterThan(HEIGHT - 20);
            expect(base.r).toBeGreaterThan(95);
        });
    });
});

describe("an oak: stout trunk, flared roots, forking limbs, bark", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

    it("has a short, thick trunk, widest at the ground and narrowing as it climbs", () => {
        seeds.forEach((seed) => {
            const { spine } = buildTree(seed);
            const first = spine[0];
            const last = spine[spine.length - 1];
            expect(first.r).toBeGreaterThanOrEqual(100);
            expect(last.r).toBeGreaterThanOrEqual(58);
            expect(first.r).toBeGreaterThan(last.r * 1.4);
            // the flare: the radius drops faster over the first third than over the rest
            const third = spine[Math.floor(spine.length / 3)];
            expect(first.r - third.r).toBeGreaterThan(third.r - last.r);
            // short and stout: it is not much taller than the crown is wide at its narrowest
            expect(first.y - last.y).toBeLessThan(500);
        });
    });

    it("spreads roots over the ground on both sides of the trunk", () => {
        seeds.forEach((seed) => {
            const { trunk, spine } = buildTree(seed);
            const baseX = spine[0].x;
            const roots = trunk.filter((c) => c.y > 780 && Math.abs(c.x - baseX) > 130);
            expect(roots.some((c) => c.x < baseX)).toBe(true);
            expect(roots.some((c) => c.x > baseX)).toBe(true);
        });
    });

    it("forks the trunk inside the crown into limbs, each of them thick", () => {
        seeds.forEach((seed) => {
            const { crown, trunk, spine, tips } = buildTree(seed);
            const fork = spine[spine.length - 1];
            expect(crown.some((c) => Math.hypot(fork.x - c.x, fork.y - c.y) < c.r)).toBe(true);
            expect(tips.length).toBeGreaterThanOrEqual(3);
            // limbs are the circles after the spine and the roots; near the fork they are thick
            const nearFork = trunk.filter((c) => Math.hypot(c.x - fork.x, c.y - fork.y) < 30 && !spine.includes(c));
            expect(nearFork.length).toBeGreaterThan(3);
            expect(Math.max(...nearFork.map((c) => c.r))).toBeGreaterThanOrEqual(30);
        });
    });

    it("has ridges of bark running up the trunk, inside it", () => {
        const tree = buildTree(9);
        const lines = barkLines(tree);
        expect(lines.length).toBeGreaterThanOrEqual(10);
        lines.forEach((line) => {
            expect(line.length).toBeGreaterThan(5);
            // vertical, mostly: it climbs the trunk
            expect(Math.abs(line[0][1] - line[line.length - 1][1])).toBeGreaterThan(40);
            line.forEach(([x, y]) => {
                expect(tree.spine.some((c) => Math.hypot(x - c.x, y - c.y) <= c.r + 1)).toBe(true);
            });
        });
        expect(barkLines(buildTree(9))).toEqual(lines);
        expect(barkLines(buildTree(10))).not.toEqual(lines);
        expect(barkLines({ seed: 1 })).toEqual([]);
    });

    it("keeps words off the strip of ground the trunk stands in", () => {
        const masks = buildMasks(buildTree(4));
        let inGround = 0;
        for (let row = Math.floor(856 / CELL); row < masks.rows; row++) {
            for (let col = 0; col < masks.cols; col++)
                inGround += masks.trunk[row * masks.cols + col] + masks.crown[row * masks.cols + col];
        }
        expect(inGround).toBe(0);
    });
});

describe("a tree is balanced over its trunk", () => {
    const seeds = Array.from({ length: 80 }, (_, i) => i + 1);

    it("measures how lopsided a crown is", () => {
        const even = [
            { x: 400, y: 300, r: 100 },
            { x: 600, y: 300, r: 100 },
        ];
        expect(crownBalance(even, 500)).toEqual({ mass: 0, offset: 0, reach: 0, height: 0 });
        const leaning = [
            { x: 200, y: 200, r: 150 },
            { x: 420, y: 330, r: 60 },
            { x: 700, y: 480, r: 40 },
        ];
        const measured = crownBalance(leaning, 500);
        expect(measured.mass).toBeGreaterThan(0.6);
        expect(measured.offset).toBeGreaterThan(100);
        expect(measured.height).toBeGreaterThan(100);
    });

    it("has about as many leaves on each side of the trunk, at about the same height", () => {
        seeds.forEach((seed) => {
            const tree = buildTree(seed);
            const balance = crownBalance(tree.crown, tree.axis);
            expect(balance.mass).toBeLessThan(0.2);
            expect(balance.height).toBeLessThan(25);
        });
    });

    it("is centred over the trunk, in the middle of its leaves and across its width", () => {
        seeds.forEach((seed) => {
            const tree = buildTree(seed);
            const balance = crownBalance(tree.crown, tree.axis);
            expect(balance.offset).toBeLessThan(35);
            expect(balance.reach).toBeLessThan(35);
            // and the trunk stands on that line too
            expect(Math.abs(tree.spine[0].x - tree.axis)).toBeLessThanOrEqual(15);
            expect(Math.abs(tree.spine[tree.spine.length - 1].x - tree.axis)).toBeLessThanOrEqual(80);
        });
    });

    it("is still not symmetrical: the outline differs from side to side and from tree to tree", () => {
        const outlines = seeds.slice(0, 12).map((seed) => {
            const tree = buildTree(seed);
            return tree.crown
                .map((c) => Math.round(c.r))
                .sort((a, b) => a - b)
                .join(",");
        });
        expect(new Set(outlines).size).toBe(outlines.length);
        const lopsided = seeds.filter((seed) => {
            const tree = buildTree(seed);
            const mirror = tree.crown.every((c) =>
                tree.crown.some(
                    (o) =>
                        Math.abs(o.x - (2 * tree.axis - c.x)) < 6 && Math.abs(o.y - c.y) < 6 && Math.abs(o.r - c.r) < 4
                )
            );
            return !mirror;
        });
        expect(lopsided.length).toBe(seeds.length);
    });
});

describe("a tree holds together", () => {
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

    /** The circles that can be reached from the first by stepping between overlapping circles. */
    const reachable = (circles, overlap) => {
        const seen = new Set([0]);
        const queue = [0];
        while (queue.length) {
            const from = circles[queue.pop()];
            circles.forEach((c, i) => {
                if (!seen.has(i) && overlap(from, c)) {
                    seen.add(i);
                    queue.push(i);
                }
            });
        }
        return seen.size;
    };
    const meet = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 3;

    it("is one connected crown: no clump of leaves floats apart from the rest", () => {
        const loose = seeds.filter((seed) => {
            const { crown } = buildTree(seed);
            return reachable(crown, meet) !== crown.length;
        });
        expect(loose).toEqual([]);
    });

    it("pulls a clump that has drifted away back into the crown (the joining step works on its own)", () => {
        const circles = [
            { x: 500, y: 250, r: 200 },
            { x: 330, y: 330, r: 150 },
            { x: 60, y: 560, r: 55 }, // a group out on its own, as one once was on the far left
            { x: 30, y: 590, r: 40 }, // and a second one, attached only to that one
        ];
        expect(reachable(circles, meet)).toBeLessThan(circles.length);
        const joined = joinUp(circles.map((c) => ({ ...c })));
        expect(reachable(joined, meet)).toBe(circles.length);
        // the far clump moved in; the big ones did not move
        expect(joined[0]).toEqual(circles[0]);
        expect(joined[1]).toEqual(circles[1]);
        expect(joined[2].x).toBeGreaterThan(60);
    });

    it("is one connected trunk, with its limbs and twigs attached to it", () => {
        const loose = seeds.filter((seed) => {
            const { trunk } = buildTree(seed);
            return reachable(trunk, meet) !== trunk.length;
        });
        expect(loose).toEqual([]);
    });

    it("ends every limb and twig inside the crown, so none hangs in the air", () => {
        seeds.forEach((seed) => {
            const { crown, tips } = buildTree(seed);
            expect(tips.length).toBeGreaterThanOrEqual(3);
            tips.forEach((tip) => {
                const inside = crown.some((c) => Math.hypot(tip.x - c.x, tip.y - c.y) < c.r - 6);
                expect(inside).toBe(true);
            });
        });
    });

    it("joins the trunk to the crown", () => {
        seeds.forEach((seed) => {
            const { crown, trunk } = buildTree(seed);
            expect(trunk.some((t) => crown.some((c) => touching(t, c, 0)))).toBe(true);
        });
    });

    it("is made of clumps and limbs that stay in the picture", () => {
        seeds.forEach((seed) => {
            const { crown, trunk } = buildTree(seed);
            [...crown, ...trunk].forEach((c) => {
                expect(c.x).toBeGreaterThan(0);
                expect(c.x).toBeLessThan(WIDTH);
                expect(c.y).toBeLessThan(HEIGHT + 20);
            });
        });
    });
});

describe("buildMasks", () => {
    const tree = buildTree(5);
    const masks = buildMasks(tree);
    const count = (mask) => mask.reduce((n, v) => n + v, 0);

    it("has a crown and a trunk, which never share a cell", () => {
        expect(count(masks.crown)).toBeGreaterThan(20000);
        expect(count(masks.trunk)).toBeGreaterThan(1500);
        let both = 0;
        for (let i = 0; i < masks.crown.length; i++) if (masks.crown[i] && masks.trunk[i]) both++;
        expect(both).toBe(0);
    });

    it("follows the tree: a clump's middle is crown, the base of the trunk is trunk, and the corners are empty", () => {
        const cellAt = (x, y) => Math.floor(y / CELL) * masks.cols + Math.floor(x / CELL);
        const lobe = tree.crown[tree.crown.length - 1];
        expect(masks.crown[cellAt(lobe.x, lobe.y)]).toBe(1);
        const middle = tree.spine[Math.floor(tree.spine.length / 2)];
        expect(masks.trunk[cellAt(middle.x, middle.y)]).toBe(1);
        expect(masks.crown[cellAt(5, 5)] + masks.trunk[cellAt(5, 5)]).toBe(0);
        expect(masks.crown[cellAt(995, 870)] + masks.trunk[cellAt(995, 870)]).toBe(0);
    });

    it("differs from one tree to the next", () => {
        expect(buildMasks(buildTree(6)).crown).not.toEqual(masks.crown);
    });
});

describe("angles", () => {
    it("keeps the first words, and the big ones, nearly level", () => {
        const random = seededRandom(1);
        expect(chooseAngle(random, 0, 118)).toBe(0);
        for (let i = 0; i < 40; i++) {
            expect(Math.abs(chooseAngle(random, 1 + (i % 2), 40))).toBeLessThanOrEqual(12);
            expect(Math.abs(chooseAngle(random, 20, 90))).toBeLessThanOrEqual(12);
        }
    });

    it("turns the others to any angle, never past upright", () => {
        const random = seededRandom(2);
        const angles = Array.from({ length: 400 }, () => chooseAngle(random, 30, 30));
        expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(90);
        expect(angles.filter((a) => a === 0).length).toBeGreaterThan(80); // many level
        expect(angles.filter((a) => Math.abs(a) === 90).length).toBeGreaterThan(20); // some upright
        const slanted = angles.filter((a) => a !== 0 && Math.abs(a) !== 90);
        expect(slanted.length).toBeGreaterThan(150); // and plenty in between
        expect(slanted.filter((a) => a > 0).length).toBeGreaterThan(40);
        expect(slanted.filter((a) => a < 0).length).toBeGreaterThan(40);
        expect(new Set(slanted.map((a) => Math.round(a / 5))).size).toBeGreaterThan(15);
    });

    it("works out which cells a turned box covers", () => {
        const level = boxOffsets(80, 20, 0, 0);
        const upright = boxOffsets(80, 20, 90, 0);
        const across = (cells) => Math.max(...cells.map((c) => c[0])) - Math.min(...cells.map((c) => c[0]));
        const down = (cells) => Math.max(...cells.map((c) => c[1])) - Math.min(...cells.map((c) => c[1]));
        expect(across(level)).toBeGreaterThan(down(level) * 2);
        expect(down(upright)).toBeGreaterThan(across(upright) * 2);
        // a box turned 45 degrees is as tall as it is wide, and covers about as many cells as before it was turned
        const slanted = boxOffsets(80, 20, 45, 0);
        expect(Math.abs(across(slanted) - down(slanted))).toBeLessThanOrEqual(2);
        expect(Math.abs(slanted.length - level.length)).toBeLessThan(level.length * 0.2);
        // padding adds cells; the middle cell is always covered
        expect(boxOffsets(80, 20, 30, CELL * 2).length).toBeGreaterThan(boxOffsets(80, 20, 30, 0).length);
        expect(boxOffsets(80, 20, 30, 0).some(([c, r]) => c === 0 && r === 0)).toBe(true);
    });
});

describe("layoutWords", () => {
    const words = [
        { text: "BAINBRIDGE", count: 20 },
        { text: "BALTER", count: 12 },
        { text: "BANN", count: 9 },
        { text: "ALVIS", count: 6 },
        { text: "BAKER", count: 5 },
        { text: "VOLCIK", count: 4 },
        { text: "ACKS", count: 2 },
        { text: "COSTIN", count: 1 },
    ];
    const masks = buildMasks(buildTree(3));
    const run = (extra = {}) =>
        layoutWords({ words, measure, random: seededRandom(3), masks, fillGaps: false, ...extra });
    // the filled tree is the slow one to lay out, so it is laid out once for the tests that look at it
    let filledTree;
    const filled = () => filledTree || (filledTree = run({ fillGaps: true }));

    const regionOf = (item) => (item.region === "crown" ? masks.crown : masks.trunk);

    it("places every surname, the biggest first and in the middle of the crown", () => {
        const items = run();
        expect(items.map((i) => i.text)).toEqual(words.map((w) => w.text));
        expect(items[0].size).toBeGreaterThan(items[items.length - 1].size);
        expect(items[0].region).toBe("crown");
        expect(items[0].angle).toBe(0);
        expect(Math.abs(items[0].x - 500)).toBeLessThan(200);
    });

    it("keeps every word wholly inside its part of the tree, whatever its angle", () => {
        let outside = 0;
        filled().forEach((item) => {
            wordCells(item).forEach(([col, row]) => {
                if (!regionOf(item)[row * masks.cols + col]) outside++;
            });
        });
        expect(outside).toBe(0);
    });

    it("never lets two words overlap, however they are turned", () => {
        const seen = new Set();
        let overlapping = 0;
        filled().forEach((item) =>
            wordCells(item).forEach(([col, row]) => {
                const id = `${col},${row}`;
                if (seen.has(id)) overlapping++;
                seen.add(id);
            })
        );
        expect(overlapping).toBe(0);
    });

    it("turns words to all sorts of angles, level, upright and in between", () => {
        const angles = filled().map((item) => item.angle);
        expect(angles.some((a) => a === 0)).toBe(true);
        expect(angles.some((a) => Math.abs(a) === 90)).toBe(true);
        const slanted = angles.filter((a) => a !== 0 && Math.abs(a) !== 90);
        expect(slanted.length).toBeGreaterThan(angles.length * 0.25);
        expect(slanted.some((a) => a > 10)).toBe(true);
        expect(slanted.some((a) => a < -10)).toBe(true);
    });

    it("repeats names to fill the gaps only when asked", () => {
        expect(run()).toHaveLength(words.length);
        expect(filled().length).toBeGreaterThan(words.length * 5);
    });

    it("gives the same tree for the same seed", () => {
        expect(run({ fillGaps: false })).toEqual(run({ fillGaps: false }));
    });

    it("draws a single surname without trouble, and nothing for no surnames", () => {
        expect(
            layoutWords({ words: [{ text: "SMITH", count: 1 }], measure, random: seededRandom(1), masks }).length
        ).toBeGreaterThan(1);
        expect(layoutWords({ words: [], measure, masks })).toEqual([]);
    });

    it("drops a name that is too long to fit anywhere rather than overflowing", () => {
        const huge = (text, size) => (text === "HUGE" ? 5000 : text.length * size * 0.5);
        const items = layoutWords({
            words: [
                { text: "HUGE", count: 3 },
                { text: "ABLE", count: 1 },
            ],
            measure: huge,
            random: seededRandom(1),
            fillGaps: false,
            masks,
        });
        expect(items.map((i) => i.text)).toEqual(["ABLE"]);
    });
});

describe("every surname gets a place if there is room anywhere", () => {
    // a heart-shaped region, as a picture of a heart would give
    const heart = () => {
        const cols = 250;
        const rows = 220;
        const crown = new Uint8Array(cols * rows);
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                const x = (c - 125) / 95;
                const y = -(r - 100) / 95;
                if ((x * x + y * y - 1) ** 3 - x * x * y ** 3 < 0) crown[r * cols + c] = 1;
            }
        return { cols, rows, crown, trunk: new Uint8Array(cols * rows) };
    };
    const names = Array.from({ length: 150 }, (_, i) => ({
        text: `SURN${String.fromCharCode(65 + (i % 26))}${"X".repeat(i % 5)}${i}`,
        count: Math.max(1, Math.round(60 / (i + 1))),
    }));

    it("places every name when there is room, close together as in a hand-made word cloud", () => {
        const items = layoutWords({ words: names, measure, random: seededRandom(3), masks: heart(), fillGaps: false });
        expect(new Set(items.map((i) => i.text)).size).toBe(names.length);
    });

    it("tries the names that did not fit at first in the gaps, at smaller sizes", () => {
        const many = Array.from({ length: 320 }, (_, i) => ({
            text: `SURN${String.fromCharCode(65 + (i % 26))}${"X".repeat(i % 5)}${i}`,
            count: Math.max(1, Math.round(60 / (i + 1))),
        }));
        const items = layoutWords({ words: many, measure, random: seededRandom(3), masks: heart(), fillGaps: false });
        const placed = new Set(items.map((i) => i.text)).size;
        expect(placed).toBeGreaterThan(190);
        expect(Math.min(...items.map((i) => i.size))).toBeLessThan(8);
    });

    it("repeats the rarer names, not the commonest, to fill the gaps when asked to", () => {
        const few = names.slice(0, 20);
        const items = layoutWords({ words: few, measure, random: seededRandom(3), masks: heart(), fillGaps: true });
        const copies = (text) => items.filter((i) => i.text === text).length;
        const common = copies(few[0].text);
        const rare = few.slice(-5).reduce((n, w) => n + copies(w.text), 0) / 5;
        expect(items.length).toBeGreaterThan(few.length);
        expect(rare).toBeGreaterThan(common);
    });

    it("still keeps every word inside the shape and apart from the others", () => {
        const masks = heart();
        const items = layoutWords({ words: names, measure, random: seededRandom(3), masks });
        const seen = new Set();
        items.forEach((item) =>
            wordCells(item).forEach(([col, row]) => {
                const id = `${col},${row}`;
                expect(seen.has(id)).toBe(false);
                seen.add(id);
                expect(masks.crown[row * masks.cols + col]).toBeTruthy();
            })
        );
    });
});

describe("scopes", () => {
    it("offers ancestors and CC7, with limits for the + and - buttons", () => {
        expect(SCOPES.map((x) => x.id)).toEqual(["ancestors", "cc7", "category", "search"]);
        expect(scopeById("cc7")).toMatchObject({ units: "degrees", min: 1, max: 10, start: 7 });
        expect(scopeById("ancestors")).toMatchObject({ units: "generations", min: 2, max: 12 });
        expect(scopeById("nonsense").id).toBe("ancestors");
    });
});

describe("surnameOf and groupSurnames", () => {
    it("uses the birth surname in capitals, and nothing for unknown or private names", () => {
        expect(surnameOf({ LastNameAtBirth: "Cave", LastNameCurrent: "Smith" })).toBe("CAVE");
        expect(surnameOf({ LastNameCurrent: "Smith" })).toBe("SMITH");
        expect(surnameOf({ LastNameAtBirth: "Unknown" })).toBe("");
        expect(surnameOf(null)).toBe("");
    });

    it("groups entries by surname, keeping the entries, most common first", () => {
        const entries = [
            { person: { Id: 1, LastNameAtBirth: "Smith" }, bio: true },
            { person: { Id: 2, LastNameAtBirth: "SMITH" }, bio: true },
            { person: { Id: 3, LastNameAtBirth: "Able" }, bio: true },
            { person: { Id: 4, LastNameAtBirth: "Private" }, bio: true },
        ];
        const groups = groupSurnames(entries);
        expect(groups.map((g) => [g.text, g.count])).toEqual([
            ["SMITH", 2],
            ["ABLE", 1],
        ]);
        expect(groups[0].entries.map((e) => e.person.Id)).toEqual([1, 2]);
        expect(groupSurnames(undefined)).toEqual([]);
    });
});

describe("first and middle names", () => {
    it("offers surnames, first names, middle names and both given names", () => {
        expect(NAME_KINDS.map((k) => k.id)).toEqual(["surname", "first", "middle", "given"]);
        expect(kindById("middle").nouns).toBe("middle names");
        expect(kindById("nonsense").id).toBe("surname");
    });

    it("counts each name in a field separately when there is a space between them", () => {
        expect(splitNames("Mary Ann")).toEqual(["MARY", "ANN"]);
        expect(splitNames("  john   henry  william ")).toEqual(["JOHN", "HENRY", "WILLIAM"]);
        expect(splitNames("Mary-Ann")).toEqual(["MARY-ANN"]); // no space, so one name
        expect(splitNames("D'Arcy O'Neil")).toEqual(["D'ARCY", "O'NEIL"]);
    });

    it("leaves out initials, stray punctuation, and values that stand for nobody", () => {
        expect(splitNames("Mary J. Ann")).toEqual(["MARY", "ANN"]);
        expect(splitNames('"Bill" (William),')).toEqual(["BILL", "WILLIAM"]);
        expect(splitNames("J")).toEqual([]);
        expect(splitNames("Unknown")).toEqual([]);
        expect(splitNames("Private")).toEqual([]);
        expect(splitNames("")).toEqual([]);
        expect(splitNames(undefined)).toEqual([]);
    });

    it("lists a name once even if the field repeats it", () => {
        expect(splitNames("Mary Mary ann ANN")).toEqual(["MARY", "ANN"]);
    });

    it("takes the names for each kind of tree from the right field or fields", () => {
        const person = { FirstName: "Mary Ann", MiddleName: "Elizabeth Mary", LastNameAtBirth: "Smith" };
        expect(namesOf(person, "surname")).toEqual(["SMITH"]);
        expect(namesOf(person, "first")).toEqual(["MARY", "ANN"]);
        expect(namesOf(person, "middle")).toEqual(["ELIZABETH", "MARY"]);
        expect(namesOf(person, "given")).toEqual(["MARY", "ANN", "ELIZABETH"]); // Mary is not counted twice
        expect(namesOf(person)).toEqual(["SMITH"]);
        expect(namesOf(null, "first")).toEqual([]);
        expect(namesOf({ LastNameAtBirth: "Unknown" }, "surname")).toEqual([]);
        expect(namesOf({ FirstName: "Mary" }, "middle")).toEqual([]);
    });

    it("groups people by each of their names, so a person with two first names is in two groups", () => {
        const entries = [
            { person: { Id: 1, FirstName: "Mary Ann" } },
            { person: { Id: 2, FirstName: "Mary" } },
            { person: { Id: 3, FirstName: "Ann Mary" } },
            { person: { Id: 4, FirstName: "Private" } },
        ];
        const groups = groupNames(entries, "first");
        expect(groups.map((g) => [g.text, g.count])).toEqual([
            ["MARY", 3],
            ["ANN", 2],
        ]);
        expect(groups[1].entries.map((e) => e.person.Id)).toEqual([1, 3]);
        expect(groupNames(entries, "middle")).toEqual([]);
        expect(groupNames(undefined, "first")).toEqual([]);
    });

    it("still groups surnames as before", () => {
        const entries = [
            { person: { Id: 1, LastNameAtBirth: "Smith" } },
            { person: { Id: 2, LastNameAtBirth: "SMITH" } },
        ];
        expect(groupSurnames(entries)).toEqual(groupNames(entries, "surname"));
        expect(groupSurnames(entries)[0]).toMatchObject({ text: "SMITH", count: 2 });
    });
});

describe("parentEdges", () => {
    it("is the parents shown on the profile when they are the birth parents", () => {
        expect(parentEdges({ Father: 11, Mother: 12, DataStatus: { Father: 20, Mother: 30 } })).toEqual([
            { id: 11, adoptive: false },
            { id: 12, adoptive: false },
        ]);
    });
    it("marks a shown parent as adoptive when it is non-biological, and adds the birth parent beside it", () => {
        const edges = parentEdges({
            Father: 11,
            Mother: 12,
            BioFather: 21,
            BioMother: 22,
            DataStatus: { Father: 5, Mother: 5 },
        });
        expect(edges).toEqual(
            expect.arrayContaining([
                { id: 21, adoptive: false },
                { id: 22, adoptive: false },
                { id: 11, adoptive: true },
                { id: 12, adoptive: true },
            ])
        );
        expect(edges).toHaveLength(4);
    });
    it("handles an adoptive father with a birth mother, and a non-biological parent whose birth parent is unknown", () => {
        const edges = parentEdges({ Father: 11, Mother: 12, BioFather: 21, DataStatus: { Father: 5, Mother: 20 } });
        expect(edges).toEqual(
            expect.arrayContaining([
                { id: 21, adoptive: false },
                { id: 11, adoptive: true },
                { id: 12, adoptive: false },
            ])
        );
        expect(parentEdges({ Father: 11, DataStatus: { Father: 5 } })).toEqual([{ id: 11, adoptive: true }]);
    });
    it("does not list a parent twice when BioFather is the shown father", () => {
        expect(parentEdges({ Father: 11, BioFather: 11, DataStatus: { Father: 20 } })).toEqual([
            { id: 11, adoptive: false },
        ]);
    });
    it("ignores empty and private (negative) ids and missing people", () => {
        expect(parentEdges({ Father: 0, Mother: null, BioFather: -4 })).toEqual([]);
        expect(parentEdges(undefined)).toEqual([]);
    });
});

describe("reachFrom", () => {
    // 1 was adopted by 2 (whose parent is 8); 1's birth parent is 4 (whose parent is 6)
    const graph = {
        1: [
            { id: 2, adoptive: true },
            { id: 4, adoptive: false },
        ],
        2: [{ id: 8, adoptive: false }],
        4: [{ id: 6, adoptive: false }],
    };
    const neighbours = (id) => graph[id] || [];

    it("reaches the birth line by birth links only, and the adoptive line through an adoptive link", () => {
        const reach = reachFrom(1, 5, neighbours);
        expect(reach.get(1)).toEqual({ bio: true, adopt: false });
        expect(reach.get(4)).toEqual({ bio: true, adopt: false });
        expect(reach.get(6)).toEqual({ bio: true, adopt: false });
        expect(reach.get(2)).toEqual({ bio: false, adopt: true });
        expect(reach.get(8)).toEqual({ bio: false, adopt: true }); // an adoptive parent's own parents are family too
    });
    it("stops after the number of steps", () => {
        expect([...reachFrom(1, 1, neighbours).keys()].sort()).toEqual(["1", "2", "4"].map(Number).sort());
    });
    it("marks someone reached both ways as both", () => {
        const both = {
            1: [
                { id: 2, adoptive: true },
                { id: 3, adoptive: false },
            ],
            2: [{ id: 9, adoptive: false }],
            3: [{ id: 9, adoptive: false }],
        };
        expect(reachFrom(1, 3, (id) => both[id] || []).get(9)).toEqual({ bio: true, adopt: true });
    });
});

describe("reachNearby", () => {
    const person = (Id, extra = {}) => ({ Id, ...extra });
    const people = [
        person(1, { Father: 2, Mother: 3, BioFather: 4, DataStatus: { Father: 5, Mother: 5 } }), // adopted by 2 and 3
        person(2, { Spouses: { 3: { Id: 3 } } }),
        person(3, { Spouses: [{ Id: 2 }] }),
        person(4, { Father: 6, DataStatus: { Father: 20 } }),
        person(5, { Father: 2, Mother: 3, DataStatus: { Father: 20, Mother: 20 } }), // the adoptive parents' own child
        person(6),
        person(7, { Father: 4, DataStatus: { Father: 20 } }), // 1's birth half-sibling
        person(9, { Spouses: { 7: { Id: 7 } } }), // 7's spouse
        person(10, { Father: 9 }), // 9's father
    ];
    people.find((p) => p.Id === 7).Spouses = { 9: { Id: 9 } };
    const reach = reachNearby(people, 1, 7);

    it("reaches birth relatives by birth, adoptive relatives by adoption, and a sibling by the kind of link between them", () => {
        expect(reach.get(4)).toEqual({ bio: true, adopt: false }); // birth father
        expect(reach.get(6)).toEqual({ bio: true, adopt: false }); // his father
        expect(reach.get(7)).toMatchObject({ bio: true }); // half-sibling by the birth father
        expect(reach.get(2)).toEqual({ bio: false, adopt: true }); // adoptive father
        expect(reach.get(5)).toMatchObject({ adopt: true, bio: false }); // adoptive sibling
    });
    it("lets marriages keep whichever kind the path was", () => {
        expect(reach.get(9)).toMatchObject({ bio: true }); // married to a birth relative
        expect(reach.get(3)).toMatchObject({ adopt: true }); // adoptive mother (also the adoptive father's spouse)
    });
    it("counts degrees: parents, children, siblings and spouses are one step each", () => {
        const near = reachNearby(people, 1, 1);
        expect([...near.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 7]);
        expect(reachNearby(people, 1, 0).size).toBe(1);
    });
    it("does not need every profile to be in the list", () => {
        expect(reachNearby([person(1, { Father: 99 })], 1, 3).size).toBe(1);
    });
});

describe("chooseByRelation and relationNote", () => {
    const entries = [
        { person: { Id: 1 }, bio: true, adopt: false },
        { person: { Id: 2 }, bio: false, adopt: true },
        { person: { Id: 3 }, bio: true, adopt: true },
    ];
    const ids = (list) => list.map((e) => e.person.Id);
    it("shows both, one or the other", () => {
        expect(ids(chooseByRelation(entries, { biological: true, adoptive: true }))).toEqual([1, 2, 3]);
        expect(ids(chooseByRelation(entries, { biological: true, adoptive: false }))).toEqual([1, 3]);
        expect(ids(chooseByRelation(entries, { biological: false, adoptive: true }))).toEqual([2, 3]);
        expect(ids(chooseByRelation(entries))).toEqual([1, 2, 3]);
    });
    it("notes only people who are family through adoption alone", () => {
        expect(entries.map(relationNote)).toEqual(["", "adoptive", ""]);
    });
});

describe("showing people", () => {
    it("formats WikiTree dates, including partial ones", () => {
        expect(formatDate("1901-08-02")).toBe("2 Aug 1901");
        expect(formatDate("1901-08-00")).toBe("Aug 1901");
        expect(formatDate("1901-00-00")).toBe("1901");
        expect(formatDate("0000-00-00")).toBe("");
        expect(formatDate("")).toBe("");
        expect(formatDate(undefined)).toBe("");
    });
    it("joins a date and a place, whichever are known", () => {
        expect(lifeEvent("1901-08-02", "Caledonia, Missouri")).toBe("2 Aug 1901, Caledonia, Missouri");
        expect(lifeEvent("0000-00-00", "Caledonia")).toBe("Caledonia");
        expect(lifeEvent("", "")).toBe("");
    });
    it("uses the long name, or builds one", () => {
        expect(fullName({ LongName: "Firman Joseph Robinson", FirstName: "X" })).toBe("Firman Joseph Robinson");
        expect(fullName({ FirstName: "Firman", MiddleName: "Joseph", LastNameAtBirth: "Robinson" })).toBe(
            "Firman Joseph Robinson"
        );
        expect(fullName({ RealName: "Firman", LastNameCurrent: "Robinson" })).toBe("Firman Robinson");
        expect(fullName({ Name: "Robinson-1" })).toBe("Robinson-1");
        expect(fullName(null)).toBe("");
    });
    it("sorts unknown birth years last", () => {
        expect(birthYear({ BirthDate: "1901-08-02" })).toBe(1901);
        expect(birthYear({ BirthDate: "0000-00-00" })).toBe(9999);
        expect(birthYear({})).toBe(9999);
    });
});

describe("looks: shaded, flat and outlined", () => {
    const words = Array.from({ length: 30 }, (_, i) => ({
        text: `NAME${String.fromCharCode(65 + (i % 26))}${i}`,
        count: 30 - i,
    }));
    const masks = buildMasks(buildTree(7));
    const run = (look) => layoutWords({ words, measure, random: seededRandom(5), masks, look });

    it("offers shaded, flat and outlined, and falls back to shaded", () => {
        expect(LOOKS.map((l) => l.id)).toEqual(["shaded", "flat", "outlined"]);
        expect(lookById("flat").name).toBe("Flat two-tone");
        expect(lookById("outlined").name).toBe("Outlined");
        expect(lookById("nonsense").id).toBe("shaded");
    });

    it("packs the flat look tighter: more words, smaller ones, less air round each", () => {
        const shaded = run("shaded");
        const flat = run("flat");
        expect(flat.length).toBeGreaterThan(shaded.length * 1.25);
        expect(Math.min(...flat.map((i) => i.size))).toBeLessThan(Math.min(...shaded.map((i) => i.size)));
        expect(lookById("flat").gapCells).toBeLessThan(lookById("shaded").gapCells);
    });

    it("still keeps every word inside the tree and apart from the others in the flat look", () => {
        const items = run("flat");
        const seen = new Set();
        let overlapping = 0;
        let outside = 0;
        items.forEach((item) =>
            wordCells(item).forEach(([col, row]) => {
                const id = `${col},${row}`;
                if (seen.has(id)) overlapping++;
                seen.add(id);
                const mask = item.region === "crown" ? masks.crown : masks.trunk;
                if (!mask[row * masks.cols + col]) outside++;
            })
        );
        expect(overlapping).toBe(0);
        expect(outside).toBe(0);
    });

    it("copes with a shape that has no trunk, putting every word in the crown", () => {
        const noTrunk = { ...masks, trunk: new Uint8Array(masks.trunk.length) };
        const items = layoutWords({ words, measure, random: seededRandom(5), masks: noTrunk, look: "flat" });
        expect(items.length).toBeGreaterThan(30);
        expect(items.every((i) => i.region === "crown")).toBe(true);
    });

    it("does not shade the words by where they are in the flat look, and lets a word keep its own colour", () => {
        const item = { text: "SMITH", rank: 2, region: "crown", size: 20, angle: 0 };
        expect(colorFor({ ...item, x: 150, y: 120 }, "flat")).toBe(colorFor({ ...item, x: 850, y: 520 }, "flat"));
        expect(colorFor({ ...item, x: 150, y: 120 }, "shaded")).not.toBe(
            colorFor({ ...item, x: 850, y: 520 }, "shaded")
        );
        expect(colorFor({ ...item, x: 1, y: 1, color: "#123456" }, "flat")).toBe("#123456");
        expect(colorFor({ ...item, x: 1, y: 1, color: "#123456" })).toBe("#123456");
        expect(COLORS.crownFlat).toMatch(/^#[0-9a-f]{6}$/);
        expect(COLORS.trunkFlat).toMatch(/^#[0-9a-f]{6}$/);
    });
});

describe("the outlined look and the leader and limbs of the tree", () => {
    it("packs between the shaded and flat looks and keeps every word inside the tree", () => {
        const words = Array.from({ length: 30 }, (_, i) => ({ text: `NAME${i}`, count: 30 - i }));
        const masks = buildMasks(buildTree(7));
        const items = layoutWords({ words, measure, random: seededRandom(5), masks, look: "outlined" });
        expect(items.length).toBeGreaterThan(30);
        expect(lookById("outlined").gapCells).toBeLessThan(lookById("shaded").gapCells);
        const seen = new Set();
        items.forEach((item) =>
            wordCells(item).forEach(([col, row]) => {
                const id = `${col},${row}`;
                expect(seen.has(id)).toBe(false);
                seen.add(id);
                const mask = item.region === "crown" ? masks.crown : masks.trunk;
                expect(mask[row * masks.cols + col]).toBeTruthy();
            })
        );
    });

    it("colours words from the palette, not by position, and lets a word keep its own colour", () => {
        const item = { text: "SMITH", rank: 2, region: "crown", size: 20, angle: 0 };
        expect(colorFor({ ...item, x: 150, y: 120 }, "outlined")).toBe(
            colorFor({ ...item, x: 850, y: 520 }, "outlined")
        );
        expect(colorFor({ ...item, x: 1, y: 1, color: "#123456" }, "outlined")).toBe("#123456");
        expect(COLORS.outline).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("grows one leader up from the trunk, with limbs reaching out to alternate sides", () => {
        for (let seed = 1; seed <= 200; seed++) {
            const tree = buildTree(seed);
            expect(tree.leaderTop.y).toBeLessThan(tree.limbs[0].start.y);
            expect(tree.limbs.length).toBeGreaterThan(1);
            tree.limbs.forEach((limb) => {
                expect(limb.side === -1 || limb.side === 1).toBe(true);
                expect(Number.isFinite(limb.tip.x + limb.tip.y + limb.start.x + limb.start.y)).toBe(true);
            });
            const sides = new Set(tree.limbs.map((l) => l.side));
            expect(sides.size).toBe(2);
        }
    });
});

describe("a category or a search as the reach", () => {
    it("turns a category as typed or pasted into the WikiTree+ query", () => {
        expect(categoryQuery("Mayflower Passengers")).toBe("CategoryFull=Mayflower_Passengers");
        expect(categoryQuery("  Category:Mayflower_Passengers ")).toBe("CategoryFull=Mayflower_Passengers");
        expect(categoryQuery("Cemeteries, Cheshire")).toBe("CategoryFull=Cemeteries__Cheshire");
        expect(categoryQuery("https://www.wikitree.com/wiki/Category:Robinson_Name_Study")).toBe(
            "CategoryFull=Robinson_Name_Study"
        );
        expect(categoryQuery('"Titanic Passengers"')).toBe("CategoryFull=Titanic_Passengers");
        expect(categoryQuery("   ")).toBe("");
        expect(categoryQuery(undefined)).toBe("");
    });

    it("takes a search as typed, or the Query of a WikiTree+ address", () => {
        expect(searchQuery("  Surname=Smith Born=1850..1900 ")).toBe("Surname=Smith Born=1850..1900");
        expect(
            searchQuery("https://plus.wikitree.com/default.htm?report=srch1&Query=Surname%3DSmith+Location%3DOhio")
        ).toBe("Surname=Smith Location=Ohio");
        expect(searchQuery("https://plus.wikitree.com/default.htm?report=srch1")).toBe("");
        expect(searchQuery("")).toBe("");
    });

    it("builds the right query for each reach, and offers both as reaches", () => {
        expect(groupQuery("category", "Foo Bar")).toBe("CategoryFull=Foo_Bar");
        expect(groupQuery("search", "Surname=Foo")).toBe("Surname=Foo");
        expect(SCOPES.filter((s) => s.group).map((s) => s.id)).toEqual(["category", "search"]);
        expect(scopeById("category").what).toBe("category");
    });
});

describe("colours", () => {
    it("writes and reads hex colours", () => {
        expect(hslToHex(0, 100, 50)).toBe("#ff0000");
        expect(hslToHex(120, 100, 25)).toBe("#008000");
        expect(hslToHex(0, 0, 100)).toBe("#ffffff");
    });

    it("makes each clump of leaves lighter at one side than the other, in its own green", () => {
        const [a, b] = [buildTree(1).crown[0], buildTree(1).crown[1]];
        const light = (hex) => parseInt(hex.slice(3, 5), 16); // the green channel
        [a, b].forEach((lobe) => expect(light(crownColors(lobe).lit)).toBeGreaterThan(light(crownColors(lobe).shade)));
        expect(crownColors(a)).not.toEqual(crownColors(b));
    });

    it("makes words darker towards the lower right of the tree than the upper left", () => {
        const item = { text: "SMITH", rank: 2, region: "crown", size: 20, angle: 0 };
        const brightness = (hex) =>
            parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
        expect(brightness(colorFor({ ...item, x: 150, y: 120 }))).toBeGreaterThan(
            brightness(colorFor({ ...item, x: 850, y: 520 }))
        );
        expect(colorFor({ ...item, region: "trunk", x: 500, y: 700 })).toMatch(/^#[0-9a-f]{6}$/);
    });
});

describe("the note about names that did not fit", () => {
    it("names the one name left out, in the singular", () => {
        expect(unseenNote(["BOSWELL"], "surname", "surnames")).toBe(" 1 rarer surname did not fit: BOSWELL.");
    });

    it("names up to a few, and only counts more than that, for the popup list to name", () => {
        expect(unseenNote(["A", "B", "C"], "first name", "first names")).toBe(
            " 3 rarer first names did not fit: A, B, C."
        );
        const names = Array.from({ length: 30 }, (_, i) => `N${i}`);
        expect(unseenNote(names, "surname", "surnames")).toBe(" 30 rarer surnames did not fit.");
        expect(unseenNote(names.slice(0, 5), "surname", "surnames", 5)).toMatch(/: N0, N1, N2, N3, N4\.$/);
    });

    it("says nothing when every name fitted", () => {
        expect(unseenNote([], "surname", "surnames")).toBe("");
    });

    it("lists the names left out with their counts, most common first, and says how many were cut off the end", () => {
        const words = [
            { text: "A", count: 9 },
            { text: "B", count: 5 },
            { text: "C", count: 2 },
            { text: "D", count: 1 },
        ];
        expect(unseenRows(words, ["D", "B", "C"])).toEqual({
            rows: [
                { text: "B", count: 5 },
                { text: "C", count: 2 },
                { text: "D", count: 1 },
            ],
            more: 0,
        });
        expect(unseenRows(words, ["B", "C", "D"], 2)).toEqual({
            rows: [
                { text: "B", count: 5 },
                { text: "C", count: 2 },
            ],
            more: 1,
        });
    });
});

describe("the wide banner", () => {
    const words = Array.from({ length: 40 }, (_, i) => ({ text: `NAME${i}${"X".repeat(i % 5)}`, count: 40 - i }));

    it("is as wide as the tree and the shape of a 2560 x 400 picture", () => {
        const banner = buildBannerShape();
        expect(frameOf(banner)).toBe(BANNER_FRAME);
        expect(BANNER_FRAME.w).toBe(WIDTH);
        expect(BANNER_FRAME.w / BANNER_FRAME.h).toBeCloseTo(2560 / 400, 5);
        expect(frameOf(buildTree(1))).toEqual({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
        expect(frameOf(null)).toEqual({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
    });

    it("has every cell for words, and no trunk", () => {
        const { masks } = buildBannerShape();
        expect(masks.crown.every((cell) => cell === 1)).toBe(true);
        expect(masks.trunk.every((cell) => cell === 0)).toBe(true);
        expect(masks.rows * CELL).toBeGreaterThanOrEqual(BANNER_FRAME.h);
        expect(masks.rows * CELL).toBeLessThan(BANNER_FRAME.h + CELL);
    });

    it("keeps the colours it was given", () => {
        const banner = buildBannerShape({ background: "#102030", wordColor: "#aabbcc" });
        expect(banner).toMatchObject({ kind: "banner", background: "#102030", wordColor: "#aabbcc", look: "outlined" });
    });

    it("fills the banner with words, smaller than the tree's, inside the frame and apart from each other", () => {
        const { masks } = buildBannerShape();
        const items = layoutWords({
            words,
            measure,
            random: seededRandom(4),
            masks,
            look: "flat",
            fonts: BANNER_FONTS,
        });
        expect(items.length).toBeGreaterThan(40);
        expect(Math.max(...items.map((i) => i.size))).toBeLessThanOrEqual(BANNER_FONTS.maxFont);
        const seen = new Set();
        items.forEach((item) => {
            expect(item.region).toBe("crown");
            expect(item.y).toBeLessThan(BANNER_FRAME.h + CELL);
            wordCells(item).forEach(([col, row]) => {
                const id = `${col},${row}`;
                expect(seen.has(id)).toBe(false);
                seen.add(id);
                expect(masks.crown[row * masks.cols + col]).toBeTruthy();
            });
        });
        // the whole width is used, not only the middle
        expect(Math.min(...items.map((i) => i.x))).toBeLessThan(200);
        expect(Math.max(...items.map((i) => i.x))).toBeGreaterThan(800);
    });
});

describe("names as big as will let every one fit", () => {
    const masks = buildMasks(buildTree(5));
    const words = Array.from({ length: 30 }, (_, i) => ({
        text: `NAME${i}${"X".repeat(i % 4)}`,
        count: Math.max(1, 30 - i),
    }));
    const args = { words, measure, masks, fillGaps: false, look: "flat", makeRandom: () => seededRandom(2) };

    it("makes the names bigger than usual when there is room, and still places every one", () => {
        const usual = layoutWords({ words, measure, masks, fillGaps: false, look: "flat", random: seededRandom(2) });
        const filled = layoutToFill(args);
        expect(new Set(filled.map((i) => i.text)).size).toBe(words.length);
        expect(Math.min(...filled.map((i) => i.size))).toBeGreaterThan(Math.min(...usual.map((i) => i.size)));
        const area = (items) => items.reduce((n, i) => n + i.w * i.h, 0);
        expect(area(filled)).toBeGreaterThan(area(usual) * 1.05);
    });

    it("keeps the usual size when the shape is already crowded", () => {
        const many = Array.from({ length: 300 }, (_, i) => ({
            text: `NAME${i}${"X".repeat(i % 6)}`,
            count: Math.max(1, 40 - i),
        }));
        const usual = layoutWords({
            words: many,
            measure,
            masks,
            fillGaps: false,
            look: "flat",
            random: seededRandom(2),
        });
        const filled = layoutToFill({ ...args, words: many });
        expect(filled.length).toBe(usual.length);
    });
});
