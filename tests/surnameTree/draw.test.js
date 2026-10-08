import { CELL } from "../../views/surnameTree/surname_tree_core.js";
import { inkOffsets } from "../../views/surnameTree/surname_tree_draw.js";

/** A stand-in for the page's canvas: the letters are a hollow ring, as an O is, and the middle is empty. */
function ringCanvas() {
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            font: "",
            measureText: () => ({ width: 120 }),
            translate() {},
            rotate() {},
            fillText() {},
            getImageData: (x, y, w, h) => {
                const data = new Uint8ClampedArray(w * h * 4);
                const mid = w / 2;
                for (let py = 0; py < h; py++)
                    for (let px = 0; px < w; px++) {
                        const d = Math.max(Math.abs(px - mid), Math.abs(py - mid));
                        if (d > 20 && d < 30) data[(py * w + px) * 4 + 3] = 255; // the ring: 20 to 30 pixels from the middle
                    }
                return { data };
            },
        }),
    };
    return canvas;
}

describe("inkOffsets: the cells a name's letters cover", () => {
    afterEach(() => jest.restoreAllMocks());

    it("covers the letters and leaves their middle free, so a short name can go inside an O", () => {
        jest.spyOn(document, "createElement").mockImplementation(() => ringCanvas());
        // a 40 pixel name drawn at scale 1, whose ring lies 20 to 30 pixels out
        const cells = inkOffsets("O", 40, 0, 0);
        const has = (dc, dr) => cells.some(([c, r]) => c === dc && r === dr);
        expect(has(0, 0)).toBe(false);
        expect(has(Math.round(25 / CELL), 0)).toBe(true);
        expect(has(0, -Math.round(25 / CELL))).toBe(true);
        expect(has(Math.round(60 / CELL), 0)).toBe(false);
    });

    it("takes in more cells when room is asked for round the letters", () => {
        jest.spyOn(document, "createElement").mockImplementation(() => ringCanvas());
        const tight = inkOffsets("O", 40, 0, 0);
        const roomy = inkOffsets("O", 40, 0, 2 * CELL);
        expect(roomy.length).toBeGreaterThan(tight.length);
    });

    it("gives null where the page cannot draw text, so the layout uses the box", () => {
        jest.isolateModules(() => {
            const fresh = require("../../views/surnameTree/surname_tree_draw.js");
            jest.spyOn(document, "createElement").mockImplementation(() => ({ getContext: () => null }));
            expect(fresh.inkOffsets("O", 40, 0, 0)).toBeNull();
        });
    });
});
