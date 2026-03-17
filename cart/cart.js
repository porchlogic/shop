// Cart data is stored in sessionStorage
const CART_STORAGE_KEY = 'porchlogic_cart';
const LIVE_OPTION_ENABLED = false;

// ---------- helpers: storage ----------

function getCartItems() {
    const raw = sessionStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
}

function saveCartItems(items) {
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items || []));
}

function clearCart() {
    // Empties storage and refreshes any cart UI currently rendered
    saveCartItems([]);
    updateCartIconCount();

    if (document.getElementById('cart-items-container')) {
        renderCartItems();
    }

    if (document.getElementById('checkout-summary-items')) {
        renderCheckoutSummary();
    }
}

function ensureItemUid(item) {
    if (!item.uid) {
        item.uid =
            'ci_' +
            Date.now().toString(36) +
            Math.random().toString(36).slice(2, 8);
    }
    return item.uid;
}

function cloneGlyphData(data) {
    return data === null || data === undefined ? null : JSON.parse(JSON.stringify(data));
}

function normalizeCartItems() {
    const items = getCartItems();
    let mutated = false;

    items.forEach((item) => {
        if (!item.uid) {
            ensureItemUid(item);
            mutated = true;
        }
        if (item.customGlyphEnabled === undefined) {
            item.customGlyphEnabled = false;
            mutated = true;
        }
        if (item.glyphData === undefined) {
            item.glyphData = null;
            mutated = true;
        }
        if (item.customGlyphImage === undefined) {
            item.customGlyphImage = null;
            mutated = true;
        }
        if (item.showOnLive === undefined) {
            item.showOnLive = false;
            mutated = true;
        }
        if (item.material === undefined) {
            item.material = null;
            mutated = true;
        }
        if (item.color === undefined) {
            item.color = null;
            mutated = true;
        }
        if (item.plateColor === undefined) {
            item.plateColor = null;
            mutated = true;
        }
        if (item.backpackColor === undefined) {
            item.backpackColor = null;
            mutated = true;
        }
        if (item.batterySize === undefined) {
            item.batterySize = null;
            mutated = true;
        }
        if (item.batteryModel === undefined) {
            item.batteryModel = null;
            mutated = true;
        }
        if (item.batteryModelLabel === undefined) {
            item.batteryModelLabel = null;
            mutated = true;
        }
    });

    if (mutated) saveCartItems(items);
    return items;
}

function calculateTotals(items, shippingAmount = 0) {
    const subtotal = (items || getCartItems()).reduce((sum, item) => {
        const price = Number(item.price || 0);
        const qty = Number(item.quantity || 0);
        return sum + price * qty;
    }, 0);
    const shipping = Number.isFinite(Number(shippingAmount))
        ? Number(shippingAmount)
        : 0;
    return { subtotal, shipping, total: subtotal + shipping };
}

function formatMoney(amount) {
    return `$${amount.toFixed(2)}`;
}

function isGlyphProductId(id) {
    return id === 'm8_plate_1' || id === 'm8_kit_1';
}

// ---------- glyph editor + preview ----------

const moundGridInstances = new Map(); // uid -> { getData, setData }
const pipeGridInstances = new Map(); // uid -> { getData, setData }
let activeGlyphUid = null;
let glyphAudioContext = null;
const GLYPH_STYLE_TAG_ID = 'glyph-editor-styles';

function ensureGlyphEditorStyles() {
    if (document.getElementById(GLYPH_STYLE_TAG_ID)) return;
    const style = document.createElement('style');
    style.id = GLYPH_STYLE_TAG_ID;
    style.textContent = `
.glyph-mode-wrapper {
    text-align: center;
    margin-top: 0.4rem;
    display: inline-flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
}

.glyph-mode-btn,
.glyph-sound-toggle {
    padding: 0.5rem 0.8rem;
    cursor: pointer;
    border-radius: 999px;
    border: 1px solid #313945;
    background: #0f141b;
    color: #f4f6fb;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    font: inherit;
}

.glyph-mode-btn.active {
    background: #1b222c;
    border-color: var(--accent, #ff9a2c);
    transform: translateY(-1px);
}

.glyph-icon {
    display: block;
    width: 32px;
    height: 16px;
    position: relative;
}

.glyph-icon-flat::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    border-bottom: 2px solid currentColor;
    border-radius: 999px;
}

.glyph-icon-mound::before {
    content: "";
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: 0;
    height: 100%;
    border: 2px solid currentColor;
    border-bottom: none;
    border-radius: 999px 999px 0 0;
}

.glyph-icon-label {
    font-size: 0.8rem;
    color: #c6ced9;
}

.glyph-sound-toggle[aria-pressed="false"] {
    opacity: 0.6;
}

.glyph-sound-toggle .glyph-sound-dot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: var(--accent, #ff9a2c);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);
}

.glyph-sound-toggle[aria-pressed="false"] .glyph-sound-dot {
    background: #5a6473;
    box-shadow: none;
}
    `;
    document.head.appendChild(style);
}

function getGlyphAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!glyphAudioContext) {
        glyphAudioContext = new AudioCtx();
    }
    if (glyphAudioContext.state === 'suspended') {
        glyphAudioContext.resume();
    }
    return glyphAudioContext;
}

function createMoundGrid(canvas, controls, initialData, onChange) {
    const ROWS = 8;
    const COLS = 16;

    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    let moundData = Array.from({ length: ROWS }, () =>
        Array.from({ length: COLS }, () => 0)
    );

    if (Array.isArray(initialData) && initialData.length === ROWS) {
        moundData = JSON.parse(JSON.stringify(initialData));
    }

    const ctx = canvas.getContext('2d');

    let isDragging = false;
    let dragButton = 0; // 0 = left, 2 = right
    let changedThisDrag = new Set();
    let mode = 'mound'; // 'mound' or 'flat'
    let soundEnabled = true;

    const flatBtn = controls?.flatBtn || null;
    const moundBtn = controls?.moundBtn || null;
    const soundToggleBtn = controls?.soundToggle || null;

    function setMode(newMode) {
        mode = newMode;
        if (flatBtn) flatBtn.classList.toggle('active', mode === 'flat');
        if (moundBtn) moundBtn.classList.toggle('active', mode === 'mound');
    }

    if (flatBtn) flatBtn.addEventListener('click', () => setMode('flat'));
    if (moundBtn) moundBtn.addEventListener('click', () => setMode('mound'));

    function setSoundEnabled(enabled) {
        soundEnabled = enabled;
        if (soundToggleBtn) {
            soundToggleBtn.setAttribute('aria-pressed', String(soundEnabled));
            const labelEl = soundToggleBtn.querySelector('.glyph-icon-label');
            if (labelEl) labelEl.textContent = soundEnabled ? 'Sound on' : 'Sound off';
        }
    }

    if (soundToggleBtn) {
        soundToggleBtn.addEventListener('click', () => {
            setSoundEnabled(!soundEnabled);
            if (soundEnabled) {
                getGlyphAudioContext();
            }
        });
        setSoundEnabled(soundEnabled);
    }

    setMode('mound');

    function getHitInfo(x, y) {
        const colWidth = WIDTH / COLS;
        const rowHeight = HEIGHT / ROWS;

        const col = Math.floor(x / colWidth);
        const row = Math.floor(y / rowHeight);

        if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
        return { row, col };
    }

    function playBumpSound() {
        if (!soundEnabled) return;
        const ctx = getGlyphAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';

        const baseFreq = 170 + Math.random() * 90;
        const endFreq = baseFreq * (0.45 + Math.random() * 0.12);
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.1);

        const gain = ctx.createGain();
        const peak = 0.2 + Math.random() * 0.08;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.16);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900 + Math.random() * 500, now);
        filter.Q.setValueAtTime(0.9 + Math.random() * 0.6, now);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.2);
    }

    function applyAction(row, col, button) {
        const key = `${row}:${col}`;
        if (changedThisDrag.has(key)) return;

        let value;
        if (button === 2) {
            value = 0;
        } else {
            value = mode === 'mound' ? 1 : 0;
        }

        const currentValue = moundData[row][col];
        changedThisDrag.add(key);
        if (currentValue === value) return;

        moundData[row][col] = value;
        draw();
        playBumpSound();

        if (typeof onChange === 'function') {
            onChange(JSON.parse(JSON.stringify(moundData)));
        }
    }

    function draw() {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        ctx.lineWidth = 9;
        ctx.strokeStyle = '#cdd5e3';

        const colWidth = WIDTH / COLS;
        const rowHeight = HEIGHT / ROWS;

        for (let r = 0; r < ROWS; r++) {
            const baseY = r * rowHeight + rowHeight / 2;

            ctx.beginPath();

            for (let c = 0; c < COLS; c++) {
                const h = moundData[r][c];
                const hNext = c < COLS - 1 ? moundData[r][c + 1] : null;

                const x0 = c * colWidth;
                const x1 = x0 + colWidth;
                const midX = (x0 + x1) / 2;

                const yPeak = baseY - h * (rowHeight * 0.35);

                if (c === 0) ctx.moveTo(x0, baseY);

                if (h === 1 && hNext === 1) {
                    ctx.lineTo(x1, yPeak);
                    continue;
                }

                if (h === 1) {
                    ctx.lineTo(midX, yPeak);
                    ctx.lineTo(x1, baseY);
                }

                if (h === 0) {
                    ctx.lineTo(x1, baseY);
                }
            }

            ctx.stroke();
        }
    }

    function getCanvasCoords(evt) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (evt.clientX - rect.left) * (canvas.width / rect.width),
            y: (evt.clientY - rect.top) * (canvas.height / rect.height),
        };
    }

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function beginDrag(button, clientX, clientY) {
        isDragging = true;
        dragButton = button;
        changedThisDrag.clear();
        const { x, y } = getCanvasCoords({ clientX, clientY });
        const hit = getHitInfo(x, y);
        if (hit) applyAction(hit.row, hit.col, dragButton);
    }

    function continueDrag(clientX, clientY) {
        if (!isDragging) return;
        const { x, y } = getCanvasCoords({ clientX, clientY });
        const hit = getHitInfo(x, y);
        if (hit) applyAction(hit.row, hit.col, dragButton);
    }

    function endDrag() {
        isDragging = false;
        changedThisDrag.clear();
    }

    canvas.addEventListener('mousedown', (evt) => {
        if (evt.button !== 0 && evt.button !== 2) return;
        beginDrag(evt.button, evt.clientX, evt.clientY);
    });

    canvas.addEventListener('mousemove', (evt) => {
        continueDrag(evt.clientX, evt.clientY);
    });

    canvas.addEventListener('mouseup', endDrag);
    document.addEventListener('mouseup', endDrag);

    // Touch support for mobile
    canvas.addEventListener(
        'touchstart',
        (evt) => {
            const touch = evt.touches && evt.touches[0];
            if (!touch) return;
            evt.preventDefault();
            beginDrag(0, touch.clientX, touch.clientY);
        },
        { passive: false }
    );

    canvas.addEventListener(
        'touchmove',
        (evt) => {
            const touch = evt.touches && evt.touches[0];
            if (!touch) return;
            evt.preventDefault();
            continueDrag(touch.clientX, touch.clientY);
        },
        { passive: false }
    );

    canvas.addEventListener(
        'touchend',
        () => {
            endDrag();
        },
        { passive: true }
    );

    draw();

    return {
        getData: () => JSON.parse(JSON.stringify(moundData)),
        setData: (d) => {
            moundData = JSON.parse(JSON.stringify(d));
            draw();
        },
    };
}

function isPipeGlyphData(data) {
    return (
        data &&
        typeof data === 'object' &&
        data.type === 'pipe' &&
        Array.isArray(data.data)
    );
}

function computePipeSegments(width, height) {
    const safeWidth = Number(width);
    const safeHeight = Number(height);
    if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight) || safeWidth <= 0) {
        return 10;
    }
    return Math.max(4, Math.round((safeHeight * 8) / safeWidth));
}

function normalizePipeGlyphData(incoming, segments, meta = {}) {
    const COLS = 8;
    const ROWS = Math.max(2, Math.floor(segments || 0));
    const data = Array.from({ length: COLS }, () =>
        Array.from({ length: ROWS }, () => 0)
    );

    if (isPipeGlyphData(incoming)) {
        const incomingData = incoming.data;
        for (let c = 0; c < Math.min(COLS, incomingData.length); c++) {
            const col = incomingData[c];
            if (!Array.isArray(col)) continue;
            for (let r = 0; r < Math.min(ROWS, col.length); r++) {
                data[c][r] = col[r] ? 1 : 0;
            }
        }
    }

    return {
        type: 'pipe',
        columns: COLS,
        segments: ROWS,
        data,
        width: meta.width ?? (incoming && incoming.width) ?? null,
        height: meta.height ?? (incoming && incoming.height) ?? null,
    };
}

function createPipeGrid(canvas, controls, initialData, segments, meta, onChange) {
    const COLS = 8;
    const ROWS = Math.max(2, Math.floor(segments || 0));

    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    let pipeData = normalizePipeGlyphData(initialData, ROWS, meta);

    const ctx = canvas.getContext('2d');

    let isDragging = false;
    let dragButton = 0;
    let changedThisDrag = new Set();
    let mode = 'shrink';
    let soundEnabled = true;

    const flatBtn = controls?.flatBtn || null;
    const moundBtn = controls?.moundBtn || null;
    const soundToggleBtn = controls?.soundToggle || null;

    function setMode(newMode) {
        mode = newMode;
        if (flatBtn) flatBtn.classList.toggle('active', mode === 'flat');
        if (moundBtn) moundBtn.classList.toggle('active', mode === 'shrink');
    }

    if (flatBtn) flatBtn.addEventListener('click', () => setMode('flat'));
    if (moundBtn) moundBtn.addEventListener('click', () => setMode('bulge'));

    function setSoundEnabled(enabled) {
        soundEnabled = enabled;
        if (soundToggleBtn) {
            soundToggleBtn.setAttribute('aria-pressed', String(soundEnabled));
            const labelEl = soundToggleBtn.querySelector('.glyph-icon-label');
            if (labelEl) labelEl.textContent = soundEnabled ? 'Sound on' : 'Sound off';
        }
    }

    if (soundToggleBtn) {
        soundToggleBtn.addEventListener('click', () => {
            setSoundEnabled(!soundEnabled);
            if (soundEnabled) {
                getGlyphAudioContext();
            }
        });
        setSoundEnabled(soundEnabled);
    }

    setMode('shrink');

    function getHitInfo(x, y) {
        const colWidth = WIDTH / COLS;
        const rowHeight = HEIGHT / ROWS;

        const col = Math.floor(x / colWidth);
        const row = Math.floor(y / rowHeight);

        if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
        return { row, col };
    }

    function applyAction(row, col, button) {
        const key = `${row}:${col}`;
        if (changedThisDrag.has(key)) return;

        let value;
        if (button === 2) {
            value = 0;
        } else {
            value = mode === 'shrink' ? 1 : 0;
        }

        const currentValue = pipeData.data[col][row];
        changedThisDrag.add(key);
        if (currentValue === value) return;

        pipeData.data[col][row] = value;
        draw();
        if (soundEnabled) {
            const ctx = getGlyphAudioContext();
            if (ctx) playPipeSound(ctx);
        }

        if (typeof onChange === 'function') {
            onChange(JSON.parse(JSON.stringify(pipeData)));
        }
    }

    function playPipeSound(ctx) {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';

        const baseFreq = 140 + Math.random() * 70;
        const endFreq = baseFreq * (0.4 + Math.random() * 0.12);
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.12);

        const gain = ctx.createGain();
        const peak = 0.2 + Math.random() * 0.06;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.2);
    }

    function drawPipe(ctx, centerX, rowHeight, colWidth, colData) {
        const baseHalf = colWidth * 0.42;
        const shrinkAmount = colWidth * 0.18;
        const minHalf = colWidth * 0.18;

        ctx.beginPath();
        for (let r = 0; r < ROWS; r++) {
            const shrunk = colData[r] === 1;
            const half = Math.max(baseHalf - (shrunk ? shrinkAmount : 0), minHalf);
            const y = r * rowHeight + rowHeight / 2;
            const x = centerX - half;
            if (r === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let r = 0; r < ROWS; r++) {
            const shrunk = colData[r] === 1;
            const half = Math.max(baseHalf - (shrunk ? shrinkAmount : 0), minHalf);
            const y = r * rowHeight + rowHeight / 2;
            const x = centerX + half;
            if (r === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function draw() {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#cdd5e3';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const colWidth = WIDTH / COLS;
        const rowHeight = HEIGHT / ROWS;

        for (let c = 0; c < COLS; c++) {
            const centerX = c * colWidth + colWidth / 2;
            drawPipe(ctx, centerX, rowHeight, colWidth, pipeData.data[c]);
        }
    }

    function getCanvasCoords(evt) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (evt.clientX - rect.left) * (canvas.width / rect.width),
            y: (evt.clientY - rect.top) * (canvas.height / rect.height),
        };
    }

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function beginDrag(button, clientX, clientY) {
        isDragging = true;
        dragButton = button;
        changedThisDrag.clear();
        const { x, y } = getCanvasCoords({ clientX, clientY });
        const hit = getHitInfo(x, y);
        if (hit) applyAction(hit.row, hit.col, dragButton);
    }

    function continueDrag(clientX, clientY) {
        if (!isDragging) return;
        const { x, y } = getCanvasCoords({ clientX, clientY });
        const hit = getHitInfo(x, y);
        if (hit) applyAction(hit.row, hit.col, dragButton);
    }

    function endDrag() {
        isDragging = false;
        changedThisDrag.clear();
    }

    canvas.addEventListener('mousedown', (evt) => {
        if (evt.button !== 0 && evt.button !== 2) return;
        beginDrag(evt.button, evt.clientX, evt.clientY);
    });

    canvas.addEventListener('mousemove', (evt) => {
        continueDrag(evt.clientX, evt.clientY);
    });

    canvas.addEventListener('mouseup', endDrag);
    document.addEventListener('mouseup', endDrag);

    canvas.addEventListener(
        'touchstart',
        (evt) => {
            const touch = evt.touches && evt.touches[0];
            if (!touch) return;
            evt.preventDefault();
            beginDrag(0, touch.clientX, touch.clientY);
        },
        { passive: false }
    );

    canvas.addEventListener(
        'touchmove',
        (evt) => {
            const touch = evt.touches && evt.touches[0];
            if (!touch) return;
            evt.preventDefault();
            continueDrag(touch.clientX, touch.clientY);
        },
        { passive: false }
    );

    canvas.addEventListener(
        'touchend',
        () => {
            endDrag();
        },
        { passive: true }
    );

    draw();

    return {
        getData: () => JSON.parse(JSON.stringify(pipeData)),
        setData: (d) => {
            pipeData = normalizePipeGlyphData(d, ROWS, meta);
            draw();
        },
    };
}

function attachMoundGrid(uid, editorEl, existingData, options = {}) {
    ensureGlyphEditorStyles();
    editorEl.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    canvas.style.border = '1px solid #313945';
    canvas.style.width = '100%';
    canvas.style.maxWidth = '640px';
    canvas.style.display = 'block';
    canvas.style.margin = 'auto';

    const controlsWrapper = document.createElement('div');
    controlsWrapper.className = 'glyph-mode-wrapper';

    const flatBtn = document.createElement('button');
    flatBtn.type = 'button';
    flatBtn.className = 'glyph-mode-btn';
    flatBtn.title = 'Flat line';
    flatBtn.innerHTML = '<span class="glyph-icon glyph-icon-flat"></span><span class="glyph-icon-label">Flat</span>';

    const moundBtn = document.createElement('button');
    moundBtn.type = 'button';
    moundBtn.className = 'glyph-mode-btn';
    moundBtn.title = 'Mound';
    moundBtn.innerHTML = '<span class="glyph-icon glyph-icon-mound"></span><span class="glyph-icon-label">Mound</span>';

    controlsWrapper.appendChild(flatBtn);
    controlsWrapper.appendChild(moundBtn);

    editorEl.appendChild(canvas);
    editorEl.appendChild(controlsWrapper);

    const soundToggle = document.createElement('button');
    soundToggle.type = 'button';
    soundToggle.className = 'glyph-sound-toggle';
    soundToggle.setAttribute('aria-pressed', 'true');
    soundToggle.title = 'Toggle sculpt sound';
    soundToggle.innerHTML =
        '<span class="glyph-sound-dot" aria-hidden="true"></span><span class="glyph-icon-label">Sound on</span>';
    controlsWrapper.appendChild(soundToggle);

    const instance = createMoundGrid(
        canvas,
        { flatBtn, moundBtn, soundToggle },
        existingData,
        (data) => {
            const glyphCopy = JSON.parse(JSON.stringify(data));

            if (typeof options.onDataChange === 'function') {
                options.onDataChange(glyphCopy);
            } else {
                const items = getCartItems();
                const it = items.find((i) => i.uid === uid);
                if (!it) return;
                it.glyphData = glyphCopy;
                saveCartItems(items);
            }

            if (typeof options.onThumbnailUpdate === 'function') {
                options.onThumbnailUpdate(glyphCopy);
            } else {
                updateGlyphThumbnail(uid, glyphCopy);
            }
        }
    );

    moundGridInstances.set(uid, instance);
}

function attachPipeGrid(uid, editorEl, existingData, options = {}) {
    ensureGlyphEditorStyles();
    editorEl.innerHTML = '';

    const width = Number(options.width) || 90;
    const height = Number(options.height) || 120;
    const segments = computePipeSegments(width, height);
    const ratio = height / width;
    const baseSize = 640;
    let canvasHeight = Math.round(baseSize * ratio);
    canvasHeight = Math.max(360, Math.min(900, canvasHeight));

    const canvas = document.createElement('canvas');
    canvas.width = baseSize;
    canvas.height = canvasHeight;
    canvas.style.border = '1px solid #313945';
    canvas.style.width = '100%';
    canvas.style.maxWidth = '640px';
    canvas.style.display = 'block';
    canvas.style.margin = 'auto';

    const controlsWrapper = document.createElement('div');
    controlsWrapper.className = 'glyph-mode-wrapper';

    const flatBtn = document.createElement('button');
    flatBtn.type = 'button';
    flatBtn.className = 'glyph-mode-btn';
    flatBtn.title = 'Flat pipe';
    flatBtn.innerHTML = '<span class="glyph-icon glyph-icon-flat"></span><span class="glyph-icon-label">Flat</span>';

    const moundBtn = document.createElement('button');
    moundBtn.type = 'button';
    moundBtn.className = 'glyph-mode-btn';
    moundBtn.title = 'Shrink';
    moundBtn.innerHTML = '<span class="glyph-icon glyph-icon-mound"></span><span class="glyph-icon-label">Shrink</span>';

    controlsWrapper.appendChild(flatBtn);
    controlsWrapper.appendChild(moundBtn);

    editorEl.appendChild(canvas);
    editorEl.appendChild(controlsWrapper);

    const soundToggle = document.createElement('button');
    soundToggle.type = 'button';
    soundToggle.className = 'glyph-sound-toggle';
    soundToggle.setAttribute('aria-pressed', 'true');
    soundToggle.title = 'Toggle sculpt sound';
    soundToggle.innerHTML =
        '<span class="glyph-sound-dot" aria-hidden="true"></span><span class="glyph-icon-label">Sound on</span>';
    controlsWrapper.appendChild(soundToggle);

    const instance = createPipeGrid(
        canvas,
        { flatBtn, moundBtn, soundToggle },
        existingData,
        segments,
        { width, height },
        (data) => {
            const glyphCopy = JSON.parse(JSON.stringify(data));

            if (typeof options.onDataChange === 'function') {
                options.onDataChange(glyphCopy);
            } else {
                const items = getCartItems();
                const it = items.find((i) => i.uid === uid);
                if (!it) return;
                it.glyphData = glyphCopy;
                saveCartItems(items);
            }

            if (typeof options.onThumbnailUpdate === 'function') {
                options.onThumbnailUpdate(glyphCopy);
            } else {
                updateGlyphThumbnail(uid, glyphCopy);
            }
        }
    );

    pipeGridInstances.set(uid, instance);
}

function renderGlyphThumbnail(canvas, glyphData) {
    if (isPipeGlyphData(glyphData)) {
        renderPipeGlyphThumbnail(canvas, glyphData);
        return;
    }

    const ROWS = 8;
    const COLS = 16;

    let data = Array.from({ length: ROWS }, () =>
        Array.from({ length: COLS }, () => 0)
    );

    if (
        Array.isArray(glyphData) &&
        glyphData.length === ROWS &&
        glyphData.every((row) => Array.isArray(row) && row.length === COLS)
    ) {
        data = glyphData;
    }

    const ctx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#bfc7d5';

    const colWidth = WIDTH / COLS;
    const rowHeight = HEIGHT / ROWS;

    for (let r = 0; r < ROWS; r++) {
        const baseY = r * rowHeight + rowHeight / 2;

        ctx.beginPath();

        for (let c = 0; c < COLS; c++) {
            const h = data[r][c];
            const hNext = c < COLS - 1 ? data[r][c + 1] : null;

            const x0 = c * colWidth;
            const x1 = x0 + colWidth;
            const midX = (x0 + x1) / 2;

            const yPeak = baseY - h * (rowHeight * 0.35);

            if (c === 0) ctx.moveTo(x0, baseY);

            if (h === 1 && hNext === 1) {
                ctx.lineTo(x1, yPeak);
                continue;
            }

            if (h === 1) {
                ctx.lineTo(midX, yPeak);
                ctx.lineTo(x1, baseY);
            }

            if (h === 0) {
                ctx.lineTo(x1, baseY);
            }
        }

        ctx.stroke();
    }
}

function renderPipeGlyphThumbnail(canvas, glyphData) {
    const COLS = 8;
    const data = isPipeGlyphData(glyphData)
        ? glyphData.data
        : Array.from({ length: COLS }, () => []);
    const ROWS = Array.isArray(data[0]) ? data[0].length : 0;

    const ctx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#bfc7d5';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const colWidth = WIDTH / COLS;
    const rowHeight = ROWS > 0 ? HEIGHT / ROWS : HEIGHT;
    const baseHalf = colWidth * 0.42;
    const shrinkAmount = colWidth * 0.18;
    const minHalf = colWidth * 0.18;

    for (let c = 0; c < COLS; c++) {
        const centerX = c * colWidth + colWidth / 2;
        ctx.beginPath();
        for (let r = 0; r < ROWS; r++) {
            const shrunk = data[c] && data[c][r] === 1;
            const half = Math.max(baseHalf - (shrunk ? shrinkAmount : 0), minHalf);
            const y = r * rowHeight + rowHeight / 2;
            const x = centerX - half;
            if (r === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.beginPath();
        for (let r = 0; r < ROWS; r++) {
            const shrunk = data[c] && data[c][r] === 1;
            const half = Math.max(baseHalf - (shrunk ? shrinkAmount : 0), minHalf);
            const y = r * rowHeight + rowHeight / 2;
            const x = centerX + half;
            if (r === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

function updateGlyphThumbnail(uid, glyphData) {
    const canvas = document.querySelector(
        `.glyph-icon-canvas[data-item-uid="${uid}"]`
    );
    if (!canvas) return;
    renderGlyphThumbnail(canvas, glyphData);
}

// ---------- cart manipulation ----------

function addItemToCart(item) {
    const cartItems = normalizeCartItems();
    const incomingGlyphData =
        item && item.glyphData !== undefined ? cloneGlyphData(item.glyphData) : null;
    const incomingCustomGlyphImage = item.customGlyphImage || null;
    const incomingCustomGlyphEnabled = !!item.customGlyphEnabled;
    const incomingShowOnLive = !!item.showOnLive;
    const incomingMaterial = item.material || null;
    const incomingColor = item.color || null;
    const incomingPlateColor = item.plateColor || null;
    const incomingBackpackColor = item.backpackColor || null;
    const incomingBatterySize = item.batterySize || null;
    const incomingBatteryModel = item.batteryModel || null;
    const incomingBatteryModelLabel = item.batteryModelLabel || null;

    if (isGlyphProductId(item.id)) {
        const qty = Math.max(1, Math.floor(item.quantity || 1));
        for (let i = 0; i < qty; i++) {
            const lineItem = {
                ...item,
                quantity: 1,
                customGlyphEnabled: incomingCustomGlyphEnabled,
                glyphData: incomingGlyphData,
                customGlyphImage: incomingCustomGlyphImage,
                showOnLive: incomingShowOnLive,
                material: incomingMaterial,
                color: incomingColor,
                plateColor: incomingPlateColor,
                backpackColor: incomingBackpackColor,
                batterySize: incomingBatterySize,
                batteryModel: incomingBatteryModel,
                batteryModelLabel: incomingBatteryModelLabel,
            };
            ensureItemUid(lineItem);
            cartItems.push(lineItem);
        }
    } else {
        const existingItemIndex = cartItems.findIndex(
            (cartItem) => cartItem.id === item.id
        );
        if (existingItemIndex > -1) {
            const existing = cartItems[existingItemIndex];
            existing.quantity += item.quantity || 1;
            existing.customGlyphEnabled = incomingCustomGlyphEnabled;
            existing.glyphData = incomingGlyphData;
            existing.customGlyphImage = incomingCustomGlyphImage;
            existing.showOnLive = incomingShowOnLive;
            existing.material = incomingMaterial;
            existing.color = incomingColor;
            existing.plateColor = incomingPlateColor;
            existing.backpackColor = incomingBackpackColor;
            existing.batterySize = incomingBatterySize;
            existing.batteryModel = incomingBatteryModel;
            existing.batteryModelLabel = incomingBatteryModelLabel;
        } else {
            const lineItem = {
                ...item,
                quantity: item.quantity || 1,
                customGlyphEnabled: incomingCustomGlyphEnabled,
                glyphData: incomingGlyphData,
                customGlyphImage: incomingCustomGlyphImage,
                showOnLive: incomingShowOnLive,
                material: incomingMaterial,
                color: incomingColor,
                plateColor: incomingPlateColor,
                backpackColor: incomingBackpackColor,
                batterySize: incomingBatterySize,
                batteryModel: incomingBatteryModel,
                batteryModelLabel: incomingBatteryModelLabel,
            };
            ensureItemUid(lineItem);
            cartItems.push(lineItem);
        }
    }

    saveCartItems(cartItems);
    updateCartIconCount();

    if (document.getElementById('cart-items-container')) {
        renderCartItems();
    }
    if (document.getElementById('checkout-summary-items')) {
        renderCheckoutSummary();
    }
}

function removeItemFromCart(itemKey) {
    let cartItems = normalizeCartItems();

    cartItems = cartItems.filter((item) => {
        const uid = item.uid || item.id;
        return uid !== itemKey;
    });

    saveCartItems(cartItems);
    updateCartIconCount();

    if (document.getElementById('cart-items-container')) {
        renderCartItems();
    }
    if (document.getElementById('checkout-summary-items')) {
        renderCheckoutSummary();
    }
}

function updateCartIconCount() {
    const cartItems = normalizeCartItems();
    const totalItems = cartItems.reduce((count, item) => count + (item.quantity || 0), 0);
    const countEls = document.querySelectorAll('[data-cart-count], .cart-count');
    countEls.forEach((el) => {
        el.textContent = totalItems;
    });
}

function updateTotalsUI(items, shippingAmount) {
    const shippingValue =
        typeof shippingAmount === 'number'
            ? shippingAmount
            : Number(window?.CHECKOUT_SHIPPING_AMOUNT || 0);

    const { subtotal, shipping, total } = calculateTotals(
        items || getCartItems(),
        shippingValue
    );
    const subtotalEls = document.querySelectorAll('[data-cart-subtotal]');
    subtotalEls.forEach((el) => (el.textContent = formatMoney(subtotal)));

    const shippingEls = document.querySelectorAll('[data-cart-shipping]');
    shippingEls.forEach((el) => (el.textContent = formatMoney(shipping)));

    const totalEls = document.querySelectorAll('[data-cart-total], #cart-total');
    totalEls.forEach((el) => (el.textContent = formatMoney(total)));
}

function updateCheckoutButtonState(items) {
    const cartItems = items || getCartItems();
    const hasItems = cartItems.length > 0;

    const checkoutBtn = document.getElementById('go-to-checkout');
    if (checkoutBtn) {
        checkoutBtn.disabled = !hasItems;
        checkoutBtn.classList.toggle('is-disabled', !hasItems);
    }

    const submitBtn = document.getElementById('submit');
    if (submitBtn && !submitBtn.dataset.locked) {
        submitBtn.disabled = !hasItems;
        submitBtn.classList.toggle('is-disabled', !hasItems);
    }
}

function buildItemSubtitle(item) {
    const parts = [];
    if (item.material) parts.push(item.material);
    if (item.id === 'm8_kit_1') {
        if (item.plateColor) parts.push(`Plate ${item.plateColor}`);
        if (item.backpackColor) parts.push(`Backpack ${item.backpackColor}`);
        const batteryLabel = formatBatterySize(item.batterySize) || item.batteryModelLabel || '';
        if (batteryLabel) parts.push(`Battery ${batteryLabel}`);
    } else {
        if (item.color) parts.push(item.color);
        if (item.id === 'm8_backpack_1') {
            const battery = formatBatterySize(item.batterySize);
                if (battery) {
                    parts.push(`Battery ${battery}`);
                } else if (item.batteryModelLabel) {
                    parts.push(`Battery ${item.batteryModelLabel}`);
                }
            }
        }
    return parts.join(' \u2022 ');
}

function createGlyphControls(item) {
    const uid = item.uid;
    const wrapper = document.createElement('div');
    wrapper.className = 'cart-option-stack';

    const glyphLabel = document.createElement('label');
    glyphLabel.className = 'option-toggle';
    glyphLabel.innerHTML = `
        <input type="checkbox" class="glyph-checkbox" data-item-uid="${uid}">
        <span>Custom glyph</span>
    `;
    wrapper.appendChild(glyphLabel);

    const glyphThumb = document.createElement('button');
    glyphThumb.type = 'button';
    glyphThumb.className = 'glyph-thumb-button hidden';
    glyphThumb.dataset.itemUid = uid;
    glyphThumb.innerHTML = `
        <canvas class="glyph-icon-canvas" width="160" height="80" data-item-uid="${uid}"></canvas>
        <span class="glyph-icon-label">Edit glyph</span>
    `;
    wrapper.appendChild(glyphThumb);

    const liveLabel = document.createElement('label');
    liveLabel.className = 'option-toggle';
    liveLabel.innerHTML = `
        <input type="checkbox" class="live-checkbox" data-item-uid="${uid}">
        <span>Show on live stream</span>
    `;
    if (LIVE_OPTION_ENABLED) {
        wrapper.appendChild(liveLabel);
    }

    const liveInfo = document.createElement('p');
    liveInfo.className = 'live-info';
    liveInfo.textContent =
        'Live overlay placement is added after purchase; we will contact you with setup details.';
    if (LIVE_OPTION_ENABLED) {
        wrapper.appendChild(liveInfo);
    }

    return { wrapper, glyphLabel, glyphThumb, liveLabel, liveInfo };
}

function renderCartItems() {
    const cartItemsContainer = document.getElementById('cart-items-container');
    if (!cartItemsContainer) return;

    const cartNote = document.getElementById('cart-note');

    const cartItems = normalizeCartItems();

    cartItemsContainer.innerHTML = '';

    if (cartItems.length === 0) {
        cartItemsContainer.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
        if (cartNote) {
            cartNote.classList.add('hidden');
        }
        updateTotalsUI(cartItems);
        updateCheckoutButtonState(cartItems);
        return;
    }

    if (cartNote) {
        cartNote.classList.remove('hidden');
    }

    cartItems.forEach((item) => {
        const uid = ensureItemUid(item);
        const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);

        const row = document.createElement('div');
        row.className = 'cart-row';
        row.setAttribute('data-cart-item-uid', uid);
        row.setAttribute('data-cart-item-id', item.id);

        const itemCell = document.createElement('div');
        itemCell.className = 'cart-cell cart-cell--item';
        itemCell.innerHTML = `
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-sub">${buildItemSubtitle(item)}</div>
        `;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'cart-remove';
        removeBtn.type = 'button';
        removeBtn.dataset.itemUid = uid;
        removeBtn.textContent = 'Remove';
        itemCell.appendChild(removeBtn);

        const optionsCell = document.createElement('div');
        optionsCell.className = 'cart-cell cart-cell--options';

        if (isGlyphProductId(item.id)) {
            const { wrapper, glyphThumb, liveInfo } = createGlyphControls(item);
            optionsCell.appendChild(wrapper);

            const glyphCheckbox = wrapper.querySelector('.glyph-checkbox');
            const liveCheckbox = wrapper.querySelector('.live-checkbox');
            const thumbCanvas = glyphThumb.querySelector('.glyph-icon-canvas');

            if (item.customGlyphEnabled) {
                glyphCheckbox.checked = true;
                glyphThumb.classList.remove('hidden');
                if (thumbCanvas) renderGlyphThumbnail(thumbCanvas, item.glyphData);
            }

            if (item.showOnLive && liveCheckbox) {
                liveCheckbox.checked = true;
            }

            if (liveInfo) {
                liveInfo.classList.toggle('hidden', !item.showOnLive);
            }

            glyphCheckbox.addEventListener('change', () => {
                const items = getCartItems();
                const it = items.find((i) => i.uid === uid);
                if (!it) return;

                it.customGlyphEnabled = glyphCheckbox.checked;
                saveCartItems(items);

                if (glyphCheckbox.checked) {
                    glyphThumb.classList.remove('hidden');
                    if (thumbCanvas) renderGlyphThumbnail(thumbCanvas, it.glyphData);
                } else {
                    glyphThumb.classList.add('hidden');
                }
            });

            if (liveCheckbox) {
                liveCheckbox.addEventListener('change', () => {
                    const items = getCartItems();
                    const it = items.find((i) => i.uid === uid);
                    if (!it) return;

                    it.showOnLive = liveCheckbox.checked;
                    saveCartItems(items);

                    if (liveInfo) {
                        liveInfo.classList.toggle('hidden', !liveCheckbox.checked);
                    }
                });
            }

            glyphThumb.addEventListener('click', () => {
                openGlyphModal(uid);
            });
        } else {
            const pill = document.createElement('div');
            pill.className = 'cart-pill cart-pill--muted';
            pill.textContent = 'No options';
            optionsCell.appendChild(pill);
        }

        const qtyCell = document.createElement('div');
        qtyCell.className = 'cart-cell cart-cell--qty';
        qtyCell.innerHTML = `<span class="qty-pill">${item.quantity}</span>`;

        const totalCell = document.createElement('div');
        totalCell.className = 'cart-cell cart-cell--total';
        totalCell.innerHTML = `<span class="price">${formatMoney(lineTotal)}</span>`;

        row.appendChild(itemCell);
        row.appendChild(optionsCell);
        row.appendChild(qtyCell);
        row.appendChild(totalCell);

        cartItemsContainer.appendChild(row);
    });

    cartItemsContainer.querySelectorAll('.cart-remove').forEach((button) => {
        button.addEventListener('click', (event) => {
            const uid = event.currentTarget.dataset.itemUid;
            removeItemFromCart(uid);
        });
    });

    updateTotalsUI(cartItems);
    updateCheckoutButtonState(cartItems);
}

function renderCheckoutSummary() {
    const list = document.getElementById('checkout-summary-items');
    if (!list) return;

    const cartItems = normalizeCartItems();
    list.innerHTML = '';

    if (!cartItems.length) {
        list.innerHTML = '<p class="checkout-empty">Your cart is empty.</p>';
        updateTotalsUI(cartItems);
        updateCheckoutButtonState(cartItems);
        return;
    }

    cartItems.forEach((item) => {
        const uid = ensureItemUid(item);
        const wrapper = document.createElement('div');
        wrapper.className = 'summary-item';
        wrapper.setAttribute('data-cart-item-uid', uid);
        wrapper.setAttribute('data-cart-item-id', item.id);

        const metaParts = [];
        if (item.material) metaParts.push(item.material);
        if (item.id === 'm8_kit_1') {
            if (item.plateColor) metaParts.push(`Plate ${item.plateColor}`);
            if (item.backpackColor) metaParts.push(`Backpack ${item.backpackColor}`);
            const batteryLabel =
                formatBatterySize(item.batterySize) || item.batteryModelLabel || '';
            if (batteryLabel) metaParts.push(`Battery ${batteryLabel}`);
        } else {
            if (item.color) metaParts.push(item.color);
            if (item.id === 'm8_backpack_1') {
                const battery = formatBatterySize(item.batterySize);
                if (battery) {
                    metaParts.push(`Battery ${battery}`);
                } else if (item.batteryModelLabel) {
                    metaParts.push(`Battery ${item.batteryModelLabel}`);
                }
            }
        }
        if (isGlyphProductId(item.id) && item.customGlyphEnabled) {
            metaParts.push('Custom glyph');
        }
        if (isGlyphProductId(item.id) && item.showOnLive) {
            metaParts.push('Live overlay');
        }

        wrapper.innerHTML = `
            <div>
                <div class="summary-item__name">${item.name}</div>
                <div class="summary-item__meta">${metaParts.join(' \u2022 ')}</div>
            </div>
            <div class="summary-item__qty">\u00d7${item.quantity}</div>
            <div class="summary-item__price">${formatMoney(item.price * item.quantity)}</div>
        `;

        list.appendChild(wrapper);
    });

    updateTotalsUI(cartItems);
    updateCheckoutButtonState(cartItems);
}

// ---------- popup helpers ----------

function showCartPopup(message) {
    const cartPopup = document.getElementById('cart-popup');
    const popupMessage = document.getElementById('popup-message');
    if (cartPopup && popupMessage) {
        popupMessage.textContent = message;
        if (typeof cartPopup.showModal === 'function') {
            if (cartPopup.hasAttribute('open')) {
                cartPopup.close();
            }
            cartPopup.showModal();
        } else {
            cartPopup.setAttribute('open', 'open');
        }
    }
}

function hideCartPopup() {
    const cartPopup = document.getElementById('cart-popup');
    if (cartPopup) {
        if (typeof cartPopup.close === 'function') {
            cartPopup.close();
        } else {
            cartPopup.removeAttribute('open');
        }
        cartPopup.classList.remove('visible');
    }
}

function formatBatterySize(size) {
    if (!size || typeof size !== 'object') return '';
    const width = Number(size.width);
    const height = Number(size.height);
    const thickness = Number(size.thickness);
    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(thickness)) {
        return '';
    }
    const format = (value) => {
        const str = String(value);
        return str.endsWith('.0') ? str.slice(0, -2) : str;
    };
    return `${format(width)}x${format(height)}x${format(thickness)}mm`;
}

function isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function copyTextToClipboard(text) {
    if (!text) return false;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(() => {});
        return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        // Swallow copy failures silently.
    }
    document.body.removeChild(textarea);
    return true;
}

// ---------- glyph modal wiring ----------

function openGlyphModal(uid) {
    const modal = document.getElementById('glyph-modal');
    const editorEl = document.getElementById('glyph-modal-editor');
    if (!modal || !editorEl) return;

    const items = normalizeCartItems();
    const item = items.find((i) => i.uid === uid);
    if (!item) return;

    activeGlyphUid = uid;

    modal.classList.remove('hidden');
    modal.classList.add('visible');

    if (item.id === 'm8_backpack_1') {
        const battery = item.batterySize || {};
        attachPipeGrid(uid, editorEl, item.glyphData || null, {
            width: battery.width,
            height: battery.height,
        });
    } else {
        attachMoundGrid(uid, editorEl, item.glyphData || null);
    }
}

function closeGlyphModal() {
    const modal = document.getElementById('glyph-modal');
    const editorEl = document.getElementById('glyph-modal-editor');
    if (!modal || !editorEl) return;

    modal.classList.remove('visible');
    modal.classList.add('hidden');

    editorEl.innerHTML = '';
    activeGlyphUid = null;
}

// ---------- init ----------

document.addEventListener('DOMContentLoaded', () => {
    updateCartIconCount();

    if (document.getElementById('cart-items-container')) {
        renderCartItems();
    }

    if (document.getElementById('checkout-summary-items')) {
        renderCheckoutSummary();
    }

    const glyphModal = document.getElementById('glyph-modal');
    const glyphCloseBtn = document.querySelector('.glyph-modal-close');

    if (glyphModal) {
        glyphModal.addEventListener('click', (event) => {
            if (event.target === glyphModal) {
                closeGlyphModal();
            }
        });
    }

    if (glyphCloseBtn) {
        glyphCloseBtn.addEventListener('click', () => {
            closeGlyphModal();
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeGlyphModal();
        }
        if (event.ctrlKey && event.shiftKey && event.code === 'KeyE') {
            if (isEditableTarget(event.target)) return;
            const glyphModal = document.getElementById('glyph-modal');
            if (!glyphModal || !glyphModal.classList.contains('visible')) return;
            if (!activeGlyphUid) return;
            const items = normalizeCartItems();
            const item = items.find((i) => i.uid === activeGlyphUid);
            if (!item || !item.glyphData) return;
            event.preventDefault();
            copyTextToClipboard(JSON.stringify(item.glyphData));
        }
    });
});
