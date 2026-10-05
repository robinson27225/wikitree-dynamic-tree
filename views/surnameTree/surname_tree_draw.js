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

/** A tall, narrow, heavy face, like the capitals on a tree-shaped word cloud. Whatever is installed first is used. */
export const TREE_FONT = '"Roboto Condensed", "Arial Narrow", Oswald, Impact, Haettenschweiler, sans-serif';

export const treeFont = (size) => `bold ${size}px ${TREE_FONT}`;

/** A function that measures the width of a word in the tree's font, for the layout. */
export function makeMeasure() {
    const g = document.createElement("canvas").getContext("2d");
    return (text, size) => {
        g.font = treeFont(size);
        return g.measureText(text).width;
    };
}

/** The left and right edges of the trunk and limbs, so shading can run across them. */
export function trunkSpan(tree) {
    let left = WIDTH;
    let right = 0;
    tree.trunk.forEach((c) => {
        left = Math.min(left, c.x - c.r);
        right = Math.max(right, c.x + c.r);
    });
    return { left, right };
}

/** Draw the tree (trunk and limbs, then the clumps of leaves, then the words) on a canvas sized to WIDTH x HEIGHT times `scale`. */
export function drawTree(canvas, items, scale = 2, tree = buildTree(1)) {
    canvas.width = Math.round(WIDTH * scale);
    canvas.height = Math.round(HEIGHT * scale);
    const g = canvas.getContext("2d");
    g.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, WIDTH, HEIGHT);

    // the trunk and limbs: every circle runs the same way, so one fill gives their union, shaded across from left to right
    const { left, right } = trunkSpan(tree);
    const bark = g.createLinearGradient(left, 0, right, 0);
    bark.addColorStop(0, COLORS.trunkLight);
    bark.addColorStop(1, COLORS.trunkDark);
    g.fillStyle = bark;
    g.beginPath();
    tree.trunk.forEach((c) => {
        g.moveTo(c.x + c.r, c.y);
        g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    });
    g.fill();

    // each clump of leaves is lit at its upper left and shadowed at its lower right
    tree.crown.forEach((lobe) => {
        const { lit, shade } = crownColors(lobe);
        const fx = lobe.x + LIGHT.dx * lobe.r;
        const fy = lobe.y + LIGHT.dy * lobe.r;
        const leaves = g.createRadialGradient(fx, fy, 0, fx, fy, lobe.r * LIGHT.spread);
        leaves.addColorStop(0, lit);
        leaves.addColorStop(1, shade);
        g.fillStyle = leaves;
        g.beginPath();
        g.arc(lobe.x, lobe.y, lobe.r, 0, Math.PI * 2);
        g.fill();
    });

    // the limbs show faintly through the leaves, as branches do in a real tree
    g.save();
    g.beginPath();
    tree.crown.forEach((c) => {
        g.moveTo(c.x + c.r, c.y);
        g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    });
    g.clip();
    g.globalAlpha = INNER_BRANCH_OPACITY;
    g.fillStyle = COLORS.trunkInner;
    g.beginPath();
    tree.trunk.forEach((c) => {
        g.moveTo(c.x + c.r, c.y);
        g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    });
    g.fill();
    g.restore();

    g.textAlign = "center";
    g.textBaseline = "middle";
    items.forEach((item) => {
        g.save();
        g.translate(item.x, item.y);
        g.rotate((item.angle * Math.PI) / 180);
        g.font = treeFont(item.size);
        g.fillStyle = colorFor(item);
        g.fillText(item.text, 0, item.size * 0.04);
        g.restore();
    });
}
