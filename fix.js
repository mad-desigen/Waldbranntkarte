'use strict';

renderVector = function () {
    if (S.vector) {
        map.removeLayer(S.vector);
    }

    if (!S.geo) {
        return;
    }

    S.vector = L.geoJSON(S.geo, {
        style: function (feature) {
            return {
                color: feature.properties.farbe,
                weight: 0,
                opacity: 0,
                fillColor: feature.properties.farbe,
                fillOpacity: 1
            };
        }
    }).addTo(map);

    if (S.stateLayer) {
        S.stateLayer.addTo(map);
        S.stateLayer.bringToFront();
    }
};

function refreshBrandLogo() {
    var logo = document.getElementById('brandLogo');
    var paletteSelect = document.getElementById('palette');

    if (!logo || !paletteSelect || !PALETTES[paletteSelect.value]) {
        return;
    }

    var selectedPalette = PALETTES[paletteSelect.value];
    var logoUrl = new URL(selectedPalette.logo, document.baseURI);
    logoUrl.searchParams.set('v', String(Date.now()));

    logo.removeAttribute('src');
    logo.src = logoUrl.href;
    logo.alt = selectedPalette.logoAlt;
}

window.addEventListener('load', function () {
    refreshBrandLogo();

    window.setTimeout(function () {
        if (S.geo) {
            renderVector();
        }
    }, 50);
});

document.getElementById('palette').addEventListener('change', function () {
    refreshBrandLogo();

    window.setTimeout(function () {
        if (S.geo) {
            renderVector();
        }
    }, 0);
});
