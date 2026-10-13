// Run with: node assets/travel/travel.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'travel.js'), 'utf8');
// Evaluate the exact pure helpers used by the page, without a browser or WebGL.
const helpers = source.slice(source.indexOf('function sunPosition'), source.indexOf('    const lived'));
const context = vm.createContext({});
vm.runInContext(helpers, context);
const { sunPosition, geoVector, colorChannels } = context;
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

const march = sunPosition(new Date('2026-03-20T12:00:00Z'));
close(march.lat, 0, 1);
close(march.lng, 0, 3);
close(sunPosition(new Date('2026-06-21T12:00:00Z')).lat, 23.44, 0.5);
close(sunPosition(new Date('2026-12-21T12:00:00Z')).lat, -23.44, 0.5);
const afternoon = sunPosition(new Date('2026-03-20T18:00:00Z'));
close(afternoon.lng - march.lng, -90, 0.2);
assert.equal(JSON.stringify(sunPosition(new Date('2026-03-20T14:00:00+02:00'))), JSON.stringify(march));
for (const date of ['2024-02-29T23:59:59Z', '2026-12-31T23:59:59Z', '2027-01-01T00:00:00Z']) {
    const sun = sunPosition(new Date(date));
    assert.ok(Number.isFinite(sun.lat) && sun.lng >= -180 && sun.lng <= 180);
    const normal = geoVector(sun.lat, sun.lng);
    close(dot(normal, normal), 1, 1e-10);
    close(dot(normal, geoVector(-sun.lat, sun.lng + 180)), -1, 1e-10);
}
close(geoVector(0, 0)[2], 1, 1e-10);
close(geoVector(0, 90)[0], 1, 1e-10);
close(geoVector(90, 0)[1], 1, 1e-10);

const mapContext = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'countries.js'), 'utf8'), mapContext);
const features = mapContext.window.TRAVEL_COUNTRIES;
assert.ok(features.length > 170);
const livedCodes = ['CHN', 'USA', 'CHE', 'DEU', 'TWN'];
const visitedCodes = ['JPN', 'THA', 'AUS', 'FRA', 'ESP', 'AUT', 'ITA', 'HUN', 'CZE', 'NLD', 'PRT', 'LUX'];
const groups = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('    const lived'), source.indexOf('    const popover')), groups);
assert.equal(vm.runInContext('lived.length', groups), 5);
assert.equal(vm.runInContext('visited.length', groups), 12);
for (const code of livedCodes) assert.equal(groups.countryCategory(code), 'lived');
for (const code of visitedCodes) assert.equal(groups.countryCategory(code), 'visited');
assert.equal(groups.countryCategory('CAN'), 'other');
assert.notEqual(vm.runInContext('palette.lived.fill', groups), vm.runInContext('palette.visited.fill', groups));
const palette = vm.runInContext('palette', groups);
assert.equal(palette.lived.label, 'Warm sand');
assert.equal(palette.visited.label, 'Dusty lavender');
close(colorChannels('#c6ad91')[0], 198 / 255, 1e-10);
for (const group of [palette.lived, palette.visited]) {
    for (const color of [group.fill, group.stroke, group.marker]) {
        const rgb = colorChannels(color);
        const max = Math.max(...rgb), min = Math.min(...rgb);
        const saturation = (max - min) / (1 - Math.abs(max + min - 1));
        assert.ok(saturation < 0.35, 'Highlights, borders, and markers should remain low-saturation');
    }
}
const swatches = [palette.lived.fill, palette.lived.stroke, palette.visited.fill, palette.visited.stroke].map(colorChannels);
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
for (const neutral of [palette.other.fill, palette.other.stroke, '#234963', '#325971']) {
    assert.ok(swatches.every(swatch => distance(swatch, colorChannels(neutral)) > 0.16), 'Unvisited land and ocean must not glow as highlights at night');
}
assert.ok(distance(colorChannels(palette.lived.fill), colorChannels(palette.visited.fill)) > 0.15, 'The muted highlight colors stay distinct');
for (const code of [...livedCodes, ...visitedCodes]) {
    const matches = features.filter(feature => feature.properties.code === code);
    assert.equal(matches.length, 1, `Exactly one country feature for ${code}`);
    assert.ok(matches[0].geometry.coordinates.length > 0);
}
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
assert.ok(!html.includes('data-country="'), 'No country-list text in the compact globe');
assert.ok(!html.includes('src="assets/travel/vendor/'), 'Heavy assets must remain lazy-loaded');
assert.equal((html.match(/id="travel-popover"/g) || []).length, 1);
console.log('Passed: solar positions, UTC and leap years, rotation, day/night vectors, all 17 place geometries and lived/visited categories, distinct low-saturation colors and night-highlight separation, lazy loading and compact popover markup.');
