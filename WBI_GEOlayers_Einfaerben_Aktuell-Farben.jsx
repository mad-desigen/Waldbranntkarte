/*
WBI GEOlayers Einfärber – Aktuell-Farben
Für After Effects / GEOlayers 3

Erkennt die fünf Waldbrandgefahrenstufen anhand der Ebenen- oder Gruppennamen
und färbt die Shape-Füllungen automatisch ein.

Gestaltungsfarben:
WBI 5 – Sehr hohe Gefahr: #71207f
WBI 4 – Hohe Gefahr:      #c61e1e
WBI 3 – Mittlere Gefahr:  #ff8b00
WBI 2 – Geringe Gefahr:   #fec804
WBI 1 – Sehr geringe Gefahr: #c1bdb2
*/

(function WBIColorizer(thisObj) {
    "use strict";

    var PALETTE = [
        {
            level: 5,
            name: "Sehr hohe Gefahr",
            fullName: "WBI 5 \u2013 Sehr hohe Gefahr",
            hex: "#71207f",
            rgb: [113 / 255, 32 / 255, 127 / 255]
        },
        {
            level: 1,
            name: "Sehr geringe Gefahr",
            fullName: "WBI 1 \u2013 Sehr geringe Gefahr",
            hex: "#c1bdb2",
            rgb: [193 / 255, 189 / 255, 178 / 255]
        },
        {
            level: 4,
            name: "Hohe Gefahr",
            fullName: "WBI 4 \u2013 Hohe Gefahr",
            hex: "#c61e1e",
            rgb: [198 / 255, 30 / 255, 30 / 255]
        },
        {
            level: 3,
            name: "Mittlere Gefahr",
            fullName: "WBI 3 \u2013 Mittlere Gefahr",
            hex: "#ff8b00",
            rgb: [255 / 255, 139 / 255, 0 / 255]
        },
        {
            level: 2,
            name: "Geringe Gefahr",
            fullName: "WBI 2 \u2013 Geringe Gefahr",
            hex: "#fec804",
            rgb: [254 / 255, 200 / 255, 4 / 255]
        }
    ];

    function normalizeText(value) {
        if (value === null || value === undefined) {
            return "";
        }

        return String(value)
            .toLowerCase()
            .replace(/\u00e4/g, "ae")
            .replace(/\u00f6/g, "oe")
            .replace(/\u00fc/g, "ue")
            .replace(/\u00df/g, "ss")
            .replace(/[\u2013\u2014]/g, "-")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/^\s+|\s+$/g, "");
    }

    function containsLevelReference(text, level) {
        var normalized = normalizeText(text);
        var patterns = [
            new RegExp("(^| )wbi " + level + "($| )"),
            new RegExp("(^| )wbi" + level + "($| )"),
            new RegExp("(^| )stufe " + level + "($| )"),
            new RegExp("(^| )index " + level + "($| )"),
            new RegExp("(^| )gefahr " + level + "($| )")
        ];

        for (var i = 0; i < patterns.length; i++) {
            if (patterns[i].test(normalized)) {
                return true;
            }
        }

        return false;
    }

    function detectPaletteEntry(text) {
        var normalized = normalizeText(text);

        if (!normalized) {
            return null;
        }

        // Die spezifischen Bezeichnungen müssen vor den kürzeren Begriffen geprüft werden.
        if (normalized.indexOf("sehr hohe gefahr") !== -1 || containsLevelReference(normalized, 5)) {
            return findByLevel(5);
        }

        if (normalized.indexOf("sehr geringe gefahr") !== -1 || containsLevelReference(normalized, 1)) {
            return findByLevel(1);
        }

        if (normalized.indexOf("mittlere gefahr") !== -1 || containsLevelReference(normalized, 3)) {
            return findByLevel(3);
        }

        if (normalized.indexOf("hohe gefahr") !== -1 || containsLevelReference(normalized, 4)) {
            return findByLevel(4);
        }

        if (normalized.indexOf("geringe gefahr") !== -1 || containsLevelReference(normalized, 2)) {
            return findByLevel(2);
        }

        return null;
    }

    function findByLevel(level) {
        for (var i = 0; i < PALETTE.length; i++) {
            if (PALETTE[i].level === level) {
                return PALETTE[i];
            }
        }
        return null;
    }

    function collectLayerText(layer) {
        var values = [];

        try {
            values.push(layer.name);
        } catch (ignoreName) {}

        try {
            if (layer.comment) {
                values.push(layer.comment);
            }
        } catch (ignoreComment) {}

        try {
            if (layer.source && layer.source.name) {
                values.push(layer.source.name);
            }
        } catch (ignoreSource) {}

        return values.join(" | ");
    }

    function setColorProperty(property, rgb) {
        if (!property || property.isTimeVarying) {
            // Auch animierte Farben dürfen auf Wunsch vereinheitlicht werden.
            // setValue entfernt keine Keyframes, setzt aber bei animierten Properties nicht zuverlässig alle Werte.
            if (property && property.numKeys > 0) {
                for (var keyIndex = 1; keyIndex <= property.numKeys; keyIndex++) {
                    property.setValueAtKey(keyIndex, rgb);
                }
                return true;
            }
        }

        try {
            property.setValue(rgb);
            return true;
        } catch (error) {
            return false;
        }
    }

    function colorPropertiesRecursive(propertyGroup, paletteEntry, colorStrokes) {
        var fillsChanged = 0;
        var strokesChanged = 0;

        if (!propertyGroup || !propertyGroup.numProperties) {
            return { fills: 0, strokes: 0 };
        }

        for (var i = 1; i <= propertyGroup.numProperties; i++) {
            var property;

            try {
                property = propertyGroup.property(i);
            } catch (readError) {
                continue;
            }

            if (!property) {
                continue;
            }

            try {
                if (property.matchName === "ADBE Vector Fill Color") {
                    if (setColorProperty(property, paletteEntry.rgb)) {
                        fillsChanged++;
                    }
                    continue;
                }

                if (colorStrokes && property.matchName === "ADBE Vector Stroke Color") {
                    if (setColorProperty(property, paletteEntry.rgb)) {
                        strokesChanged++;
                    }
                    continue;
                }
            } catch (matchError) {}

            try {
                if (property.numProperties && property.numProperties > 0) {
                    var nested = colorPropertiesRecursive(property, paletteEntry, colorStrokes);
                    fillsChanged += nested.fills;
                    strokesChanged += nested.strokes;
                }
            } catch (nestedError) {}
        }

        return { fills: fillsChanged, strokes: strokesChanged };
    }

    function addFillToContainer(container, paletteEntry) {
        if (!container || !container.canAddProperty("ADBE Vector Graphic - Fill")) {
            return false;
        }

        try {
            var fill = container.addProperty("ADBE Vector Graphic - Fill");
            var color = fill.property("ADBE Vector Fill Color");

            if (color) {
                color.setValue(paletteEntry.rgb);
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    function processNamedShapeGroup(shapeGroup, options) {
        var paletteEntry = detectPaletteEntry(shapeGroup.name);

        if (!paletteEntry) {
            return null;
        }

        var result = colorPropertiesRecursive(shapeGroup, paletteEntry, options.colorStrokes);

        if (result.fills === 0) {
            try {
                var contents = shapeGroup.property("ADBE Vectors Group");
                if (addFillToContainer(contents, paletteEntry)) {
                    result.fills++;
                }
            } catch (ignoreAddFill) {}
        }

        if (options.renameGroups) {
            try {
                shapeGroup.name = paletteEntry.fullName;
            } catch (ignoreRename) {}
        }

        return {
            entry: paletteEntry,
            fills: result.fills,
            strokes: result.strokes
        };
    }

    function processLayer(layer, options) {
        var root;

        try {
            root = layer.property("ADBE Root Vectors Group");
        } catch (rootError) {
            return null;
        }

        if (!root) {
            return null;
        }

        var matchedGroups = 0;
        var fillsChanged = 0;
        var strokesChanged = 0;
        var firstEntry = null;

        // GEOlayers kann mehrere GeoJSON-Features als benannte Shape-Gruppen in einer Ebene anlegen.
        // Deshalb werden zuerst die einzelnen Gruppen geprüft und separat eingefärbt.
        for (var i = 1; i <= root.numProperties; i++) {
            var property;

            try {
                property = root.property(i);
            } catch (readError) {
                continue;
            }

            if (!property || property.matchName !== "ADBE Vector Group") {
                continue;
            }

            var groupResult = processNamedShapeGroup(property, options);

            if (groupResult) {
                matchedGroups++;
                fillsChanged += groupResult.fills;
                strokesChanged += groupResult.strokes;

                if (!firstEntry) {
                    firstEntry = groupResult.entry;
                }
            }
        }

        if (matchedGroups > 0) {
            if (options.renameLayers && matchedGroups === 1 && firstEntry) {
                try {
                    layer.name = firstEntry.fullName;
                } catch (ignoreSingleGroupRename) {}
            }

            return {
                matched: matchedGroups,
                fills: fillsChanged,
                strokes: strokesChanged
            };
        }

        // Falls GEOlayers den Feature-Namen direkt als Ebenennamen angelegt hat,
        // wird die gesamte Shape-Ebene eingefärbt.
        var layerEntry = detectPaletteEntry(collectLayerText(layer));

        if (!layerEntry) {
            return null;
        }

        var layerResult = colorPropertiesRecursive(root, layerEntry, options.colorStrokes);

        if (layerResult.fills === 0) {
            if (addFillToContainer(root, layerEntry)) {
                layerResult.fills++;
            }
        }

        if (options.renameLayers) {
            try {
                layer.name = layerEntry.fullName;
            } catch (ignoreLayerRename) {}
        }

        return {
            matched: 1,
            fills: layerResult.fills,
            strokes: layerResult.strokes
        };
    }

    function getCandidateLayers(comp, selectedOnly) {
        var result = [];
        var i;

        if (selectedOnly && comp.selectedLayers && comp.selectedLayers.length > 0) {
            for (i = 0; i < comp.selectedLayers.length; i++) {
                result.push(comp.selectedLayers[i]);
            }
            return result;
        }

        for (i = 1; i <= comp.numLayers; i++) {
            result.push(comp.layer(i));
        }

        return result;
    }

    function runColoring(options, statusLabel) {
        var comp = app.project.activeItem;

        if (!(comp instanceof CompItem)) {
            alert("Bitte zuerst die GEOlayers-Komposition öffnen.");
            return;
        }

        var layers = getCandidateLayers(comp, options.selectedOnly);
        var layersMatched = 0;
        var featuresMatched = 0;
        var fillsChanged = 0;
        var strokesChanged = 0;

        app.beginUndoGroup("WBI-GEOlayers-Flächen einfärben");

        try {
            for (var i = 0; i < layers.length; i++) {
                var layer = layers[i];

                if (!(layer instanceof ShapeLayer)) {
                    continue;
                }

                var result = processLayer(layer, options);

                if (!result) {
                    continue;
                }

                layersMatched++;
                featuresMatched += result.matched;
                fillsChanged += result.fills;
                strokesChanged += result.strokes;
            }
        } catch (error) {
            alert(
                "Beim Einfärben ist ein Fehler aufgetreten:\n\n" +
                error.toString() +
                (error.line ? "\nZeile: " + error.line : "")
            );
        } finally {
            app.endUndoGroup();
        }

        var message =
            layersMatched + " Shape-Ebene(n), " +
            featuresMatched + " WBI-Fläche(n) erkannt, " +
            fillsChanged + " Füllung(en) eingefärbt";

        if (options.colorStrokes) {
            message += ", " + strokesChanged + " Kontur(en) eingefärbt";
        }

        message += ".";

        statusLabel.text = message;

        if (featuresMatched === 0) {
            alert(
                "Es wurden keine benannten WBI-Flächen gefunden.\n\n" +
                "Erwartete Namen sind beispielsweise:\n" +
                "\u2022 Sehr hohe Gefahr\n" +
                "\u2022 WBI 4 \u2013 Hohe Gefahr\n" +
                "\u2022 Mittlere Gefahr\n\n" +
                "Exportiere die GeoJSON-Datei erneut mit der aktuellen Version des Waldbrandkarten-Tools."
            );
        }
    }

    function buildUI(thisObj) {
        var panel = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", "WBI GEOlayers Einfärber – Aktuell-Farben", undefined, { resizeable: true });

        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.spacing = 8;
        panel.margins = 12;

        var intro = panel.add(
            "statictext",
            undefined,
            "Färbt GEOlayers-Shape-Flächen anhand ihrer WBI-Namen automatisch ein.",
            { multiline: true }
        );
        intro.alignment = ["fill", "top"];

        var optionsPanel = panel.add("panel", undefined, "Optionen");
        optionsPanel.orientation = "column";
        optionsPanel.alignChildren = ["left", "top"];
        optionsPanel.margins = 10;

        var selectedOnly = optionsPanel.add("checkbox", undefined, "Nur ausgewählte Ebenen");
        selectedOnly.value = true;

        var colorStrokes = optionsPanel.add("checkbox", undefined, "Konturen ebenfalls einfärben");
        colorStrokes.value = false;

        var renameLayers = optionsPanel.add("checkbox", undefined, "Erkannte Ebenen eindeutig umbenennen");
        renameLayers.value = true;

        var renameGroups = optionsPanel.add("checkbox", undefined, "Erkannte Shape-Gruppen umbenennen");
        renameGroups.value = true;

        var palettePanel = panel.add("panel", undefined, "Farben · Aktuell-Farben");
        palettePanel.orientation = "column";
        palettePanel.alignChildren = ["left", "top"];
        palettePanel.margins = 10;

        var displayOrder = [5, 4, 3, 2, 1];

        for (var i = 0; i < displayOrder.length; i++) {
            var entry = findByLevel(displayOrder[i]);
            palettePanel.add("statictext", undefined, entry.fullName + ": " + entry.hex);
        }

        var applyButton = panel.add("button", undefined, "WBI-Flächen einfärben");
        applyButton.alignment = ["fill", "top"];

        var statusLabel = panel.add("statictext", undefined, "Bereit · Aktuell-Farben.", { multiline: true });
        statusLabel.alignment = ["fill", "top"];

        applyButton.onClick = function () {
            runColoring(
                {
                    selectedOnly: selectedOnly.value,
                    colorStrokes: colorStrokes.value,
                    renameLayers: renameLayers.value,
                    renameGroups: renameGroups.value
                },
                statusLabel
            );
        };

        panel.onResizing = panel.onResize = function () {
            this.layout.resize();
        };

        if (panel instanceof Window) {
            panel.center();
            panel.show();
        } else {
            panel.layout.layout(true);
        }

        return panel;
    }

    buildUI(thisObj);
})(this);
