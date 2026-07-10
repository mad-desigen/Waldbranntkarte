/*
WBI GEOlayers Einfaerber - MA
Fuer After Effects / GEOlayers 3

Erkennt die fuenf Waldbrandgefahrenstufen anhand der Ebenen- oder Gruppennamen
und faerbt Shape-Fuellungen automatisch ein.
*/

(function WBIColorizerMA(thisObj) {
    "use strict";

    var PALETTE = [
        { level: 5, name: "Sehr hohe Gefahr", fullName: "WBI 5 - Sehr hohe Gefahr", hex: "#a62121", rgb: [166 / 255, 33 / 255, 33 / 255] },
        { level: 4, name: "Hohe Gefahr", fullName: "WBI 4 - Hohe Gefahr", hex: "#fd6165", rgb: [253 / 255, 97 / 255, 101 / 255] },
        { level: 3, name: "Mittlere Gefahr", fullName: "WBI 3 - Mittlere Gefahr", hex: "#fabb7a", rgb: [250 / 255, 187 / 255, 122 / 255] },
        { level: 2, name: "Geringe Gefahr", fullName: "WBI 2 - Geringe Gefahr", hex: "#f8f287", rgb: [248 / 255, 242 / 255, 135 / 255] },
        { level: 1, name: "Sehr geringe Gefahr", fullName: "WBI 1 - Sehr geringe Gefahr", hex: "#d0cbc2", rgb: [208 / 255, 203 / 255, 194 / 255] }
    ];

    function normalize(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
            .replace(/[–—]/g, "-")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/^\s+|\s+$/g, "");
    }

    function byLevel(level) {
        for (var i = 0; i < PALETTE.length; i++) if (PALETTE[i].level === level) return PALETTE[i];
        return null;
    }

    function hasLevel(text, level) {
        var n = normalize(text);
        return new RegExp("(^| )(wbi ?|stufe |index |gefahr )" + level + "($| )").test(n);
    }

    function detect(text) {
        var n = normalize(text);
        if (!n) return null;
        if (n.indexOf("sehr hohe gefahr") !== -1 || hasLevel(n, 5)) return byLevel(5);
        if (n.indexOf("sehr geringe gefahr") !== -1 || hasLevel(n, 1)) return byLevel(1);
        if (n.indexOf("mittlere gefahr") !== -1 || hasLevel(n, 3)) return byLevel(3);
        if (n.indexOf("hohe gefahr") !== -1 || hasLevel(n, 4)) return byLevel(4);
        if (n.indexOf("geringe gefahr") !== -1 || hasLevel(n, 2)) return byLevel(2);
        return null;
    }

    function setColor(prop, rgb) {
        try {
            if (prop.numKeys && prop.numKeys > 0) {
                for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtKey(k, rgb);
            } else {
                prop.setValue(rgb);
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function colorRecursive(group, entry, colorStrokes) {
        var fills = 0, strokes = 0;
        if (!group || !group.numProperties) return { fills: 0, strokes: 0 };
        for (var i = 1; i <= group.numProperties; i++) {
            var p;
            try { p = group.property(i); } catch (e) { continue; }
            if (!p) continue;
            try {
                if (p.matchName === "ADBE Vector Fill Color") { if (setColor(p, entry.rgb)) fills++; continue; }
                if (colorStrokes && p.matchName === "ADBE Vector Stroke Color") { if (setColor(p, entry.rgb)) strokes++; continue; }
                if (p.numProperties && p.numProperties > 0) {
                    var r = colorRecursive(p, entry, colorStrokes);
                    fills += r.fills; strokes += r.strokes;
                }
            } catch (ignore) {}
        }
        return { fills: fills, strokes: strokes };
    }

    function addFill(container, entry) {
        try {
            if (!container || !container.canAddProperty("ADBE Vector Graphic - Fill")) return false;
            var fill = container.addProperty("ADBE Vector Graphic - Fill");
            var color = fill.property("ADBE Vector Fill Color");
            if (color) color.setValue(entry.rgb);
            return true;
        } catch (e) { return false; }
    }

    function processLayer(layer, options) {
        if (!(layer instanceof ShapeLayer)) return null;
        var root;
        try { root = layer.property("ADBE Root Vectors Group"); } catch (e) { return null; }
        if (!root) return null;

        var matched = 0, fills = 0, strokes = 0, first = null;
        for (var i = 1; i <= root.numProperties; i++) {
            var g;
            try { g = root.property(i); } catch (e) { continue; }
            if (!g || g.matchName !== "ADBE Vector Group") continue;
            var entry = detect(g.name);
            if (!entry) continue;
            var r = colorRecursive(g, entry, options.colorStrokes);
            if (r.fills === 0) {
                try { if (addFill(g.property("ADBE Vectors Group"), entry)) r.fills++; } catch (ignore) {}
            }
            if (options.renameGroups) try { g.name = entry.fullName; } catch (ignoreName) {}
            matched++; fills += r.fills; strokes += r.strokes; if (!first) first = entry;
        }

        if (!matched) {
            var layerText = layer.name;
            try { if (layer.comment) layerText += " " + layer.comment; } catch (ignoreComment) {}
            var layerEntry = detect(layerText);
            if (!layerEntry) return null;
            var lr = colorRecursive(root, layerEntry, options.colorStrokes);
            if (lr.fills === 0 && addFill(root, layerEntry)) lr.fills++;
            if (options.renameLayers) try { layer.name = layerEntry.fullName; } catch (ignoreLayerName) {}
            return { matched: 1, fills: lr.fills, strokes: lr.strokes };
        }

        if (options.renameLayers && matched === 1 && first) try { layer.name = first.fullName; } catch (ignoreSingleName) {}
        return { matched: matched, fills: fills, strokes: strokes };
    }

    function run(options) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) { alert("Bitte zuerst die GEOlayers-Komposition oeffnen."); return; }
        var layers = options.selectedOnly && comp.selectedLayers.length ? comp.selectedLayers : [];
        if (!layers.length) for (var i = 1; i <= comp.numLayers; i++) layers.push(comp.layer(i));
        var matched = 0, fills = 0, strokes = 0;
        app.beginUndoGroup("WBI-GEOlayers-Flaechen einfaerben");
        for (var j = 0; j < layers.length; j++) {
            var r = processLayer(layers[j], options);
            if (!r) continue;
            matched += r.matched; fills += r.fills; strokes += r.strokes;
        }
        app.endUndoGroup();
        alert("Fertig.\nFeatures erkannt: " + matched + "\nFuellungen geaendert: " + fills + "\nKonturen geaendert: " + strokes);
    }

    var win = new Window("palette", "WBI Einfaerben - MA");
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    var selected = win.add("checkbox", undefined, "Nur ausgewählte Ebenen"); selected.value = true;
    var strokes = win.add("checkbox", undefined, "Konturen mit einfärben"); strokes.value = false;
    var renameLayers = win.add("checkbox", undefined, "Ebenen nach WBI-Stufen umbenennen"); renameLayers.value = false;
    var renameGroups = win.add("checkbox", undefined, "Gruppen nach WBI-Stufen umbenennen"); renameGroups.value = false;
    var btn = win.add("button", undefined, "Einfärben");
    btn.onClick = function () { run({ selectedOnly: selected.value, colorStrokes: strokes.value, renameLayers: renameLayers.value, renameGroups: renameGroups.value }); };
    win.center();
    win.show();
})(this);
