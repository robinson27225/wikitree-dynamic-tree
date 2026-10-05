/*
Created By: Azure Robinson (Robinson-27225)
*/

import {
    COLORS,
    HEIGHT,
    INNER_BRANCH_OPACITY,
    LIGHT,
    WIDTH,
    buildTree,
    colorFor,
    crownColors,
} from "./surname_tree_core.js";
import { TREE_FONT, trunkSpan } from "./surname_tree_draw.js";
import {
    BUTTON_FACTOR,
    IDENTITY,
    clientToView,
    panBy,
    transformText,
    viewScale,
    wheelFactor,
    zoomAbout,
} from "./surname_tree_zoom.js";

const NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
    const el = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
}

const round = (n) => Math.round(n * 10) / 10;

/**
 * Draw the tree as SVG so the words can be hovered, clicked and zoomed as they are. Returns the group that zoom moves and
 * a map from each surname to its words (a name can appear many times, once big and then small to fill gaps).
 * Each word is a <g class="sutree-word" data-surname="..."> turned to its angle, holding an invisible box, which makes
 * tiny words easy to hit, and the text.
 */
export function renderTreeSvg(svg, items, tree = buildTree(1)) {
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    svg.setAttribute("xmlns", NS);
    svg.setAttribute("font-family", TREE_FONT);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "A tree made of names");

    const defs = svgElement("defs");
    svg.appendChild(defs);
    const viewport = svgElement("g", { class: "sutree-viewport" });
    svg.appendChild(viewport);

    // trunk and limbs: shaded across from left to right
    const { left, right } = trunkSpan(tree);
    const bark = svgElement("linearGradient", {
        id: "suTreeBark",
        gradientUnits: "userSpaceOnUse",
        x1: round(left),
        y1: 0,
        x2: round(right),
        y2: 0,
    });
    bark.appendChild(svgElement("stop", { "offset": "0", "stop-color": COLORS.trunkLight }));
    bark.appendChild(svgElement("stop", { "offset": "1", "stop-color": COLORS.trunkDark }));
    defs.appendChild(bark);
    // every circle is drawn the same way round, so one path fills their union
    const trunkPath = tree.trunk
        .map(
            (c) =>
                `M${round(c.x + c.r)} ${round(c.y)}A${round(c.r)} ${round(c.r)} 0 1 0 ${round(c.x - c.r)} ${round(
                    c.y
                )}A${round(c.r)} ${round(c.r)} 0 1 0 ${round(c.x + c.r)} ${round(c.y)}Z`
        )
        .join("");
    viewport.appendChild(svgElement("path", { class: "sutree-trunk", fill: "url(#suTreeBark)", d: trunkPath }));

    // each clump of leaves is lit at its upper left and shadowed at its lower right
    tree.crown.forEach((lobe, i) => {
        const { lit, shade } = crownColors(lobe);
        const fx = round(lobe.x + LIGHT.dx * lobe.r);
        const fy = round(lobe.y + LIGHT.dy * lobe.r);
        const gradient = svgElement("radialGradient", {
            id: `suTreeLeaf${i}`,
            gradientUnits: "userSpaceOnUse",
            cx: fx,
            cy: fy,
            fx,
            fy,
            r: round(lobe.r * LIGHT.spread),
        });
        gradient.appendChild(svgElement("stop", { "offset": "0", "stop-color": lit }));
        gradient.appendChild(svgElement("stop", { "offset": "1", "stop-color": shade }));
        defs.appendChild(gradient);
        viewport.appendChild(
            svgElement("circle", {
                class: "sutree-crown",
                cx: round(lobe.x),
                cy: round(lobe.y),
                r: round(lobe.r),
                fill: `url(#suTreeLeaf${i})`,
            })
        );
    });

    // the limbs show faintly through the leaves, as branches do in a real tree
    const clip = svgElement("clipPath", { id: "suTreeCrownClip" });
    tree.crown.forEach((lobe) =>
        clip.appendChild(svgElement("circle", { cx: round(lobe.x), cy: round(lobe.y), r: round(lobe.r) }))
    );
    defs.appendChild(clip);
    viewport.appendChild(
        svgElement("path", {
            "class": "sutree-inner",
            "d": trunkPath,
            "fill": COLORS.trunkInner,
            "opacity": INNER_BRANCH_OPACITY,
            "clip-path": "url(#suTreeCrownClip)",
            "pointer-events": "none",
        })
    );

    const words = new Map();
    items.forEach((item) => {
        const first = !words.has(item.text);
        const group = svgElement("g", {
            "class": "sutree-word",
            "data-surname": item.text,
            "transform": `translate(${round(item.x)} ${round(item.y)}) rotate(${round(item.angle)})`,
        });
        if (first) {
            // one stop per surname for the keyboard, not one for every small repeat
            group.setAttribute("tabindex", "0");
            group.setAttribute("role", "button");
            group.setAttribute(
                "aria-label",
                `${item.text}, ${item.count} ${item.count === 1 ? "profile" : "profiles"}`
            );
        }
        group.appendChild(
            svgElement("rect", {
                x: round(-item.w / 2),
                y: round(-item.h / 2),
                width: round(item.w),
                height: round(item.h),
                fill: "transparent",
            })
        );
        const text = svgElement("text", {
            "y": round(item.size * 0.04),
            "font-size": item.size,
            "font-weight": "bold",
            "text-anchor": "middle",
            "dominant-baseline": "central",
            "fill": colorFor(item),
        });
        text.textContent = item.text;
        group.appendChild(text);
        viewport.appendChild(group);
        if (!words.has(item.text)) words.set(item.text, []);
        words.get(item.text).push(group);
    });
    return { viewport, words };
}

/**
 * Wheel to zoom about the pointer, drag to move, and buttons (zoomIn, zoomOut, reset). `wasDragged()` is true just after a drag, so the click that
 * ends a drag is not taken as a click on a word.
 */
export function attachZoom(svg, onChange = () => {}) {
    let t = IDENTITY;
    let dragged = false;
    // the drawing is replaced whenever the tree is laid out again, so the group to move is looked up each time
    const show = () => svg.querySelector(".sutree-viewport")?.setAttribute("transform", transformText(t));
    const apply = (next) => {
        t = next;
        show();
        onChange(t);
    };
    const centre = () => ({ x: WIDTH / 2, y: HEIGHT / 2 });

    svg.addEventListener(
        "wheel",
        (event) => {
            event.preventDefault();
            const p = clientToView(svg.getBoundingClientRect(), event.clientX, event.clientY);
            apply(zoomAbout(t, wheelFactor(event), p.x, p.y));
        },
        { passive: false }
    );

    svg.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        dragged = false;
        let lastX = event.clientX;
        let lastY = event.clientY;
        const move = (e) => {
            const scale = viewScale(svg.getBoundingClientRect());
            if (Math.abs(e.clientX - event.clientX) + Math.abs(e.clientY - event.clientY) > 3) dragged = true;
            if (dragged) apply(panBy(t, (e.clientX - lastX) / scale, (e.clientY - lastY) / scale));
            lastX = e.clientX;
            lastY = e.clientY;
        };
        const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            setTimeout(() => (dragged = false), 0); // after the click that follows the button coming up
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    });

    return {
        zoomIn: () => apply(zoomAbout(t, BUTTON_FACTOR, centre().x, centre().y)),
        zoomOut: () => apply(zoomAbout(t, 1 / BUTTON_FACTOR, centre().x, centre().y)),
        reset: () => apply(IDENTITY),
        reapply: show,
        transform: () => t,
        wasDragged: () => dragged,
    };
}
