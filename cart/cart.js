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

// ---------- glyph editor + preview ----------

const moundGridInstances = new Map(); // uid -> { getData, setData }
let activeGlyphUid = null;

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

    const flatBtn = controls?.flatBtn || null;
    const moundBtn = controls?.moundBtn || null;

    function setMode(newMode) {
        mode = newMode;
        if (flatBtn) flatBtn.classList.toggle('active', mode === 'flat');
        if (moundBtn) moundBtn.classList.toggle('active', mode === 'mound');
    }

    if (flatBtn) flatBtn.addEventListener('click', () => setMode('flat'));
    if (moundBtn) moundBtn.addEventListener('click', () => setMode('mound'));

    setMode('mound');

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
        changedThisDrag.add(key);

        let value;
        if (button === 2) {
            value = 0;
        } else {
            value = mode === 'mound' ? 1 : 0;
        }

        moundData[row][col] = value;
        draw();

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

function attachMoundGrid(uid, editorEl, existingData, options = {}) {
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

    const instance = createMoundGrid(
        canvas,
        { flatBtn, moundBtn },
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

function renderGlyphThumbnail(canvas, glyphData) {
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
    const incomingCustomGlyphEnabled = !!item.customGlyphEnabled;
    const incomingShowOnLive = !!item.showOnLive;
    const incomingMaterial = item.material || null;
    const incomingColor = item.color || null;

    if (item.id === 'm8_plate_1') {
        const qty = Math.max(1, Math.floor(item.quantity || 1));
        for (let i = 0; i < qty; i++) {
            const lineItem = {
                ...item,
                quantity: 1,
                customGlyphEnabled: incomingCustomGlyphEnabled,
                glyphData: incomingGlyphData,
                showOnLive: incomingShowOnLive,
                material: incomingMaterial,
                color: incomingColor,
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
            existing.showOnLive = incomingShowOnLive;
            existing.material = incomingMaterial;
            existing.color = incomingColor;
        } else {
            const lineItem = {
                ...item,
                quantity: item.quantity || 1,
                customGlyphEnabled: incomingCustomGlyphEnabled,
                glyphData: incomingGlyphData,
                showOnLive: incomingShowOnLive,
                material: incomingMaterial,
                color: incomingColor,
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
    if (item.color) parts.push(item.color);
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

        if (item.id === 'm8_plate_1') {
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
        if (item.color) metaParts.push(item.color);
        if (item.id === 'm8_plate_1' && item.customGlyphEnabled) {
            metaParts.push('Custom glyph');
        }
        if (item.id === 'm8_plate_1' && item.showOnLive) {
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

    attachMoundGrid(uid, editorEl, item.glyphData || null);
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
    });
});
