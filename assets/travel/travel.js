(() => {
    'use strict';

    // Approximate solar position, using NOAA's fractional-year equations.
    // Use the actual instant in UTC, independently of the viewer's time zone.
    function sunPosition(date) {
        const year = date.getUTCFullYear();
        const start = Date.UTC(year, 0, 1);
        const days = (Date.UTC(year + 1, 0, 1) - start) / 86400000;
        const elapsedDays = (date.getTime() - start) / 86400000;
        const gamma = 2 * Math.PI / days * (elapsedDays - 0.5);
        const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma)
            - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma)
            - 0.040849 * Math.sin(2 * gamma));
        const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
            - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
            - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
        const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
        const longitude = (720 - minutes - equation) / 4;
        return { lat: declination * 180 / Math.PI, lng: ((longitude + 540) % 360) - 180 };
    }

    function geoVector(lat, lng) {
        const phi = lat * Math.PI / 180;
        const theta = lng * Math.PI / 180;
        return [Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta)];
    }

    const lived = [
        { code: 'CHN', name: 'China', lat: 35.9, lng: 104.2 },
        { code: 'USA', name: 'United States', lat: 38, lng: -97 },
        { code: 'CHE', name: 'Switzerland', lat: 46.8, lng: 8.2 },
        { code: 'DEU', name: 'Germany', lat: 51.2, lng: 10.5 },
        { code: 'TWN', name: 'Taiwan', lat: 23.7, lng: 121 }
    ];
    const visited = [
        { code: 'JPN', name: 'Japan', lat: 36.2, lng: 138.3 },
        { code: 'THA', name: 'Thailand', lat: 15.9, lng: 100.9 },
        { code: 'AUS', name: 'Australia', lat: -25.3, lng: 133.8 },
        { code: 'FRA', name: 'France', lat: 46.6, lng: 2.2 },
        { code: 'ESP', name: 'Spain', lat: 40.5, lng: -3.7 },
        { code: 'AUT', name: 'Austria', lat: 47.5, lng: 14.6 },
        { code: 'ITA', name: 'Italy', lat: 42.5, lng: 12.6 },
        { code: 'HUN', name: 'Hungary', lat: 47.2, lng: 19.5 },
        { code: 'CZE', name: 'Czechia', lat: 49.8, lng: 15.5 },
        { code: 'NLD', name: 'Netherlands', lat: 52.1, lng: 5.3 },
        { code: 'PRT', name: 'Portugal', lat: 39.4, lng: -8.2 }
    ];
    const livedCodes = new Set(lived.map(country => country.code));
    const visitedCodes = new Set(visited.map(country => country.code));
    const palette = {
        lived: { fill: '#efbd77', stroke: '#ffdfac', marker: '#ffdfac' },
        visited: { fill: '#62cfbc', stroke: '#a1f0df', marker: '#a1f0df' },
        other: { fill: '#789caa', stroke: '#385d72' }
    };
    function countryCategory(code) {
        return livedCodes.has(code) ? 'lived' : visitedCodes.has(code) ? 'visited' : 'other';
    }
    const popover = document.getElementById('travel-popover');
    const trigger = document.getElementById('travel-trigger');
    const container = document.getElementById('travel-globe');
    const loading = document.getElementById('travel-loading');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const assetBase = new URL('.', document.currentScript.src);
    let globe;
    let initializing;
    let timer;
    const scripts = new Map();

    function loadScript(path) {
        if (scripts.has(path)) return scripts.get(path);
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = new URL(path, assetBase).href;
            const timeout = setTimeout(() => fail(), 20000);
            function fail() {
                clearTimeout(timeout);
                script.remove();
                scripts.delete(path);
                reject(new Error('Could not load ' + path));
            }
            script.onload = () => { clearTimeout(timeout); resolve(); };
            script.onerror = fail;
            document.head.appendChild(script);
        });
        scripts.set(path, promise);
        return promise;
    }

    function mapTexture(THREE, renderer) {
        const map = document.createElement('canvas');
        map.width = Math.min(4096, renderer.capabilities.maxTextureSize);
        map.height = map.width / 2;
        const ctx = map.getContext('2d');
        ctx.fillStyle = '#234963';
        ctx.fillRect(0, 0, map.width, map.height);
        ctx.strokeStyle = '#325971';
        ctx.lineWidth = 0.7;
        for (let lng = -180; lng <= 180; lng += 15) {
            const x = (lng + 180) / 360 * map.width;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, map.height); ctx.stroke();
        }
        for (let lat = -75; lat <= 75; lat += 15) {
            const y = (90 - lat) / 180 * map.height;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(map.width, y); ctx.stroke();
        }
        // Highlighted places go on top; lived places retain their gold borders.
        const paintOrder = { other: 0, visited: 1, lived: 2 };
        const features = [...window.TRAVEL_COUNTRIES].sort((a, b) =>
            paintOrder[countryCategory(a.properties.code)] - paintOrder[countryCategory(b.properties.code)]);
        for (const feature of features) {
            const category = countryCategory(feature.properties.code);
            const colors = palette[category];
            const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
            ctx.fillStyle = colors.fill;
            ctx.strokeStyle = colors.stroke;
            ctx.lineWidth = category === 'other' ? 1 : 1.8;
            for (const polygon of polygons) {
                ctx.beginPath();
                for (const ring of polygon) {
                    ring.forEach(([lng, lat], index) => {
                        const x = (lng + 180) / 360 * map.width;
                        const y = (90 - lat) / 180 * map.height;
                        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                    });
                    ctx.closePath();
                }
                ctx.fill('evenodd');
                ctx.stroke();
            }
        }
        const texture = new THREE.CanvasTexture(map);
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        return texture;
    }

    function createGlobe() {
        const THREE = window.THREE;
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 30);
        const group = new THREE.Group();
        scene.add(group);
        const sun = new THREE.Vector3();
        const geometry = new THREE.SphereGeometry(1, 96, 64);
        // Align equirectangular texture longitude 0 with +Z, north with +Y.
        geometry.rotateY(-Math.PI / 2);
        const material = new THREE.ShaderMaterial({
            uniforms: { earthMap: { value: mapTexture(THREE, renderer) }, sunDirection: { value: sun } },
            vertexShader: `
                varying vec2 mapUv;
                varying vec3 earthNormal;
                varying vec3 viewNormal;
                varying vec3 viewDirection;
                void main() {
                    mapUv = uv;
                    earthNormal = normalize(position);
                    viewNormal = normalize(normalMatrix * normal);
                    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                    viewDirection = normalize(-viewPosition.xyz);
                    gl_Position = projectionMatrix * viewPosition;
                }`,
            fragmentShader: `
                uniform sampler2D earthMap;
                uniform vec3 sunDirection;
                varying vec2 mapUv;
                varying vec3 earthNormal;
                varying vec3 viewNormal;
                varying vec3 viewDirection;
                void main() {
                    vec3 color = texture2D(earthMap, mapUv).rgb;
                    float solar = dot(normalize(earthNormal), sunDirection);
                    float daylight = smoothstep(-0.10, 0.10, solar);
                    // Keep both gold (lived) and teal (visited) legible at night.
                    float lived = smoothstep(0.15, 0.35, color.r - color.b);
                    float visited = smoothstep(0.23, 0.38, color.g - color.r);
                    vec3 night = color * vec3(0.15, 0.22, 0.32);
                    night = mix(night, color * 0.60, max(lived, visited));
                    vec3 day = color * (0.78 + 0.22 * max(solar, 0.0));
                    float rim = pow(1.0 - max(dot(normalize(viewNormal), normalize(viewDirection)), 0.0), 3.0);
                    vec3 atmosphere = vec3(0.16, 0.38, 0.56) * rim * (0.35 + 0.65 * daylight);
                    gl_FragColor = vec4(mix(night, day, daylight) + atmosphere, 1.0);
                }`
        });
        group.add(new THREE.Mesh(geometry, material));
        const markerGeometry = new THREE.SphereGeometry(0.009, 12, 8);
        const markerMaterials = {
            lived: new THREE.MeshBasicMaterial({ color: palette.lived.marker }),
            visited: new THREE.MeshBasicMaterial({ color: palette.visited.marker })
        };
        for (const country of [...lived, ...visited]) {
            const marker = new THREE.Mesh(markerGeometry, markerMaterials[countryCategory(country.code)]);
            marker.position.fromArray(geoVector(country.lat, country.lng)).multiplyScalar(1.008);
            group.add(marker);
        }
        const canvas = renderer.domElement;
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-label', `World globe. Gold, lived in: ${lived.map(country => country.name).join(', ')}. Teal, visited: ${visited.map(country => country.name).join(', ')}. Drag or use arrow keys to rotate, scroll or use plus and minus to zoom. Escape to close.`);
        container.appendChild(canvas);
        let pitch = 28 * Math.PI / 180;
        let yaw = -25 * Math.PI / 180;
        let distance = 3.5;
        let target = { pitch, yaw, distance };
        let frame;
        let active = false;
        let lastFrame = 0;
        let pinchDistance = 0;
        const pointers = new Map();

        function resize() {
            const width = container.clientWidth;
            const height = container.clientHeight;
            if (!width || !height) return;
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
        new ResizeObserver(resize).observe(container);
        resize();

        function render(now) {
            if (!active) return;
            const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-Math.min(now - lastFrame, 100) / 100);
            lastFrame = now;
            pitch += (target.pitch - pitch) * blend;
            yaw += (target.yaw - yaw) * blend;
            distance += (target.distance - distance) * blend;
            group.rotation.set(pitch, yaw, 0);
            // Center the globe in the compact popover.
            camera.position.set(0, 0, distance * Math.max(1, 0.96 / camera.aspect));
            renderer.render(scene, camera);
            frame = requestAnimationFrame(render);
        }
        function setActive(value) {
            active = value;
            cancelAnimationFrame(frame);
            pointers.clear();
            pinchDistance = 0;
            if (active) { resize(); lastFrame = performance.now(); frame = requestAnimationFrame(render); }
        }
        function zoom(delta) { target.distance = Math.max(2.15, Math.min(5, target.distance + delta)); }
        function action(name) {
            if (name === 'left') target.yaw -= 0.3;
            if (name === 'right') target.yaw += 0.3;
            if (name === 'in') zoom(-0.35);
            if (name === 'out') zoom(0.35);
            if (name === 'reset') {
                target = { pitch: 28 * Math.PI / 180, yaw: -25 * Math.PI / 180, distance: 3.5 };
            }
        }
        canvas.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            canvas.focus({ preventScroll: true });
            canvas.setPointerCapture(event.pointerId);
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            pinchDistance = 0;
        });
        canvas.addEventListener('pointermove', event => {
            const previous = pointers.get(event.pointerId);
            if (!previous) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.size === 1) {
                target.yaw += (event.clientX - previous.x) * 0.006;
                target.pitch = Math.max(-1.45, Math.min(1.45, target.pitch + (event.clientY - previous.y) * 0.006));
            } else {
                const [a, b] = [...pointers.values()];
                const separation = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinchDistance) zoom((pinchDistance - separation) * 0.008);
                pinchDistance = separation;
            }
        });
        function release(event) { pointers.delete(event.pointerId); pinchDistance = 0; }
        canvas.addEventListener('pointerup', release);
        canvas.addEventListener('pointercancel', release);
        canvas.addEventListener('lostpointercapture', release);
        canvas.addEventListener('wheel', event => {
            event.preventDefault();
            zoom(Math.sign(event.deltaY) * 0.16);
        }, { passive: false });
        canvas.addEventListener('keydown', event => {
            const actions = { ArrowLeft: 'left', ArrowRight: 'right', '+': 'in', '=': 'in', '-': 'out', Home: 'reset' };
            if (actions[event.key]) { event.preventDefault(); action(actions[event.key]); }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                target.pitch = Math.max(-1.45, Math.min(1.45, target.pitch + (event.key === 'ArrowUp' ? -0.2 : 0.2)));
            }
        });
        canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault();
            setActive(false);
            showRetry('Reload to restore the globe', () => window.location.reload());
        });
        canvas.addEventListener('webglcontextrestored', () => {
            loading.hidden = true;
            updateTime();
            setActive(!popover.hidden && !document.hidden);
        });
        return {
            setActive,
            updateSun(position) { sun.fromArray(geoVector(position.lat, position.lng)); }
        };
    }

    function updateTime() {
        globe?.updateSun(sunPosition(new Date()));
    }

    function showRetry(label, retryAction) {
        loading.hidden = false;
        loading.dataset.error = '';
        loading.setAttribute('aria-label', label);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '↻';
        retry.setAttribute('aria-label', label);
        retry.addEventListener('click', retryAction);
        loading.replaceChildren(retry);
    }

    async function initialize() {
        if (globe) return;
        if (initializing) return initializing;
        loading.hidden = false;
        loading.replaceChildren();
        delete loading.dataset.error;
        loading.setAttribute('aria-label', 'Loading globe');
        initializing = (async () => {
            try {
                await Promise.all([loadScript('vendor/three.min.js'), loadScript('countries.js')]);
                globe = createGlobe();
                updateTime();
                loading.hidden = true;
                globe.setActive(!popover.hidden && !document.hidden);
                if (!popover.hidden && document.activeElement === trigger) container.querySelector('canvas').focus({ preventScroll: true });
            } catch (error) {
                console.warn('Travel globe could not start:', error);
                showRetry('Globe unavailable. Retry loading the globe.', initialize);
            } finally {
                initializing = null;
            }
        })();
        return initializing;
    }

    function positionPopover() {
        if (popover.hidden) return;
        const anchor = trigger.getBoundingClientRect();
        if (anchor.bottom < 0 || anchor.top > window.innerHeight) { closePopover(); return; }
        const width = popover.offsetWidth;
        const height = popover.offsetHeight;
        const left = Math.max(12, Math.min(window.innerWidth - width - 12, anchor.left + anchor.width / 2 - width / 2));
        const above = anchor.top - height - 12;
        const top = above >= 12 ? above : Math.max(12, Math.min(window.innerHeight - height - 12, anchor.bottom + 12));
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    function closePopover(restoreFocus = false) {
        if (popover.hidden) return;
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        clearInterval(timer);
        globe?.setActive(false);
        if (restoreFocus) trigger.focus({ preventScroll: true });
    }

    trigger.addEventListener('click', () => {
        if (!popover.hidden) { closePopover(true); return; }
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        positionPopover();
        updateTime();
        clearInterval(timer);
        timer = setInterval(updateTime, 30000);
        if (globe) {
            globe.setActive(!document.hidden);
            container.querySelector('canvas').focus({ preventScroll: true });
        } else initialize();
    });
    document.addEventListener('click', event => {
        if (!popover.contains(event.target) && !trigger.contains(event.target)) closePopover();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !popover.hidden) { event.preventDefault(); closePopover(true); }
    });
    document.addEventListener('focusin', event => {
        if (!popover.contains(event.target) && event.target !== trigger) closePopover();
    });
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => {
        globe?.setActive(!popover.hidden && !document.hidden);
        clearInterval(timer);
        if (!popover.hidden && !document.hidden) {
            updateTime();
            timer = setInterval(updateTime, 30000);
        }
    });
})();
