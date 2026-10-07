/** @jest-environment node */
import {
    CELL,
    HEIGHT,
    WIDTH,
    layoutWords,
    seededRandom,
    wordCells,
} from "../../views/surnameTree/surname_tree_core.js";
import {
    DEFAULT_SENSITIVITY,
    MARGIN,
    MAX_FILE_BYTES,
    MIN_COVERAGE,
    BUILT_IN_PICTURES,
    fileProblem,
    legibleColour,
    placeInFrame,
    shapeFromPixels,
    wordColour,
} from "../../views/surnameTree/surname_tree_image.js";

/** A WIDTH x HEIGHT picture in RGBA, filled with `background` (transparent if null), then painted with draw(set, x, y). */
function picture(background, paint) {
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
        const at = i * 4;
        if (background) data.set([...background, 255], at);
    }
    const set = (x, y, rgb, alpha = 255) => data.set([...rgb, alpha], (y * WIDTH + x) * 4);
    paint(set);
    return { width: WIDTH, height: HEIGHT, data };
}
const FRAME = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
const disc = (cx, cy, r, rgb) => (set) => {
    for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, rgb);
    }
};
const cellOf = (shape, x, y) => shape.masks.crown[Math.floor(y / CELL) * shape.masks.cols + Math.floor(x / CELL)];

describe("placing a picture in the frame", () => {
    it("fits it as big as it goes, centred, with a margin", () => {
        const wide = placeInFrame(2000, 500);
        expect(wide.w).toBe(WIDTH - 2 * MARGIN);
        expect(wide.x).toBe(MARGIN);
        expect(wide.y + wide.h / 2).toBeCloseTo(HEIGHT / 2, 0);
        const tall = placeInFrame(500, 2000);
        expect(tall.h).toBe(HEIGHT - 2 * MARGIN);
        expect(tall.x + tall.w / 2).toBeCloseTo(WIDTH / 2, 0);
        expect(Math.abs(placeInFrame(100, 100).w / placeInFrame(100, 100).h - 1)).toBeLessThan(0.02);
    });
});

describe("cutting a shape out of a picture", () => {
    it("takes a shape on a plain background, leaving the background out", () => {
        const shape = shapeFromPixels(picture([255, 255, 255], disc(500, 440, 300, [30, 140, 40])), FRAME);
        expect(shape.kind).toBe("image");
        expect(cellOf(shape, 500, 440)).toBe(1);
        expect(cellOf(shape, 700, 500)).toBe(1);
        expect(cellOf(shape, 30, 30)).toBe(0);
        expect(cellOf(shape, 990, 870)).toBe(0);
        const expected = (Math.PI * 300 * 300) / (WIDTH * HEIGHT);
        expect(shape.coverage).toBeGreaterThan(expected * 0.95);
        expect(shape.coverage).toBeLessThan(expected * 1.05);
        expect(shape.background).toEqual([[255, 255, 255]]);
    });

    it("uses a background of any colour, found along the picture's edge", () => {
        const shape = shapeFromPixels(picture([20, 30, 80], disc(500, 440, 250, [250, 200, 60])), FRAME);
        expect(shape.background).toEqual([[20, 30, 80]]);
        expect(cellOf(shape, 500, 440)).toBe(1);
        expect(cellOf(shape, 30, 30)).toBe(0);
    });

    it("cuts a picture out by its transparency when it has any", () => {
        const shape = shapeFromPixels(picture(null, disc(500, 440, 280, [200, 30, 30])), FRAME);
        expect(shape.background).toBe("transparent");
        expect(cellOf(shape, 500, 440)).toBe(1);
        expect(cellOf(shape, 30, 30)).toBe(0);
    });

    it("only looks inside the area the picture was placed in", () => {
        const rect = { x: 100, y: 100, w: 600, h: 500 };
        // the frame is transparent outside the placed picture, which is plain white inside
        const pixels = picture(null, (set) => {
            for (let y = rect.y; y < rect.y + rect.h; y++)
                for (let x = rect.x; x < rect.x + rect.w; x++) set(x, y, [255, 255, 255]);
            disc(400, 350, 150, [10, 100, 200])(set);
        });
        const shape = shapeFromPixels(pixels, rect);
        expect(shape.background).toEqual([[255, 255, 255]]); // its own white, not the transparent frame round it
        expect(cellOf(shape, 400, 350)).toBe(1);
        expect(cellOf(shape, 150, 150)).toBe(0);
        expect(cellOf(shape, 900, 800)).toBe(0);
    });

    it("is more or less picky as the sensitivity says", () => {
        // a pale grey halo round a dark disc, on white: (255 - 215) is a small difference from the background
        const pixels = () =>
            picture([255, 255, 255], (set) => {
                disc(500, 440, 300, [215, 215, 215])(set);
                disc(500, 440, 180, [20, 60, 30])(set);
            });
        const keepsHalo = shapeFromPixels(pixels(), FRAME, 20);
        const dropsHalo = shapeFromPixels(pixels(), FRAME, 100);
        expect(cellOf(keepsHalo, 500, 440 - 240)).toBe(1);
        expect(cellOf(dropsHalo, 500, 440 - 240)).toBe(0);
        expect(cellOf(dropsHalo, 500, 440)).toBe(1);
        expect(keepsHalo.coverage).toBeGreaterThan(dropsHalo.coverage * 1.5);
        expect(DEFAULT_SENSITIVITY).toBeGreaterThan(20);
        expect(DEFAULT_SENSITIVITY).toBeLessThan(100);
    });

    it("drops dust but keeps the shape; and keeps small bits when there is nothing bigger", () => {
        const withDust = shapeFromPixels(
            picture([255, 255, 255], (set) => {
                disc(500, 440, 250, [10, 120, 20])(set);
                disc(80, 80, 4, [0, 0, 0])(set); // a speck
                disc(900, 90, 5, [0, 0, 0])(set);
            }),
            FRAME
        );
        expect(cellOf(withDust, 80, 80)).toBe(0);
        expect(cellOf(withDust, 900, 90)).toBe(0);
        expect(cellOf(withDust, 500, 440)).toBe(1);
        const onlyBits = shapeFromPixels(picture([255, 255, 255], disc(500, 440, 8, [0, 0, 0])), FRAME);
        expect(onlyBits.coverage).toBeGreaterThan(0);
    });

    it("sees through a checkerboard of two greys, as in a picture saved with its transparent background showing", () => {
        // squares of white and light grey, 8 pixels across, with a green disc on top; the colours drift a little, as in a JPEG
        const board = picture([255, 255, 255], (set) => {
            for (let y = 0; y < HEIGHT; y++) {
                for (let x = 0; x < WIDTH; x++) {
                    const grey = ((x >> 3) + (y >> 3)) % 2 ? 204 : 255;
                    const drift = (x * 7 + y * 13) % 5;
                    set(x, y, [grey - drift, grey - drift, grey - drift]);
                }
            }
            disc(500, 440, 280, [30, 140, 40])(set);
        });
        const shape = shapeFromPixels(board, FRAME);
        expect(shape.background.length).toBe(2);
        expect(cellOf(shape, 500, 440)).toBe(1);
        expect(cellOf(shape, 40, 40)).toBe(0); // neither the white nor the grey squares are part of the shape
        expect(cellOf(shape, 44, 52)).toBe(0);
        const expected = (Math.PI * 280 * 280) / (WIDTH * HEIGHT);
        expect(shape.coverage).toBeLessThan(expected * 1.1);
    });

    it("keeps a plain background to one colour even when the edge has a little of something else", () => {
        const shape = shapeFromPixels(picture([240, 240, 240], disc(500, 440, 250, [10, 120, 20])), FRAME);
        expect(shape.background).toEqual([[240, 240, 240]]);
    });

    it("can leave the white parts inside a picture empty, so a white design on a colour shows as a gap", () => {
        // an orange disc with a white tree-like cross in it, on a transparent background
        const logo = picture(null, (set) => {
            disc(500, 440, 340, [240, 150, 20])(set);
            for (let y = 200; y < 700; y++) for (let x = 470; x < 530; x++) set(x, y, [255, 255, 255]);
            for (let y = 380; y < 440; y++) for (let x = 300; x < 700; x++) set(x, y, [255, 255, 255]);
        });
        const filled = shapeFromPixels(logo, FRAME);
        const withGaps = shapeFromPixels(logo, FRAME, DEFAULT_SENSITIVITY, { leaveWhite: true });
        expect(cellOf(filled, 500, 300)).toBe(1); // the white design is part of the shape
        expect(cellOf(withGaps, 500, 300)).toBe(0); // now a gap
        expect(cellOf(withGaps, 400, 600)).toBe(1); // the orange is still there
        expect(withGaps.coverage).toBeLessThan(filled.coverage);
    });

    it("comes with the WikiTree logo, the WikiTree heart and an oak picture", () => {
        expect(BUILT_IN_PICTURES.map((p) => p.id)).toEqual(["wikitree-logo", "wikitree-heart", "oak-picture"]);
        BUILT_IN_PICTURES.forEach((p) => {
            expect(p.file).toMatch(/^images\/.+\.(png|jpg)$/);
            expect(p.name.length).toBeGreaterThan(3);
        });
        // white inside the logo and the heart is a design to leave empty; the oak has none
        expect(BUILT_IN_PICTURES.filter((p) => p.leaveWhite).map((p) => p.id)).toEqual([
            "wikitree-logo",
            "wikitree-heart",
        ]);
    });

    it("finds no shape in a picture that is all one colour", () => {
        const shape = shapeFromPixels(
            picture([240, 240, 240], () => {}),
            FRAME
        );
        expect(shape.coverage).toBeLessThan(MIN_COVERAGE);
    });

    it("makes a shape the layout can use: words stay inside it, and there is no trunk", () => {
        const shape = shapeFromPixels(picture([255, 255, 255], disc(500, 440, 300, [30, 140, 40])), FRAME);
        const words = Array.from({ length: 20 }, (_, i) => ({ text: `WORD${i}`, count: 20 - i }));
        const items = layoutWords({
            words,
            measure: (t, size) => t.length * size * 0.55,
            random: seededRandom(2),
            masks: shape.masks,
            look: "flat",
        });
        expect(items.length).toBeGreaterThan(40);
        expect(items.every((i) => i.region === "crown")).toBe(true);
        let outside = 0;
        items.forEach((item) =>
            wordCells(item).forEach(([col, row]) => {
                if (!shape.masks.crown[row * shape.masks.cols + col]) outside++;
            })
        );
        expect(outside).toBe(0);
        expect(shape.masks.trunk.every((v) => v === 0)).toBe(true);
    });
});

describe("colours from the picture", () => {
    // green above, brown below, on white
    const twoTone = () =>
        shapeFromPixels(
            picture([255, 255, 255], (set) => {
                for (let y = 100; y < 450; y++) for (let x = 200; x < 800; x++) set(x, y, [30, 140, 50]);
                for (let y = 450; y < 780; y++) for (let x = 380; x < 620; x++) set(x, y, [120, 80, 30]);
            }),
            FRAME
        );
    const word = (x, y, extra = {}) => ({ text: "SMITH", x, y, w: 80, h: 20, angle: 0, size: 24, ...extra });
    const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

    it("gives a word the colour of the picture under it", () => {
        const shape = twoTone();
        const [r1, g1, b1] = channels(wordColour(shape, word(500, 250)));
        expect(g1).toBeGreaterThan(r1);
        expect(g1).toBeGreaterThan(b1); // green in the crown
        const [r2, g2, b2] = channels(wordColour(shape, word(500, 600)));
        expect(r2).toBeGreaterThan(g2);
        expect(g2).toBeGreaterThan(b2); // brown in the trunk
    });

    it("follows the word along its angle", () => {
        const shape = twoTone();
        // a tall upright word whose middle is in the green, running down towards the brown
        const upright = wordColour(shape, word(500, 420, { angle: 90, w: 160 }));
        const level = wordColour(shape, word(500, 420, { angle: 0, w: 160 }));
        expect(upright).not.toBe(level);
    });

    it("makes any colour easy to read as text: never very light or very dark", () => {
        const lightness = (hex) => {
            const [r, g, b] = channels(hex).map((v) => v / 255);
            return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * 100;
        };
        ["#ffffff", "#fff3b0", "#d0f0ff", "#000000", "#050510"].forEach((hex) => {
            const l = lightness(legibleColour(channels(hex)));
            expect(l).toBeLessThanOrEqual(45);
            expect(l).toBeGreaterThanOrEqual(19);
        });
        // a colour that is already fine keeps its hue
        const [r, g, b] = channels(legibleColour([30, 140, 50]));
        expect(g).toBeGreaterThan(r);
        expect(g).toBeGreaterThan(b);
        // a muddy green is made richer; a grey stays grey
        const spread = (hex) => Math.max(...channels(hex)) - Math.min(...channels(hex));
        expect(spread(legibleColour([140, 150, 90]))).toBeGreaterThan(spread("#8c965a") * 1.3);
        expect(spread(legibleColour([128, 128, 128]))).toBe(0);
    });

    it("finds the nearest colour for a word that sits just off the shape", () => {
        const shape = twoTone();
        const [r, g] = channels(wordColour(shape, word(500, 105 - 2 * CELL)));
        expect(g).toBeGreaterThan(r);
    });
});

describe("which files can be used", () => {
    it("accepts pictures and says why not for anything else", () => {
        expect(fileProblem({ type: "image/png", size: 1000 })).toBe("");
        expect(fileProblem({ type: "image/svg+xml", size: 1000 })).toBe("");
        expect(fileProblem(null)).toMatch(/No picture/);
        expect(fileProblem({ type: "application/pdf", size: 10 })).toMatch(/not a picture/);
        expect(fileProblem({ type: "", size: 10 })).toMatch(/not a picture/);
        expect(fileProblem({ type: "image/jpeg", size: MAX_FILE_BYTES + 1 })).toMatch(/too big/);
    });
});
