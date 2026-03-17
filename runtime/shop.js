/* carousel.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};

    function getProductData() {
        var node = document.getElementById("product-data");
        if (!node) return null;
        try {
            return JSON.parse(node.textContent || "{}");
        } catch (err) {
            return null;
        }
    }

    function toSlideUrls(images, baseUrl) {
        var source = Array.isArray(images) ? images : [];
        var base = String(baseUrl || "");
        return source
            .map(function (src) {
                var value = String(src || "");
                if (!value) return "";
                if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
                    return value;
                }
                return (base + "/" + value).replace(/\/{2,}/g, "/");
            })
            .filter(Boolean);
    }

    function readCurrentSelections() {
        var selections = {};
        var selectedButtons = document.querySelectorAll(
            '.chip[data-attribute][aria-pressed="true"]'
        );
        Array.prototype.forEach.call(selectedButtons, function (btn) {
            if (!btn.dataset || !btn.dataset.attribute) return;
            selections[btn.dataset.attribute] = String(btn.dataset.value || "");
        });

        var selects = document.querySelectorAll("select[data-attribute]");
        Array.prototype.forEach.call(selects, function (select) {
            if (!select.dataset || !select.dataset.attribute) return;
            selections[select.dataset.attribute] = String(select.value || "");
        });

        var toggles = document.querySelectorAll(".toggle[data-attribute]");
        Array.prototype.forEach.call(toggles, function (toggle) {
            if (!toggle.dataset || !toggle.dataset.attribute) return;
            selections[toggle.dataset.attribute] =
                toggle.getAttribute("aria-pressed") === "true" ? "true" : "false";
        });

        return selections;
    }

    function getSelectionValues(selections) {
        var values = {};
        Object.keys(selections || {}).forEach(function (key) {
            values[String(selections[key])] = true;
        });
        return values;
    }

    function resolveImageVariantImages(rules, selections) {
        var list = [];
        if (Array.isArray(rules)) {
            list = rules;
        } else if (rules && typeof rules === "object") {
            list = Object.keys(rules).map(function (key) {
                return rules[key];
            });
        }
        var best = null;
        var bestScore = -1;
        var selectedValues = getSelectionValues(selections);

        list.forEach(function (entry) {
            if (!entry || typeof entry !== "object") return;
            var needs = Array.isArray(entry["for"]) ? entry["for"] : [];
            if (!needs.length) return;
            var images = Array.isArray(entry.images)
                ? entry.images
                : entry.image
                    ? [entry.image]
                    : [];
            if (!images.length) return;
            var matches = needs.every(function (token) {
                return !!selectedValues[String(token)];
            });
            if (!matches) return;
            if (needs.length > bestScore) {
                best = images;
                bestScore = needs.length;
            }
        });
        return best || null;
    }

    PorchLogic.initCarousel = function (root) {
        if (!root) return;
        var track = root.querySelector("[data-carousel-track]");
        var prevBtn = root.querySelector("[data-carousel-prev]");
        var nextBtn = root.querySelector("[data-carousel-next]");
        var dotsContainer = root.querySelector("[data-carousel-dots]");
        var orderLabel = root.querySelector("[data-carousel-order-label]");
        if (!track) return;

        var initialSlides = Array.prototype.slice.call(
            root.querySelectorAll(".pl-carousel__slide img")
        ).map(function (img) {
            return String(img.getAttribute("src") || "");
        }).filter(Boolean);
        if (!initialSlides.length) return;

        var product = getProductData();
        var rules = product && product.image_variants
            ? product.image_variants
            : {};
        var baseUrls = initialSlides.slice();
        var baseFromData = product ? toSlideUrls(product.images, product.images_base_url) : [];
        if (baseFromData.length) {
            baseUrls = baseFromData;
        }

        var currentIndex = 0;
        var slides = [];
        var dots = [];
        var orderSlideCount = 0;

        function buildSlides(urls, orderCount) {
            track.innerHTML = urls
                .map(function (url, idx) {
                    var active = idx === 0 ? " is-active" : "";
                    return (
                        '<div class="pl-carousel__slide' +
                        active +
                        '"><img src="' +
                        url +
                        '" alt=""></div>'
                    );
                })
                .join("");
            slides = Array.prototype.slice.call(
                root.querySelectorAll(".pl-carousel__slide")
            );
            currentIndex = 0;
            orderSlideCount = Number(orderCount || 0);
            buildDots();
            updateUI();
        }

        function buildDots() {
            if (!dotsContainer) return;
            dotsContainer.innerHTML = "";
            dots = slides.map(function (_, index) {
                var btn = document.createElement("button");
                if (index === 0) btn.classList.add("is-active");
                if (index < orderSlideCount) {
                    btn.classList.add("is-order-dot");
                }
                btn.addEventListener("click", function () {
                    goToSlide(index);
                });
                dotsContainer.appendChild(btn);
                return btn;
            });
        }

        function updateUI() {
            track.style.transform =
                "translateX(-" + currentIndex * 100 + "%)";
            slides.forEach(function (slide, idx) {
                slide.classList.toggle("is-active", idx === currentIndex);
            });
            dots.forEach(function (dot, idx) {
                dot.classList.toggle("is-active", idx === currentIndex);
            });
            if (orderLabel) {
                var onOrderSlides = orderSlideCount > 0 && currentIndex < orderSlideCount;
                orderLabel.classList.toggle("hidden", !onOrderSlides);
            }
        }

        function goToSlide(index) {
            var count = slides.length;
            currentIndex = (index + count) % count;
            updateUI();
        }

        function next() {
            goToSlide(currentIndex + 1);
        }

        function prev() {
            goToSlide(currentIndex - 1);
        }

        function applyMyOrderSelection() {
            if (!rules || (Array.isArray(rules) && !rules.length)) return;
            var selected = readCurrentSelections();
            var variantImages = resolveImageVariantImages(rules, selected);
            var variantUrls = variantImages
                ? toSlideUrls(variantImages, product ? product.images_base_url : "")
                : [];
            var combined = variantUrls.length
                ? variantUrls.concat(baseUrls)
                : baseUrls.slice();
            buildSlides(combined, variantUrls.length);
        }

        if (prevBtn) prevBtn.addEventListener("click", prev);
        if (nextBtn) nextBtn.addEventListener("click", next);

        buildSlides(baseUrls, 0);

        var hasRules = Array.isArray(rules)
            ? rules.length > 0
            : !!(rules && typeof rules === "object" && Object.keys(rules).length);
        if (hasRules) {
            var controls = document.querySelectorAll(
                '.chip[data-attribute], select[data-attribute], .toggle[data-attribute], .cargo-size__input[data-attribute]'
            );
            var queued = false;
            var queueApply = function () {
                if (queued) return;
                queued = true;
                requestAnimationFrame(function () {
                    queued = false;
                    applyMyOrderSelection();
                });
            };
            Array.prototype.forEach.call(controls, function (control) {
                var eventName = control.tagName === "SELECT" ? "change" : "input";
                control.addEventListener(eventName, applyMyOrderSelection);
                if (eventName !== "change") {
                    control.addEventListener("change", applyMyOrderSelection);
                }
                if (control.classList.contains("chip")) {
                    control.addEventListener("click", queueApply);
                }
                if (control.classList.contains("toggle")) {
                    control.addEventListener("click", queueApply);
                }
            });
            applyMyOrderSelection();
        }
    };

    global.PorchLogic = PorchLogic;
})(window);

/* cart_page.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatMoney(value) {
        var amount = Number(value || 0);
        if (!Number.isFinite(amount)) return "$0.00";
        var display = amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2);
        return "$" + display;
    }

    function formatAttributeValue(attr) {
        if (!attr || typeof attr !== "object") return "";
        if (attr.type === "fixed") return "";
        if (attr.type === "toggle") return attr.value ? "Yes" : "No";
        if (attr.type === "inquiry") return "";
        if (attr.value === null || attr.value === undefined) return "";
        return String(attr.value);
    }

    function titleCase(value) {
        return String(value || "")
            .replace(/[_-]+/g, " ")
            .trim()
            .replace(/\b\w/g, function (match) {
                return match.toUpperCase();
            });
    }

    function summarizeOptions(item) {
        var lines = [];
        var attrs = item && item.attributes ? item.attributes : null;
        if (attrs && typeof attrs === "object") {
            Object.keys(attrs).forEach(function (key) {
                var value = formatAttributeValue(attrs[key]);
                if (!value) return;
                lines.push(titleCase(key) + ": " + value);
            });
        }
        var bundleItems = item && Array.isArray(item.includes) ? item.includes : item && Array.isArray(item.bundleItems) ? item.bundleItems : [];
        bundleItems.forEach(function (bundleItem) {
            var label = bundleItem && bundleItem.name ? bundleItem.name : bundleItem.product_id || bundleItem.id;
            var bundleAttrs = bundleItem && bundleItem.attributes ? bundleItem.attributes : null;
            if (!bundleAttrs || typeof bundleAttrs !== "object") return;
            if (label) {
                lines.push(label);
            }
            Object.keys(bundleAttrs).forEach(function (key) {
                var value = formatAttributeValue(bundleAttrs[key]);
                if (!value) return;
                lines.push(" - " + titleCase(key) + ": " + value);
            });
        });
        return lines;
    }

    function addOnsTotal(item) {
        var addons = item && item.add_ons ? item.add_ons : null;
        if (!addons || !addons.keycaps) return 0;
        var priceEach = Number(addons.keycaps.price_each || 0);
        var counts = addons.keycaps.counts || {};
        return Object.keys(counts).reduce(function (sum, key) {
            return sum + Number(counts[key] || 0) * priceEach;
        }, 0);
    }

    function updateSummary(subtotal) {
        var nodes = document.querySelectorAll("[data-cart-subtotal]");
        nodes.forEach(function (node) {
            node.textContent = formatMoney(subtotal);
        });
        var totals = document.querySelectorAll("[data-cart-total]");
        totals.forEach(function (node) {
            node.textContent = formatMoney(subtotal);
        });
    }

    function renderGlyphThumbnails(items) {
        if (!PorchLogic.glyph || !PorchLogic.glyph.renderThumbnail) return;
        var canvases = document.querySelectorAll("[data-glyph-index]");
        Array.prototype.forEach.call(canvases, function (canvas) {
            var index = Number(canvas.getAttribute("data-glyph-index"));
            if (!Number.isFinite(index)) return;
            var item = items[index];
            if (!item) return;
            var glyphAttr = item.attributes && item.attributes.custom_glyph ? item.attributes.custom_glyph : null;
            var glyphData = glyphAttr && glyphAttr.data ? glyphAttr.data : item.glyphData;
            if (!glyphData) return;
            var editorType = glyphAttr && glyphAttr.editor ? glyphAttr.editor : null;
            var isBackpackGlyph =
                editorType === "pixel" && item && item.product_id === "m8_backpack_1";
            var pixelOptions =
                editorType === "pixel"
                    ? {
                        rows:
                            (glyphAttr && glyphAttr.full_length) || isBackpackGlyph
                                ? 32
                                : 16,
                        cols: 16,
                    }
                    : null;
            PorchLogic.glyph.renderThumbnail(
                canvas,
                glyphData,
                editorType,
                pixelOptions
            );
        });
    }

    function renderCartItems() {
        var container = document.getElementById("cart-items-container");
        var note = document.getElementById("cart-note");
        if (!container || !PorchLogic.cartStore) return;

        var items = PorchLogic.cartStore.get();
        if (!items || !items.length) {
            container.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
            if (note) note.style.display = "none";
            updateSummary(0);
            return;
        }

        var subtotal = 0;
        var html = items
            .map(function (item, index) {
                var qty = Number(item.quantity || 1);
                var base = Number(item.price || 0);
                var extras = addOnsTotal(item);
                var total = base * qty + extras;
                subtotal += total;

                var name = escapeHtml(item.name || item.product_id || item.id || "Item");
                var options = summarizeOptions(item);
                var optionsHtml = options.length
                    ? options.map(escapeHtml).join("<br>")
                    : "—";
                var glyphAttr = item.attributes && item.attributes.custom_glyph ? item.attributes.custom_glyph : null;
                var glyphEnabled =
                    glyphAttr && typeof glyphAttr.value === "boolean"
                        ? glyphAttr.value
                        : !!item.customGlyphEnabled;
                var glyphData =
                    glyphAttr && Array.isArray(glyphAttr.data)
                        ? glyphAttr.data
                        : item.glyphData;
                var hasGlyph = glyphEnabled && Array.isArray(glyphData) && glyphData.length;
                var glyphHtml = hasGlyph
                    ? '<canvas class="glyph-thumb-canvas" width="48" height="48" data-glyph-index="' +
                      index +
                      '"></canvas>'
                    : "";

                return [
                    '<div class="cart-row">',
                    '  <div class="cart-cell cart-cell--remove">',
                    '    <button type="button" class="cart-remove" aria-label="Remove item" data-remove-index="' +
                        index +
                        '">×</button>',
                    "  </div>",
                    '  <div class="cart-cell cart-cell--item">',
                    '    <div class="cart-item-name">' + name + "</div>",
                    "  </div>",
                    '  <div class="cart-cell cart-cell--options">',
                    '    <div class="cart-option-stack">' + optionsHtml + "</div>",
                    "  </div>",
                    '  <div class="cart-cell cart-cell--glyph">' + glyphHtml + "</div>",
                    '  <div class="cart-cell cart-cell--qty">' + qty + "</div>",
                    '  <div class="cart-cell cart-cell--total">' +
                        formatMoney(total) +
                        "</div>",
                    "</div>",
                ].join("");
            })
            .join("");

        container.innerHTML = html;
        updateSummary(subtotal);
        renderGlyphThumbnails(items);
    }

    function bindRemoveHandler() {
        document.addEventListener("click", function (event) {
            var target = event.target;
            if (!target || !target.matches("[data-remove-index]")) return;
            if (!PorchLogic.cartStore) return;
            var index = Number(target.getAttribute("data-remove-index"));
            var items = PorchLogic.cartStore.get();
            if (!items || !items.length || !Number.isFinite(index)) return;
            items.splice(index, 1);
            PorchLogic.cartStore.set(items);
            PorchLogic.cartStore.updateCount();
            renderCartItems();
        });
    }

    function initCheckoutButton() {
        var checkoutBtn = document.getElementById("go-to-checkout");
        if (!checkoutBtn || !PorchLogic.cartStore) return;
        var items = PorchLogic.cartStore.get();
        checkoutBtn.disabled = !items || items.length === 0;
        checkoutBtn.addEventListener("click", function () {
            if (!items || items.length === 0) return;
            window.location.href = "../checkout/";
        });
    }

    PorchLogic.cartPage = {
        init: function () {
            renderCartItems();
            bindRemoveHandler();
            initCheckoutButton();
        },
    };

    global.PorchLogic = PorchLogic;
})(window);

/* cart_popup.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};

    function showCartPopup(message) {
        var dialog = document.getElementById("cart-popup");
        var text = document.getElementById("popup-message");
        if (text) text.textContent = message || "Added to cart.";
        if (dialog && typeof dialog.showModal === "function") {
            dialog.showModal();
        }
    }

    function hideCartPopup() {
        var dialog = document.getElementById("cart-popup");
        if (!dialog) return;
        if (typeof dialog.close === "function") {
            dialog.close();
        }
    }

    function initCartPopup() {
        var closeBtn = document.querySelector("[data-close-cart]");
        var dialog = document.getElementById("cart-popup");
        if (closeBtn) {
            closeBtn.addEventListener("click", hideCartPopup);
        }
        if (dialog) {
            dialog.addEventListener("cancel", function (event) {
                event.preventDefault();
                hideCartPopup();
            });
        }
    }

    PorchLogic.cartPopup = {
        show: showCartPopup,
        hide: hideCartPopup,
        init: initCartPopup,
    };

    global.PorchLogic = PorchLogic;
})(window);

/* cart_store.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};
    var STORAGE_KEY = "porchlogic_cart";

    function getCartItems() {
        try {
            var raw = sessionStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (err) {
            return [];
        }
    }

    function saveCartItems(items) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items || []));
    }

    function getCount(items) {
        return (items || []).reduce(function (sum, item) {
            return sum + Number(item.quantity || 0);
        }, 0);
    }

    function updateCartCount() {
        var nodes = document.querySelectorAll("[data-cart-count]");
        if (!nodes.length) return;
        var items = getCartItems();
        var count = getCount(items);
        nodes.forEach(function (node) {
            node.textContent = String(count || 0);
        });
    }

    PorchLogic.cartStore = {
        get: getCartItems,
        set: saveCartItems,
        count: getCount,
        updateCount: updateCartCount,
    };

    global.PorchLogic = PorchLogic;
})(window);

/* checkout_page.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};
    var STRIPE_KEYS = {
        live: "pk_live_51J3mlbABTHjSuIhXgQq9s0XUfm1Fgnao9DnO29jF1hf4LpKh129cDDOpwiQRptEx7QlkcrnpHTfa3OQX30wHI4mB00NgdoLrSr",
        test: "pk_test_51SadSnPADwDYgfnv3uZarRIVlDlx9waCCBQqaU0RLeRm9sN8ux3MdShacex3tPVHR7Qh3heZJwXI55rz9egsnX7y00M18XjPVQ",
    };
    function resolveApiBase() {
        try {
            var host = global.location && global.location.hostname;
            if (host === "localhost" || host === "127.0.0.1") {
                return "http://localhost:4242";
            }
        } catch (err) {
            // fall back to production base
        }
        return "https://api.porchlogic.com";
    }
    var API_BASE = resolveApiBase();
    var TEST_MODE_KEY = "porchlogic_checkout_test_mode";
    var stripe = null;
    var checkout = null;
    var testModeEnabled = false;
    var testModeBanner = null;
    var messageEl = null;

    function formatDate() {
        try {
            return new Date().toLocaleDateString();
        } catch (err) {
            return "";
        }
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove("visible");
    }

    function setMessage(text, isError) {
        if (!messageEl) return;
        if (!text) {
            messageEl.textContent = "";
            messageEl.classList.add("hidden");
            return;
        }
        messageEl.textContent = text;
        messageEl.classList.remove("hidden");
        messageEl.style.color = isError ? "#a53c3c" : "";
    }

    function getStripeKey() {
        return testModeEnabled ? STRIPE_KEYS.test : STRIPE_KEYS.live;
    }

    function applyTestModeBanner() {
        if (!testModeBanner) return;
        testModeBanner.classList.toggle("hidden", !testModeEnabled);
    }

    function setTestMode(enabled) {
        testModeEnabled = enabled;
        applyTestModeBanner();
        try {
            sessionStorage.setItem(TEST_MODE_KEY, enabled ? "1" : "0");
        } catch (err) {
            console.warn("Could not persist test mode state:", err);
        }

        if (checkout) {
            global.location.reload();
            return;
        }

        if (global.Stripe) {
            stripe = global.Stripe(getStripeKey());
        }
    }

    function initTestMode() {
        try {
            testModeEnabled = sessionStorage.getItem(TEST_MODE_KEY) === "1";
        } catch (err) {
            console.warn("Could not read stored test mode state:", err);
            testModeEnabled = false;
        }
        applyTestModeBanner();
        if (global.Stripe) {
            stripe = global.Stripe(getStripeKey());
        }
    }

    function initPolicyModal() {
        var modal = document.getElementById("policy-modal");
        var buttons = document.querySelectorAll("[data-policy-link]");
        var closeButtons = document.querySelectorAll("[data-close-policy]");
        var dateNodes = document.querySelectorAll("[data-policy-date]");
        var formatted = formatDate();
        dateNodes.forEach(function (node) {
            node.textContent = formatted;
        });

        buttons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                if (!modal) return;
                var key = btn.getAttribute("data-policy-link");
                var articles = modal.querySelectorAll(".policy-content");
                articles.forEach(function (article) {
                    article.classList.toggle("hidden", !article.id.endsWith(key));
                });
                modal.classList.add("visible");
            });
        });

        closeButtons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                closeModal(modal);
            });
        });
    }

    function normalizeCartItems(items) {
        return (items || []).map(function normalize(item) {
            if (!item || typeof item !== "object") return item;
            var attributes = item.attributes || {};
            if (item.customGlyphEnabled || item.glyphData) {
                attributes.custom_glyph = attributes.custom_glyph || {
                    type: "toggle",
                    value: !!item.customGlyphEnabled,
                    data: item.glyphData || null,
                };
            }
            if (item.batteryModel || item.batteryModelLabel) {
                attributes.battery_model = attributes.battery_model || {
                    type: "select",
                    value: item.batteryModel || null,
                    label: item.batteryModelLabel || null,
                };
            }
            if (item.batteryInquiry) {
                attributes.battery_inquiry = attributes.battery_inquiry || {
                    type: "inquiry",
                    value: item.batteryInquiry,
                };
            }
            var rawIncludes = item.includes || item.bundleItems || null;
            var includes = Array.isArray(rawIncludes)
                ? rawIncludes.map(normalize)
                : null;
            return {
                product_id: item.product_id || item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                attributes: attributes,
                add_ons: item.add_ons || null,
                includes: includes,
            };
        });
    }

    function getCartItems() {
        if (!PorchLogic.cartStore) return [];
        return PorchLogic.cartStore.get();
    }

    function clearCart() {
        if (!PorchLogic.cartStore) return;
        PorchLogic.cartStore.set([]);
        PorchLogic.cartStore.updateCount();
    }

    async function initializeCheckout() {
        var cartItems = normalizeCartItems(getCartItems());
        if (!cartItems.length) {
            setMessage("Your cart is empty.", true);
            return;
        }

        if (!stripe && global.Stripe) {
            stripe = global.Stripe(getStripeKey());
        }

        if (!stripe || typeof stripe.initEmbeddedCheckout !== "function") {
            setMessage("Stripe failed to load. Please refresh.", true);
            return;
        }

        var fetchClientSecret = async function () {
            var res = await fetch(API_BASE + "/create-checkout-session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    cartItems: cartItems,
                    subscribeToNewsletter: false,
                }),
            });

            var data;
            try {
                data = await res.json();
            } catch (err) {
                setMessage("Server error. Please try again.", true);
                throw err;
            }

            if (!res.ok) {
                var msg =
                    (data && (data.message || data.error)) ||
                    "Checkout session failed. Please try again.";
                setMessage(msg, true);
                throw new Error(msg);
            }

            if (!data || typeof data.clientSecret !== "string") {
                setMessage(
                    "Checkout session error. Please try again or contact support.",
                    true
                );
                throw new Error("Missing client secret");
            }

            global.activeCheckoutSessionId = data.sessionId;
            syncNewsletterPreference();
            return data.clientSecret;
        };

        var onShippingDetailsChange = async function (payload) {
            try {
                var res = await fetch(API_BASE + "/calculate-shipping-options", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        checkout_session_id: payload.checkoutSessionId,
                        shipping_details: payload.shippingDetails,
                    }),
                });

                var data = await res.json();
                if (data && data.type === "error") {
                    return { type: "reject", errorMessage: data.message };
                }

                return { type: "accept" };
            } catch (err) {
                console.error("Shipping options error:", err);
                return {
                    type: "reject",
                    errorMessage:
                        "We couldn't validate your address. Please try again.",
                };
            }
        };

        checkout = await stripe.initEmbeddedCheckout({
            fetchClientSecret: fetchClientSecret,
            onShippingDetailsChange: onShippingDetailsChange,
            onComplete: function (event) {
                if (event && event.status === "complete") {
                    clearCart();
                }
            },
        });

        checkout.mount("#checkout");
    }

    async function syncNewsletterPreference() {
        var checkbox = document.getElementById("subscribe-checkbox");
        if (!checkbox || !global.activeCheckoutSessionId) return;
        var subscribe = !!checkbox.checked;
        try {
            await fetch(API_BASE + "/newsletter-checkout-opt-in", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: global.activeCheckoutSessionId,
                    subscribe: subscribe,
                }),
            });
        } catch (err) {
            console.error("Failed to sync newsletter preference:", err);
        }
    }

    function initNewsletterSync() {
        var checkbox = document.getElementById("subscribe-checkbox");
        if (!checkbox) return;
        checkbox.addEventListener("change", function () {
            if (global.activeCheckoutSessionId) {
                syncNewsletterPreference();
            }
        });
    }

    PorchLogic.checkoutPage = {
        init: function () {
            messageEl = document.getElementById("checkout-message");
            testModeBanner = document.getElementById("test-mode-banner");

            initPolicyModal();
            initTestMode();
            initNewsletterSync();

            document.addEventListener("keydown", function (event) {
                var isToggle =
                    (event.key === "t" || event.key === "T") && event.shiftKey;
                if (!isToggle) return;
                event.preventDefault();
                setTestMode(!testModeEnabled);
            });

            initializeCheckout().catch(function (err) {
                console.error("Checkout init failed:", err);
            });
        },
    };

    global.PorchLogic = PorchLogic;
})(window);

/* choice_chips.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};

    PorchLogic.initChoiceChips = function () {
        var buttons = Array.prototype.slice.call(
            document.querySelectorAll(".chip[data-attribute]")
        );
        if (!buttons.length) return;
        buttons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                var group = btn.closest(".attribute__value--choices");
                var peers = group ? group.querySelectorAll(".chip") : buttons;
                Array.prototype.forEach.call(peers, function (peer) {
                    var isActive = peer === btn;
                    peer.classList.toggle("chip--selected", isActive);
                    peer.setAttribute("aria-pressed", String(isActive));
                });
            });
        });
    };

    global.PorchLogic = PorchLogic;
})(window);

/* core.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};

    PorchLogic.ready = function (fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
            return;
        }
        fn();
    };

    global.PorchLogic = PorchLogic;
})(window);

/* glyph_editor.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};
    var glyphState = { enabled: false, data: null };
    var glyphAudioContext = null;

    function getGlyphAudioContext() {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!glyphAudioContext) {
            glyphAudioContext = new AudioCtx();
        }
        if (glyphAudioContext.state === "suspended") {
            glyphAudioContext.resume();
        }
        return glyphAudioContext;
    }

    function createMoundGrid(canvas, controls, initialData, onChange) {
        var ROWS = 8;
        var COLS = 16;
        var WIDTH = canvas.width;
        var HEIGHT = canvas.height;

        var moundData = Array.from({ length: ROWS }, function () {
            return Array.from({ length: COLS }, function () {
                return 0;
            });
        });

        if (Array.isArray(initialData) && initialData.length === ROWS) {
            moundData = JSON.parse(JSON.stringify(initialData));
        }

        var ctx = canvas.getContext("2d");
        var isDragging = false;
        var dragButton = 0;
        var changedThisDrag = new Set();
        var mode = "mound";
        var soundEnabled = true;

        var flatBtn = controls && controls.flatBtn ? controls.flatBtn : null;
        var moundBtn = controls && controls.moundBtn ? controls.moundBtn : null;
        var soundToggleBtn =
            controls && controls.soundToggle ? controls.soundToggle : null;

        function setMode(newMode) {
            mode = newMode;
            if (flatBtn) flatBtn.classList.toggle("active", mode === "flat");
            if (moundBtn) moundBtn.classList.toggle("active", mode === "mound");
        }

        if (flatBtn) flatBtn.addEventListener("click", function () {
            setMode("flat");
        });
        if (moundBtn) moundBtn.addEventListener("click", function () {
            setMode("mound");
        });

        function setSoundEnabled(enabled) {
            soundEnabled = enabled;
            if (soundToggleBtn) {
                soundToggleBtn.setAttribute("aria-pressed", String(soundEnabled));
                var labelEl =
                    soundToggleBtn.querySelector(".glyph-icon-label");
                if (labelEl) {
                    labelEl.textContent = soundEnabled ? "Sound on" : "Sound off";
                }
            }
        }

        if (soundToggleBtn) {
            soundToggleBtn.addEventListener("click", function () {
                setSoundEnabled(!soundEnabled);
                if (soundEnabled) getGlyphAudioContext();
            });
            setSoundEnabled(soundEnabled);
        }

        setMode("mound");

        function getHitInfo(x, y) {
            var colWidth = WIDTH / COLS;
            var rowHeight = HEIGHT / ROWS;
            var col = Math.floor(x / colWidth);
            var row = Math.floor(y / rowHeight);
            if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
            return { row: row, col: col };
        }

        function playBumpSound() {
            if (!soundEnabled) return;
            var ctx = getGlyphAudioContext();
            if (!ctx) return;
            var now = ctx.currentTime;
            var osc = ctx.createOscillator();
            osc.type = "sine";
            var baseFreq = 170 + Math.random() * 90;
            var endFreq = baseFreq * (0.45 + Math.random() * 0.12);
            osc.frequency.setValueAtTime(baseFreq, now);
            osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.1);
            var gain = ctx.createGain();
            var peak = 0.2 + Math.random() * 0.08;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.16);
            var filter = ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.setValueAtTime(900 + Math.random() * 500, now);
            filter.Q.setValueAtTime(0.9 + Math.random() * 0.6, now);
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.2);
        }

        function applyAction(row, col, button) {
            var key = row + ":" + col;
            if (changedThisDrag.has(key)) return;
            var value = 0;
            if (button !== 2) {
                value = mode === "mound" ? 1 : 0;
            }
            var currentValue = moundData[row][col];
            changedThisDrag.add(key);
            if (currentValue === value) return;
            moundData[row][col] = value;
            draw();
            playBumpSound();
            if (typeof onChange === "function") {
                onChange(JSON.parse(JSON.stringify(moundData)));
            }
        }

        function draw() {
            ctx.clearRect(0, 0, WIDTH, HEIGHT);
            ctx.lineWidth = 9;
            ctx.strokeStyle = "#cdd5e3";
            var colWidth = WIDTH / COLS;
            var rowHeight = HEIGHT / ROWS;
            for (var r = 0; r < ROWS; r++) {
                var baseY = r * rowHeight + rowHeight / 2;
                ctx.beginPath();
                for (var c = 0; c < COLS; c++) {
                    var h = moundData[r][c];
                    var hNext = c < COLS - 1 ? moundData[r][c + 1] : null;
                    var x0 = c * colWidth;
                    var x1 = x0 + colWidth;
                    var midX = (x0 + x1) / 2;
                    var yPeak = baseY - h * (rowHeight * 0.35);
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
            var rect = canvas.getBoundingClientRect();
            return {
                x: (evt.clientX - rect.left) * (canvas.width / rect.width),
                y: (evt.clientY - rect.top) * (canvas.height / rect.height),
            };
        }

        canvas.addEventListener("contextmenu", function (e) {
            e.preventDefault();
        });

        function beginDrag(button, clientX, clientY) {
            isDragging = true;
            dragButton = button;
            changedThisDrag.clear();
            var coords = getCanvasCoords({
                clientX: clientX,
                clientY: clientY,
            });
            var hit = getHitInfo(coords.x, coords.y);
            if (hit) applyAction(hit.row, hit.col, dragButton);
        }

        function continueDrag(clientX, clientY) {
            if (!isDragging) return;
            var coords = getCanvasCoords({
                clientX: clientX,
                clientY: clientY,
            });
            var hit = getHitInfo(coords.x, coords.y);
            if (hit) applyAction(hit.row, hit.col, dragButton);
        }

        function endDrag() {
            isDragging = false;
            changedThisDrag.clear();
        }

        canvas.addEventListener("mousedown", function (evt) {
            if (evt.button !== 0 && evt.button !== 2) return;
            beginDrag(evt.button, evt.clientX, evt.clientY);
        });

        canvas.addEventListener("mousemove", function (evt) {
            continueDrag(evt.clientX, evt.clientY);
        });

        canvas.addEventListener("mouseup", endDrag);
        document.addEventListener("mouseup", endDrag);

        canvas.addEventListener(
            "touchstart",
            function (evt) {
                var touch = evt.touches && evt.touches[0];
                if (!touch) return;
                evt.preventDefault();
                beginDrag(0, touch.clientX, touch.clientY);
            },
            { passive: false }
        );

        canvas.addEventListener(
            "touchmove",
            function (evt) {
                var touch = evt.touches && evt.touches[0];
                if (!touch) return;
                evt.preventDefault();
                continueDrag(touch.clientX, touch.clientY);
            },
            { passive: false }
        );

        canvas.addEventListener(
            "touchend",
            function () {
                endDrag();
            },
            { passive: true }
        );

        draw();

        return {
            getData: function () {
                return JSON.parse(JSON.stringify(moundData));
            },
            setData: function (d) {
                moundData = JSON.parse(JSON.stringify(d));
                draw();
            },
        };
    }

    function createPixelGrid(canvas, initialData, onChange, options) {
        var pixelRows = Number(options && options.rows);
        var pixelCols = Number(options && options.cols);
        var ROWS = Number.isFinite(pixelRows) && pixelRows > 0 ? pixelRows : 16;
        var COLS = Number.isFinite(pixelCols) && pixelCols > 0 ? pixelCols : 16;
        var WIDTH = canvas.width;
        var HEIGHT = canvas.height;

        var pixelData = Array.from({ length: ROWS }, function () {
            return Array.from({ length: COLS }, function () {
                return 0;
            });
        });

        if (
            Array.isArray(initialData) &&
            initialData.length === ROWS &&
            initialData.every(function (row) {
                return Array.isArray(row) && row.length === COLS;
            })
        ) {
            pixelData = JSON.parse(JSON.stringify(initialData));
        }

        var ctx = canvas.getContext("2d");
        var isDrawing = false;
        var drawValue = 1;
        var drawTool = "brush";
        var changedThisDrag = new Set();
        var imageState = {
            img: null,
            baseScale: 1,
            scale: 1,
            threshold: 128,
            invert: false,
            offsetX: 0,
            offsetY: 0,
            mode: "pixel",
            dragging: false,
            dragStart: null,
            previewData: null,
        };

        function getHitInfo(x, y) {
            var colWidth = WIDTH / COLS;
            var rowHeight = HEIGHT / ROWS;
            var col = Math.floor(x / colWidth);
            var row = Math.floor(y / rowHeight);
            if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
            return { row: row, col: col };
        }

        function applyAction(row, col, value) {
            var key = row + ":" + col;
            if (changedThisDrag.has(key)) return;
            changedThisDrag.add(key);
            if (pixelData[row][col] === value) return;
            pixelData[row][col] = value;
            draw();
            if (typeof onChange === "function") {
                onChange(JSON.parse(JSON.stringify(pixelData)));
            }
        }

        function drawGridLines() {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            ctx.lineWidth = 1;
            for (var r = 0; r <= ROWS; r++) {
                var y = (HEIGHT / ROWS) * r;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(WIDTH, y);
                ctx.stroke();
            }
            for (var c = 0; c <= COLS; c++) {
                var x = (WIDTH / COLS) * c;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, HEIGHT);
                ctx.stroke();
            }
        }

        function mergeData() {
            if (imageState.mode !== "image" || !imageState.previewData) {
                return pixelData;
            }
            var merged = Array.from({ length: ROWS }, function () {
                return Array.from({ length: COLS }, function () {
                    return 0;
                });
            });
            for (var r = 0; r < ROWS; r++) {
                for (var c = 0; c < COLS; c++) {
                    merged[r][c] = pixelData[r][c] || imageState.previewData[r][c];
                }
            }
            return merged;
        }

        function draw() {
            ctx.clearRect(0, 0, WIDTH, HEIGHT);
            ctx.fillStyle = "#0f1218";
            ctx.fillRect(0, 0, WIDTH, HEIGHT);
            ctx.imageSmoothingEnabled = false;
            var colWidth = WIDTH / COLS;
            var rowHeight = HEIGHT / ROWS;
            ctx.fillStyle = "#f4f6fb";
            var dataToDraw = mergeData();
            for (var r = 0; r < ROWS; r++) {
                for (var c = 0; c < COLS; c++) {
                    if (dataToDraw[r][c]) {
                        ctx.fillRect(
                            Math.floor(c * colWidth),
                            Math.floor(r * rowHeight),
                            Math.ceil(colWidth),
                            Math.ceil(rowHeight)
                        );
                    }
                }
            }
            drawGridLines();
        }

        function renderImageToPixels() {
            if (!imageState.img) return;

            var offscreen = document.createElement("canvas");
            offscreen.width = COLS;
            offscreen.height = ROWS;
            var octx = offscreen.getContext("2d");

            octx.fillStyle = "#ffffff";
            octx.fillRect(0, 0, COLS, ROWS);

            var drawW = imageState.img.width * imageState.scale;
            var drawH = imageState.img.height * imageState.scale;
            var drawX = imageState.offsetX;
            var drawY = imageState.offsetY;

            octx.imageSmoothingEnabled = true;
            octx.drawImage(imageState.img, drawX, drawY, drawW, drawH);

            var data = octx.getImageData(0, 0, COLS, ROWS).data;
            var preview = Array.from({ length: ROWS }, function () {
                return Array.from({ length: COLS }, function () {
                    return 0;
                });
            });
            for (var r = 0; r < ROWS; r++) {
                for (var c = 0; c < COLS; c++) {
                    var idx = (r * COLS + c) * 4;
                    var red = data[idx];
                    var green = data[idx + 1];
                    var blue = data[idx + 2];
                    var alpha = data[idx + 3] / 255;
                    var lum = alpha < 0.05
                        ? 255
                        : (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha;
                    var isDark = lum < imageState.threshold;
                    preview[r][c] = imageState.invert ? (isDark ? 0 : 1) : (isDark ? 1 : 0);
                }
            }
            imageState.previewData = preview;
        }

        function notifyChange() {
            if (typeof onChange === "function") {
                onChange(JSON.parse(JSON.stringify(pixelData)));
            }
        }

        function getCanvasCoords(evt) {
            var rect = canvas.getBoundingClientRect();
            return {
                x: (evt.clientX - rect.left) * (canvas.width / rect.width),
                y: (evt.clientY - rect.top) * (canvas.height / rect.height),
            };
        }

        canvas.addEventListener("contextmenu", function (e) {
            e.preventDefault();
        });

        function beginDraw(button, clientX, clientY) {
            if (imageState.mode === "image" && imageState.img) {
                imageState.dragging = true;
                imageState.dragStart = {
                    x: clientX,
                    y: clientY,
                    offsetX: imageState.offsetX,
                    offsetY: imageState.offsetY,
                };
                return;
            }

            isDrawing = true;
            if (button === 2) {
                drawValue = 0;
            } else {
                drawValue = drawTool === "eraser" ? 0 : 1;
            }
            changedThisDrag.clear();
            var coords = getCanvasCoords({
                clientX: clientX,
                clientY: clientY,
            });
            var hit = getHitInfo(coords.x, coords.y);
            if (hit) applyAction(hit.row, hit.col, drawValue);
        }

        function continueDraw(clientX, clientY) {
            if (imageState.mode === "image" && imageState.img && imageState.dragging) {
                var dx = clientX - imageState.dragStart.x;
                var dy = clientY - imageState.dragStart.y;
                var rect = canvas.getBoundingClientRect();
                var gridScaleX = COLS / rect.width;
                var gridScaleY = ROWS / rect.height;
                imageState.offsetX = imageState.dragStart.offsetX + dx * gridScaleX;
                imageState.offsetY = imageState.dragStart.offsetY + dy * gridScaleY;
                renderImageToPixels();
                draw();
                notifyChange();
                return;
            }

            if (!isDrawing) return;
            var coords = getCanvasCoords({
                clientX: clientX,
                clientY: clientY,
            });
            var hit = getHitInfo(coords.x, coords.y);
            if (hit) applyAction(hit.row, hit.col, drawValue);
        }

        function endDraw() {
            isDrawing = false;
            changedThisDrag.clear();
            imageState.dragging = false;
        }

        canvas.addEventListener("mousedown", function (evt) {
            if (evt.button !== 0 && evt.button !== 2) return;
            beginDraw(evt.button, evt.clientX, evt.clientY);
        });

        canvas.addEventListener("mousemove", function (evt) {
            continueDraw(evt.clientX, evt.clientY);
        });

        canvas.addEventListener("mouseup", endDraw);
        document.addEventListener("mouseup", endDraw);

        canvas.addEventListener(
            "touchstart",
            function (evt) {
                var touch = evt.touches && evt.touches[0];
                if (!touch) return;
                evt.preventDefault();
                beginDraw(0, touch.clientX, touch.clientY);
            },
            { passive: false }
        );

        canvas.addEventListener(
            "touchmove",
            function (evt) {
                var touch = evt.touches && evt.touches[0];
                if (!touch) return;
                evt.preventDefault();
                continueDraw(touch.clientX, touch.clientY);
            },
            { passive: false }
        );

        canvas.addEventListener(
            "touchend",
            function () {
                endDraw();
            },
            { passive: true }
        );

        draw();

        return {
            getData: function () {
                return JSON.parse(JSON.stringify(pixelData));
            },
            setData: function (d) {
                pixelData = JSON.parse(JSON.stringify(d));
                draw();
            },
            setImage: function (img) {
                imageState.img = img;
                imageState.baseScale = Math.min(COLS / img.width, ROWS / img.height);
                imageState.scale = imageState.baseScale;
                imageState.threshold = 128;
                imageState.invert = false;
                imageState.offsetX = (COLS - img.width * imageState.scale) / 2;
                imageState.offsetY = (ROWS - img.height * imageState.scale) / 2;
                imageState.mode = "image";
                renderImageToPixels();
                draw();
                notifyChange();
            },
            setScale: function (scale) {
                if (!imageState.img) return;
                var currentScale = imageState.scale || imageState.baseScale;
                var centerX =
                    imageState.offsetX +
                    (imageState.img.width * currentScale) / 2;
                var centerY =
                    imageState.offsetY +
                    (imageState.img.height * currentScale) / 2;
                imageState.scale = imageState.baseScale * scale;
                imageState.offsetX =
                    centerX - (imageState.img.width * imageState.scale) / 2;
                imageState.offsetY =
                    centerY - (imageState.img.height * imageState.scale) / 2;
                if (imageState.img) {
                    renderImageToPixels();
                    draw();
                    notifyChange();
                }
            },
            setThreshold: function (threshold) {
                imageState.threshold = threshold;
                if (imageState.img) {
                    renderImageToPixels();
                    draw();
                    notifyChange();
                }
            },
            setInvert: function (invert) {
                imageState.invert = !!invert;
                if (imageState.img) {
                    renderImageToPixels();
                    draw();
                    notifyChange();
                }
            },
            setMode: function (mode) {
                imageState.mode = mode;
                if (imageState.img && mode === "image") {
                    renderImageToPixels();
                    draw();
                    notifyChange();
                }
            },
            clear: function () {
                pixelData = Array.from({ length: ROWS }, function () {
                    return Array.from({ length: COLS }, function () {
                        return 0;
                    });
                });
                draw();
                notifyChange();
            },
            removeImage: function () {
                imageState.img = null;
                imageState.mode = "pixel";
                imageState.previewData = null;
            },
            hasImage: function () {
                return !!imageState.img;
            },
            getMode: function () {
                return imageState.mode;
            },
            applyImage: function () {
                if (!imageState.previewData) return;
                for (var r = 0; r < ROWS; r++) {
                    for (var c = 0; c < COLS; c++) {
                        if (imageState.previewData[r][c]) {
                            pixelData[r][c] = 1;
                        }
                    }
                }
                imageState.previewData = null;
                imageState.mode = "pixel";
                draw();
                notifyChange();
            },
            setTool: function (tool) {
                drawTool = tool === "eraser" ? "eraser" : "brush";
            },
        };
    }

    function bindCanvasViewportFit(editorEl, canvas, controlsEl) {
        if (!editorEl || !canvas) {
            return function () {};
        }

        if (typeof editorEl._fitCleanup === "function") {
            editorEl._fitCleanup();
        }

        var queued = false;
        var queueFit = function () {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () {
                queued = false;
                var modalInner = editorEl.closest(".glyph-modal-inner");
                if (!modalInner) return;
                var innerRect = modalInner.getBoundingClientRect();
                var editorRect = editorEl.getBoundingClientRect();
                var controlsHeight = controlsEl && controlsEl.getBoundingClientRect
                    ? controlsEl.getBoundingClientRect().height
                    : 0;
                var styles = window.getComputedStyle(editorEl);
                var gap = Number(styles.rowGap || styles.gap || 0) || 0;
                var topOffset = editorRect.top - innerRect.top;
                var safety = 12;
                var availableHeight = Math.floor(
                    innerRect.height - topOffset - controlsHeight - gap - safety
                );
                var minHeight = 160;
                var maxHeight = Math.max(minHeight, availableHeight);
                canvas.style.width = "auto";
                canvas.style.height = "auto";
                canvas.style.maxWidth = "100%";
                canvas.style.maxHeight = String(maxHeight) + "px";
            });
        };

        var onResize = function () {
            queueFit();
        };
        window.addEventListener("resize", onResize);
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", onResize);
        }
        editorEl._fitCleanup = function () {
            window.removeEventListener("resize", onResize);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener("resize", onResize);
            }
            editorEl._fitCleanup = null;
        };

        queueFit();
        return queueFit;
    }

    function attachMoundGrid(uid, editorEl, existingData, options) {
        editorEl.innerHTML = "";

        var canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 640;
        canvas.style.border = "1px solid #313945";
        canvas.style.width = "auto";
        canvas.style.height = "auto";
        canvas.style.maxWidth = "640px";
        canvas.style.display = "block";
        canvas.style.margin = "auto";

        var canvasWrap = document.createElement("div");
        canvasWrap.className = "glyph-canvas-wrap";
        canvasWrap.appendChild(canvas);

        var controlsWrapper = document.createElement("div");
        controlsWrapper.className = "glyph-mode-wrapper glyph-controls-wrap";

        var flatBtn = document.createElement("button");
        flatBtn.type = "button";
        flatBtn.className = "glyph-mode-btn";
        flatBtn.title = "Flat line";
        flatBtn.innerHTML =
            '<span class="glyph-icon glyph-icon-flat"></span><span class="glyph-icon-label">Flat</span>';

        var moundBtn = document.createElement("button");
        moundBtn.type = "button";
        moundBtn.className = "glyph-mode-btn";
        moundBtn.title = "Mound";
        moundBtn.innerHTML =
            '<span class="glyph-icon glyph-icon-mound"></span><span class="glyph-icon-label">Mound</span>';

        controlsWrapper.appendChild(flatBtn);
        controlsWrapper.appendChild(moundBtn);

        var layout = document.createElement("div");
        layout.className = "glyph-editor-layout";
        layout.appendChild(canvasWrap);
        layout.appendChild(controlsWrapper);
        editorEl.appendChild(layout);

        var soundToggle = document.createElement("button");
        soundToggle.type = "button";
        soundToggle.className = "glyph-sound-toggle";
        soundToggle.setAttribute("aria-pressed", "true");
        soundToggle.title = "Toggle sculpt sound";
        soundToggle.innerHTML =
            '<span class="glyph-sound-dot" aria-hidden="true"></span><span class="glyph-icon-label">Sound on</span>';
        controlsWrapper.appendChild(soundToggle);

        createMoundGrid(
            canvas,
            { flatBtn: flatBtn, moundBtn: moundBtn, soundToggle: soundToggle },
            existingData,
            function (data) {
                var glyphCopy = JSON.parse(JSON.stringify(data));
                if (options && typeof options.onDataChange === "function") {
                    options.onDataChange(glyphCopy);
                }
                if (
                    options &&
                    typeof options.onThumbnailUpdate === "function"
                ) {
                    options.onThumbnailUpdate(glyphCopy);
                }
            }
        );

        bindCanvasViewportFit(editorEl, canvas, controlsWrapper);
    }

    function attachPixelGrid(uid, editorEl, existingData, options) {
        editorEl.innerHTML = "";
        var pixelRows = Number(options && options.rows);
        var pixelCols = Number(options && options.cols);
        var rows = Number.isFinite(pixelRows) && pixelRows > 0 ? pixelRows : 16;
        var cols = Number.isFinite(pixelCols) && pixelCols > 0 ? pixelCols : 16;
        var baseWidth = 512;

        var canvas = document.createElement("canvas");
        canvas.width = baseWidth;
        canvas.height = Math.max(256, Math.round(baseWidth * (rows / cols)));
        canvas.style.border = "1px solid #313945";
        canvas.style.width = "auto";
        canvas.style.height = "auto";
        canvas.style.maxWidth = "512px";
        canvas.style.display = "block";
        canvas.style.margin = "auto";

        var canvasWrap = document.createElement("div");
        canvasWrap.className = "glyph-canvas-wrap";
        canvasWrap.appendChild(canvas);

        var controls = document.createElement("div");
        controls.className = "glyph-pixel-controls glyph-controls-wrap";

        var toolControls = document.createElement("div");
        toolControls.className = "glyph-pixel-tools";

        var brushBtn = document.createElement("button");
        brushBtn.type = "button";
        brushBtn.className = "glyph-mode-btn active";
        brushBtn.setAttribute("aria-label", "Brush tool");
        brushBtn.title = "Brush";
        brushBtn.innerHTML =
            '<svg class="glyph-icon glyph-icon--brush" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16.5 3.5l4 4-8.6 8.6-4-4L16.5 3.5zM7.1 13.9l3 3c.2.2.3.6.2.9-.4 1.6-1.7 2.9-3.3 3.3-.3.1-.7 0-.9-.2l-2.1-2.1c-.2-.2-.3-.6-.2-.9.4-1.6 1.7-2.9 3.3-3.3.3-.1.7 0 .9.2z"></path></svg><span class="visually-hidden">Brush</span>';

        var eraserBtn = document.createElement("button");
        eraserBtn.type = "button";
        eraserBtn.className = "glyph-mode-btn";
        eraserBtn.setAttribute("aria-label", "Eraser tool");
        eraserBtn.title = "Eraser";
        eraserBtn.innerHTML =
            '<svg class="glyph-icon glyph-icon--eraser" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16.2 3.4l4.4 4.4c.5.5.5 1.3 0 1.8l-8.2 8.2c-.3.3-.8.5-1.3.5H6.5c-.5 0-1-.2-1.3-.5l-1.8-1.8c-.5-.5-.5-1.3 0-1.8l8.2-8.2c.5-.5 1.3-.5 1.8 0l2.8 2.9 2-2-2.8-2.9zM6.7 16.6h4.1l4.4-4.4-4.4-4.4-6.1 6.1 2 2.7z"></path></svg><span class="visually-hidden">Eraser</span>';

        var pointerBtn = document.createElement("button");
        pointerBtn.type = "button";
        pointerBtn.className = "glyph-mode-btn glyph-mode-btn--pointer";
        pointerBtn.setAttribute("aria-label", "Image mode");
        pointerBtn.title = "Image mode";
        pointerBtn.innerHTML =
            '<svg class="glyph-icon glyph-icon--cursor" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3l12 7-6 2 3 6-3 1-3-6-3 4V3z"></path></svg><span class="visually-hidden">Image</span>';
        pointerBtn.disabled = true;

        toolControls.appendChild(brushBtn);
        toolControls.appendChild(eraserBtn);
        toolControls.appendChild(pointerBtn);

        var fileWrap = document.createElement("label");
        fileWrap.className = "glyph-file";
        fileWrap.textContent = "Upload image";

        var fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileWrap.appendChild(fileInput);

        var scaleWrap = document.createElement("label");
        scaleWrap.className = "glyph-range";
        scaleWrap.textContent = "Scale";
        var scaleInput = document.createElement("input");
        scaleInput.type = "range";
        scaleInput.min = "10";
        scaleInput.max = "300";
        scaleInput.value = "100";
        scaleInput.step = "1";
        scaleWrap.appendChild(scaleInput);

        var thresholdWrap = document.createElement("label");
        thresholdWrap.className = "glyph-range";
        thresholdWrap.textContent = "Threshold";
        var thresholdInput = document.createElement("input");
        thresholdInput.type = "range";
        thresholdInput.min = "0";
        thresholdInput.max = "255";
        thresholdInput.value = "128";
        thresholdInput.step = "1";
        thresholdWrap.appendChild(thresholdInput);

        var invertWrap = document.createElement("label");
        invertWrap.className = "glyph-toggle-row";
        var invertInput = document.createElement("input");
        invertInput.type = "checkbox";
        invertInput.className = "glyph-toggle-input";
        var invertLabel = document.createElement("span");
        invertLabel.textContent = "Invert";
        invertWrap.appendChild(invertInput);
        invertWrap.appendChild(invertLabel);

        var actionRow = document.createElement("div");
        actionRow.className = "glyph-pixel-actions";
        var clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "glyph-mode-btn";
        clearBtn.textContent = "Clear";
        var applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "glyph-mode-btn";
        applyBtn.textContent = "Apply";
        actionRow.appendChild(clearBtn);
        actionRow.appendChild(applyBtn);

        controls.appendChild(toolControls);
        controls.appendChild(fileWrap);
        controls.appendChild(scaleWrap);
        controls.appendChild(thresholdWrap);
        controls.appendChild(invertWrap);
        controls.appendChild(actionRow);

        var layout = document.createElement("div");
        layout.className = "glyph-editor-layout";
        layout.appendChild(canvasWrap);
        layout.appendChild(controls);
        editorEl.appendChild(layout);

        var grid = createPixelGrid(canvas, existingData, function (data) {
            var glyphCopy = JSON.parse(JSON.stringify(data));
            if (options && typeof options.onDataChange === "function") {
                options.onDataChange(glyphCopy);
            }
            if (options && typeof options.onThumbnailUpdate === "function") {
                options.onThumbnailUpdate(glyphCopy);
            }
        }, options);

        var currentTool = "brush";
        var fitCanvasToViewport = bindCanvasViewportFit(editorEl, canvas, controls);

        function syncToolButtons() {
            brushBtn.classList.toggle("active", currentTool === "brush");
            eraserBtn.classList.toggle("active", currentTool === "eraser");
        }

        function syncModeButtons(mode) {
            toolControls.classList.toggle("is-image", mode === "image");
            pointerBtn.classList.toggle("active", mode === "image");
            syncToolButtons();
            fileWrap.classList.toggle("is-hidden", mode === "image");
            clearBtn.classList.toggle("is-hidden", mode === "image");
            scaleWrap.classList.toggle("is-hidden", mode !== "image");
            thresholdWrap.classList.toggle("is-hidden", mode !== "image");
            invertWrap.classList.toggle("is-hidden", mode !== "image");
            applyBtn.classList.toggle("is-hidden", mode !== "image");
            fitCanvasToViewport();
        }

        brushBtn.addEventListener("click", function () {
            grid.setTool("brush");
            currentTool = "brush";
            syncToolButtons();
        });

        eraserBtn.addEventListener("click", function () {
            grid.setTool("eraser");
            currentTool = "eraser";
            syncToolButtons();
        });

        fileInput.addEventListener("change", function (event) {
            var file = event.target && event.target.files ? event.target.files[0] : null;
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (evt) {
                var img = new Image();
                img.onload = function () {
                    grid.setImage(img);
                    scaleInput.value = "100";
                    thresholdInput.value = "128";
                    invertInput.checked = false;
                    syncModeButtons("image");
                    fitCanvasToViewport();
                };
                img.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        });

        scaleInput.addEventListener("input", function () {
            var scale = Number(scaleInput.value || 100) / 100;
            grid.setScale(scale);
        });

        thresholdInput.addEventListener("input", function () {
            var threshold = Number(thresholdInput.value || 128);
            grid.setThreshold(threshold);
        });

        invertInput.addEventListener("change", function () {
            grid.setInvert(invertInput.checked);
        });

        clearBtn.addEventListener("click", function () {
            grid.clear();
        });

        applyBtn.addEventListener("click", function () {
            grid.applyImage();
            syncModeButtons("pixel");
        });

        syncModeButtons("pixel");
    }

    function isPixelDataOfSize(glyphData, rows, cols) {
        return (
            Array.isArray(glyphData) &&
            glyphData.length === rows &&
            glyphData.every(function (row) {
                return Array.isArray(row) && row.length === cols;
            })
        );
    }

    function isPixelData(glyphData) {
        return (
            isPixelDataOfSize(glyphData, 16, 16) ||
            isPixelDataOfSize(glyphData, 32, 16)
        );
    }

    function isMoundData(glyphData) {
        return (
            Array.isArray(glyphData) &&
            glyphData.length === 8 &&
            glyphData.every(function (row) {
                return Array.isArray(row) && row.length === 16;
            })
        );
    }

    function renderPixelThumbnail(canvas, glyphData, options) {
        var pixelRows = Number(options && options.rows);
        var pixelCols = Number(options && options.cols);
        var ROWS = Number.isFinite(pixelRows) && pixelRows > 0 ? pixelRows : 16;
        var COLS = Number.isFinite(pixelCols) && pixelCols > 0 ? pixelCols : 16;
        var data = Array.from({ length: ROWS }, function () {
            return Array.from({ length: COLS }, function () {
                return 0;
            });
        });

        if (isPixelDataOfSize(glyphData, ROWS, COLS)) {
            data = glyphData;
        }

        var ctx = canvas.getContext("2d");
        var WIDTH = canvas.width;
        var HEIGHT = canvas.height;
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = "#1a1f27";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        var colWidth = WIDTH / COLS;
        var rowHeight = HEIGHT / ROWS;
        ctx.fillStyle = "#f4f6fb";
        for (var r = 0; r < ROWS; r++) {
            for (var c = 0; c < COLS; c++) {
                if (data[r][c]) {
                    ctx.fillRect(
                        Math.floor(c * colWidth),
                        Math.floor(r * rowHeight),
                        Math.ceil(colWidth),
                        Math.ceil(rowHeight)
                    );
                }
            }
        }
    }

    function renderMoundThumbnail(canvas, glyphData) {
        var ROWS = 8;
        var COLS = 16;
        var data = Array.from({ length: ROWS }, function () {
            return Array.from({ length: COLS }, function () {
                return 0;
            });
        });

        if (isMoundData(glyphData)) {
            data = glyphData;
        }

        var ctx = canvas.getContext("2d");
        var WIDTH = canvas.width;
        var HEIGHT = canvas.height;
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#bfc7d5";
        var colWidth = WIDTH / COLS;
        var rowHeight = HEIGHT / ROWS;

        for (var r = 0; r < ROWS; r++) {
            var baseY = r * rowHeight + rowHeight / 2;
            ctx.beginPath();
            for (var c = 0; c < COLS; c++) {
                var h = data[r][c];
                var hNext = c < COLS - 1 ? data[r][c + 1] : null;
                var x0 = c * colWidth;
                var x1 = x0 + colWidth;
                var midX = (x0 + x1) / 2;
                var yPeak = baseY - h * (rowHeight * 0.35);
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

    function renderGlyphThumbnail(canvas, glyphData, editorType, pixelOptions) {
        if (editorType === "pixel") {
            renderPixelThumbnail(canvas, glyphData, pixelOptions);
            return;
        }
        renderMoundThumbnail(canvas, glyphData);
    }

    function getCurrentProductId() {
        var node = document.getElementById("product-data");
        if (!node) return "";
        try {
            var data = JSON.parse(node.textContent || "{}");
            return data && data.id ? String(data.id) : "";
        } catch (err) {
            return "";
        }
    }

    function getPixelGridOptions(instance) {
        if (!instance || instance.editorType !== "pixel") {
            return { rows: 16, cols: 16 };
        }
        if (instance.isBackpack) {
            return { rows: 32, cols: 16 };
        }
        return { rows: 16, cols: 16 };
    }

    function syncThumbCanvasAspect(instance) {
        if (!instance || instance.editorType !== "pixel") {
            return;
        }
        var pixelOptions = getPixelGridOptions(instance);
        var cols = Number(pixelOptions.cols) || 16;
        var rows = Number(pixelOptions.rows) || 16;
        var scale = 8;

        instance.canvas.width = cols * scale;
        instance.canvas.height = rows * scale;
        instance.canvas.style.height = "100%";
        instance.canvas.style.width = "auto";
        instance.canvas.style.maxWidth = "100%";
    }

    function initGlyphEditor() {
        var toggles = document.querySelectorAll("[data-glyph-toggle]");
        if (!toggles.length) return;

        var instances = [];
        var pageProductId = getCurrentProductId();
        Array.prototype.forEach.call(toggles, function (toggle) {
            var root = toggle.closest(".attribute") || document;
            var thumb = root.querySelector("[data-glyph-thumb]");
            var canvas = root.querySelector("[data-glyph-canvas]");
            if (!thumb || !canvas) return;
            var bundleRoot = toggle.closest("[data-bundle-item]");
            var bundleItemId = bundleRoot
                ? String(bundleRoot.getAttribute("data-bundle-item") || "")
                : "";
            var isBackpack =
                bundleItemId === "m8_backpack_1" ||
                (!bundleItemId && pageProductId === "m8_backpack_1");
            var editorType = toggle.getAttribute("data-glyph-editor") || "mound";
            var state = {
                enabled: false,
                data: null,
                editor: editorType,
            };
            if (editorType === "pixel" && !isPixelData(state.data)) {
                state.data = null;
            }
            if (editorType !== "pixel" && !isMoundData(state.data)) {
                state.data = null;
            }
            instances.push({
                toggle: toggle,
                thumb: thumb,
                canvas: canvas,
                editorType: editorType,
                isBackpack: isBackpack,
                state: state,
            });
            toggle._glyphState = state;
        });

        if (!instances.length) return;

        var activeInstance = instances[0];
        glyphState = activeInstance.state;
        PorchLogic.glyph.state = glyphState;

        function renderThumb(instance) {
            syncThumbCanvasAspect(instance);
            var pixelOptions = getPixelGridOptions(instance);
            renderGlyphThumbnail(
                instance.canvas,
                instance.state.data,
                instance.editorType,
                pixelOptions
            );
        }

        function syncGlyphUI(instance) {
            var enabled = instance.state.enabled;
            instance.toggle.classList.toggle("is-on", enabled);
            instance.toggle.setAttribute("aria-pressed", String(enabled));
            instance.thumb.classList.toggle("is-disabled", !enabled);
            instance.thumb.setAttribute("aria-disabled", String(!enabled));
            instance.thumb.tabIndex = enabled ? 0 : -1;
            syncThumbCanvasAspect(instance);
            if (enabled) renderThumb(instance);
        }

        function closeGlyphEditor() {
            var glyphModal = document.getElementById("glyph-modal");
            if (!glyphModal) return;
            glyphModal.classList.add("hidden");
            glyphModal.classList.remove("visible");
            glyphModal.classList.remove("glyph-modal--pixel");
        }

        function openGlyphEditor(instance) {
            var glyphModal = document.getElementById("glyph-modal");
            var glyphModalEditor = document.getElementById("glyph-modal-editor");
            if (!glyphModal || !glyphModalEditor) return;

            activeInstance = instance;
            glyphState = instance.state;
            PorchLogic.glyph.state = glyphState;

            glyphModal.classList.remove("hidden");
            glyphModal.classList.add("visible");

            var titleEl = glyphModal.querySelector("h2");
            var subtitleEl = glyphModal.querySelector(".glyph-modal-subtitle");
            if (instance.editorType === "pixel") {
                glyphModal.classList.add("glyph-modal--pixel");
                var pixelOptions = getPixelGridOptions(instance);
                if (titleEl) titleEl.textContent = "";
                if (subtitleEl) subtitleEl.textContent = "";
            } else {
                glyphModal.classList.remove("glyph-modal--pixel");
                if (titleEl) titleEl.textContent = "Custom AM8 Glyph";
                if (subtitleEl) subtitleEl.textContent = "Sculpt your glyph by clicking and dragging.";
            }

            var attach =
                instance.editorType === "pixel" ? attachPixelGrid : attachMoundGrid;
            var pixelOptions = getPixelGridOptions(instance);
            attach("m8-product-config", glyphModalEditor, instance.state.data || null, {
                rows: pixelOptions.rows,
                cols: pixelOptions.cols,
                onDataChange: function (data) {
                    instance.state.data = data;
                    glyphState = instance.state;
                    PorchLogic.glyph.state = glyphState;
                },
                onThumbnailUpdate: function (data) {
                    instance.state.data = data;
                    glyphState = instance.state;
                    PorchLogic.glyph.state = glyphState;
                    renderThumb(instance);
                },
            });
        }

        instances.forEach(function (instance) {
            instance.toggle.addEventListener("click", function () {
                instance.state.enabled = !instance.state.enabled;
                syncGlyphUI(instance);
            });

            instance.thumb.addEventListener("click", function () {
                if (!instance.state.enabled) return;
                openGlyphEditor(instance);
            });

            syncGlyphUI(instance);
        });

        var glyphModal = document.getElementById("glyph-modal");
        if (glyphModal) {
            glyphModal.addEventListener("click", function (event) {
                if (event.target === glyphModal) {
                    closeGlyphEditor();
                }
            });
        }

        var closeBtn = document.querySelector(".glyph-modal-close");
        if (closeBtn) {
            closeBtn.addEventListener("click", closeGlyphEditor);
        }

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closeGlyphEditor();
            }
        });
    }

    PorchLogic.glyph = {
        state: glyphState,
        init: initGlyphEditor,
        renderThumbnail: renderGlyphThumbnail,
    };

    global.PorchLogic = PorchLogic;
})(window);

/* init.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};

    PorchLogic.ready(function () {
        if (PorchLogic.cartStore) {
            PorchLogic.cartStore.updateCount();
        }

        if (PorchLogic.initCarousel) {
            PorchLogic.initCarousel(document.querySelector("[data-carousel]"));
        }

        if (PorchLogic.initChoiceChips) {
            PorchLogic.initChoiceChips();
        }

        if (PorchLogic.cartPopup) {
            PorchLogic.cartPopup.init();
        }

        if (PorchLogic.glyph) {
            PorchLogic.glyph.init();
        }

        if (PorchLogic.productPage) {
            PorchLogic.productPage.init();
        }

        if (PorchLogic.cartPage) {
            PorchLogic.cartPage.init();
        }

        if (PorchLogic.checkoutPage) {
            PorchLogic.checkoutPage.init();
        }

        if (PorchLogic.stripeReturnPage) {
            PorchLogic.stripeReturnPage.init();
        }
    });

    global.PorchLogic = PorchLogic;
})(window);

/* product_page.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};
    function resolveApiBase() {
        try {
            var host = global.location && global.location.hostname;
            if (host === "localhost" || host === "127.0.0.1") {
                return "http://localhost:4242";
            }
        } catch (err) {
            // fall back to production base
        }
        return "https://api.porchlogic.com";
    }
    var API_BASE = resolveApiBase();

    function titleCase(value) {
        return String(value || "")
            .replace(/[_-]+/g, " ")
            .trim()
            .replace(/\b\w/g, function (match) {
                return match.toUpperCase();
            });
    }

    function getProductData() {
        var node = document.getElementById("product-data");
        if (!node) return null;
        try {
            return JSON.parse(node.textContent || "{}");
        } catch (err) {
            return null;
        }
    }

    function collectSelectionsFor(product, root) {
        var selections = {};
        if (!product || !product.attributes) return selections;
        var scope = root || document;

        Object.keys(product.attributes).forEach(function (key) {
            var def = product.attributes[key] || {};
            var type = def.type || (key === "cargo_size" ? "cargo_size" : "");
            if (!type) return;
            if (type === "info_list") return;

            var value = null;
            var select = null;
            var toggle = null;
            if (type === "fixed") {
                value = def.value;
            } else if (type === "options") {
                var selected = scope.querySelector(
                    '[data-attribute="' + key + '"][aria-pressed="true"]'
                );
                if (selected && selected.dataset && selected.dataset.value) {
                    value = selected.dataset.value;
                } else if (Array.isArray(def.options) && def.options.length) {
                    value = def.options[0];
                }
            } else if (type === "toggle") {
                toggle = scope.querySelector('[data-attribute="' + key + '"]');
                if (toggle && toggle._glyphState) {
                    value = !!toggle._glyphState.enabled;
                } else {
                    value = toggle ? toggle.getAttribute("aria-pressed") === "true" : false;
                }
            } else if (type === "select") {
                select = scope.querySelector("select[data-attribute=\"" + key + "\"]");
                value = select ? select.value : null;
            } else if (type === "cargo_size") {
                value = readCargoSizeFor(def, scope);
            } else if (type === "inquiry") {
                value = readInquiryFor(def, scope);
            }

            var selection = {
                type: type,
                value: value,
            };
            if (type === "select" && select && select.selectedOptions && select.selectedOptions[0]) {
                selection.label = select.selectedOptions[0].textContent || "";
            }
            if (type === "toggle" && toggle && toggle._glyphState) {
                selection.data = toggle._glyphState.enabled ? toggle._glyphState.data : null;
                selection.editor = toggle._glyphState.editor || null;
            }
            selections[key] = selection;
        });

        return selections;
    }

    function getCargoSizeMax(def, field, fallback) {
        var raw = def && def["max_" + field] !== undefined ? def["max_" + field] : fallback;
        var value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    function getCargoSizeFallback(field) {
        if (field === "width") return 80;
        if (field === "height") return 123;
        if (field === "thickness") return 15;
        return 9999;
    }

    function getCargoInputMax(input, def, field) {
        var attrMax = Number(input && input.max);
        if (Number.isFinite(attrMax)) {
            return attrMax;
        }
        return getCargoSizeMax(def, field, getCargoSizeFallback(field));
    }

    function setCargoRangeState(input, isOverMax) {
        var field = input && input.closest ? input.closest(".cargo-size__field") : null;
        if (!field) return;
        field.classList.toggle("is-out-of-range", !!isOverMax);
    }

    function readCargoSizeFor(def, root) {
        var scope = root || document;
        var payload = {};
        ["width", "height", "thickness"].forEach(function (field) {
            var input = scope.querySelector(
                '.cargo-size__input[data-attribute="' + field + '"]'
            );
            var max = getCargoInputMax(input, def, field);
            var value = Number(input ? input.value : def && def[field]);
            if (!Number.isFinite(value)) {
                value = 0;
            }
            var clamped = Math.min(max, Math.max(0, value));
            payload[field] = clamped;
            if (input) {
                input.value = String(clamped);
                setCargoRangeState(input, false);
            }
        });
        return payload;
    }

    function readInquiryFor(def, root) {
        var scope = root || document;
        if (!def || !Array.isArray(def.fields)) {
            return null;
        }
        var payload = {};
        var hasValue = false;
        def.fields.forEach(function (field) {
            var name = field && field.name ? String(field.name) : "";
            if (!name) return;
            var input =
                scope.querySelector("#" + name) ||
                scope.querySelector('[name="' + name + '"]');
            if (!input) return;
            var value = String(input.value || "").trim();
            payload[name] = value;
            if (value) hasValue = true;
        });
        return hasValue ? payload : null;
    }

    function collectAddOns(product) {
        if (!product || !product.add_ons) return null;
        var addons = {};
        if (product.add_ons.keycaps) {
            var counts = {};
            var steppers = document.querySelectorAll(".stepper[data-keycap]");
            Array.prototype.forEach.call(steppers, function (stepper) {
                var color = stepper.dataset ? stepper.dataset.keycap : "";
                var input = stepper.querySelector(".stepper__input");
                var count = input ? Number(input.value || 0) : 0;
                if (color && count > 0) {
                    counts[color] = count;
                }
            });
            addons.keycaps = {
                counts: counts,
                price_each: product.add_ons.keycaps.price_each || 0,
                product_ids: product.add_ons.keycaps.product_ids || [],
            };
        }
        return addons;
    }

    function buildKeycapItems(product) {
        if (!product || !product.add_ons || !product.add_ons.keycaps) return [];
        var priceEach = Number(product.add_ons.keycaps.price_each || 0);
        var counts = getKeycapCounts();
        var ids = product.add_ons.keycaps.product_ids || [];
        var colors = product.add_ons.keycaps.colors || [];
        var items = [];

        colors.forEach(function (color, index) {
            var key = String(color || "").toLowerCase();
            var count = Number(counts[key] || 0);
            if (!count) return;
            var id = ids[index] || ("keycaps_" + key);
            items.push({
                product_id: id,
                name: "Keycaps - " + titleCase(color),
                price: priceEach,
                quantity: count,
                attributes: {
                    color: { type: "fixed", value: titleCase(color) },
                },
                add_ons: null,
                includes: null,
            });
        });

        return items;
    }

    function formatMoney(value) {
        var amount = Number(value || 0);
        if (!Number.isFinite(amount)) return "$0";
        var display = amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2);
        return "$" + display;
    }

    function normalizeVariantMap(variants) {
        if (!variants) return {};
        var map = {};

        if (Array.isArray(variants)) {
            variants.forEach(function (entry) {
                if (typeof entry === "string") {
                    map[String(entry)] = {};
                    return;
                }
                if (!entry || typeof entry !== "object") {
                    return;
                }
                Object.keys(entry).forEach(function (key) {
                    var value = entry[key];
                    map[String(key)] =
                        value && typeof value === "object" ? value : {};
                });
            });
            return map;
        }

        if (typeof variants === "object") {
            Object.keys(variants).forEach(function (key) {
                var value = variants[key];
                map[String(key)] =
                    value && typeof value === "object" ? value : {};
            });
        }

        return map;
    }

    function resolveBasePrice(product, selections) {
        var fallback = Number(product && product.price ? product.price : 0);
        if (!product) return fallback;
        var selectedVariant =
            selections &&
            selections.variant &&
            selections.variant.value !== null &&
            selections.variant.value !== undefined
                ? String(selections.variant.value)
                : null;
        if (!selectedVariant) return fallback;

        var variantMap = normalizeVariantMap(product.variants);
        var variantDef = variantMap[selectedVariant];
        if (!variantDef || typeof variantDef !== "object") return fallback;

        var variantPrice = Number(variantDef.price);
        return Number.isFinite(variantPrice) ? variantPrice : fallback;
    }

    function getKeycapCounts() {
        var steppers = document.querySelectorAll(".stepper[data-keycap]");
        var counts = {};
        Array.prototype.forEach.call(steppers, function (stepper) {
            var color = stepper.dataset ? stepper.dataset.keycap : "";
            var input = stepper.querySelector(".stepper__input");
            var count = input ? Number(input.value || 0) : 0;
            if (color) counts[String(color).toLowerCase()] = count;
        });
        return counts;
    }

    function calcKeycapTotal(product) {
        if (!product || !product.add_ons || !product.add_ons.keycaps) return 0;
        var priceEach = Number(product.add_ons.keycaps.price_each || 0);
        var counts = getKeycapCounts();
        return Object.keys(counts).reduce(function (sum, key) {
            return sum + Number(counts[key] || 0) * priceEach;
        }, 0);
    }

    function getGlyphSurchargeDef(item) {
        return item &&
            item.attributes &&
            item.attributes.custom_glyph &&
            item.attributes.custom_glyph.surcharge
            ? item.attributes.custom_glyph.surcharge
            : null;
    }

    function isGlyphSurchargeSelected(selections) {
        return !!(
            selections &&
            selections.custom_glyph &&
            selections.custom_glyph.value
        );
    }

    function resolveGlyphSurchargePrice(def) {
        var price = Number(def && def.price);
        return Number.isFinite(price) ? price : 6;
    }

    function resolveGlyphSurchargeProductId(def) {
        if (def && def.product_id) return String(def.product_id);
        return "m8_full_length_glyph_1";
    }

    function resolveGlyphSurchargeName(def) {
        if (def && def.name) return String(def.name);
        return "Full-length Custom Glyph";
    }

    function findBundleDefinition(product, bundleId) {
        if (!product || !Array.isArray(product.includes)) return null;
        for (var i = 0; i < product.includes.length; i += 1) {
            if (product.includes[i] && product.includes[i].id === bundleId) {
                return product.includes[i];
            }
        }
        return null;
    }

    function calcGlyphSurchargeTotal(product) {
        if (!product) return 0;
        var total = 0;

        if (product.type === "kit" && Array.isArray(product.includes)) {
            var bundleSections = document.querySelectorAll("[data-bundle-item]");
            Array.prototype.forEach.call(bundleSections, function (section) {
                var bundleId = section.getAttribute("data-bundle-item") || "";
                var bundleDef = findBundleDefinition(product, bundleId);
                if (!bundleDef) return;
                var selections = collectSelectionsFor(bundleDef, section);
                if (!isGlyphSurchargeSelected(selections)) return;
                var surchargeDef = getGlyphSurchargeDef(bundleDef);
                if (!surchargeDef) return;
                total += resolveGlyphSurchargePrice(surchargeDef);
            });
            return total;
        }

        var selections = collectSelectionsFor(product, document);
        if (!isGlyphSurchargeSelected(selections)) return 0;
        var surchargeDef = getGlyphSurchargeDef(product);
        if (!surchargeDef) return 0;
        return resolveGlyphSurchargePrice(surchargeDef);
    }

    function buildGlyphSurchargeItems(product) {
        if (!product) return [];
        var items = [];

        if (product.type === "kit" && Array.isArray(product.includes)) {
            var bundleSections = document.querySelectorAll("[data-bundle-item]");
            Array.prototype.forEach.call(bundleSections, function (section) {
                var bundleId = section.getAttribute("data-bundle-item") || "";
                var bundleDef = findBundleDefinition(product, bundleId);
                if (!bundleDef) return;
                var selections = collectSelectionsFor(bundleDef, section);
                if (!isGlyphSurchargeSelected(selections)) return;
                var def = getGlyphSurchargeDef(bundleDef);
                if (!def) return;
                items.push({
                    product_id: resolveGlyphSurchargeProductId(def),
                    name: resolveGlyphSurchargeName(def),
                    price: resolveGlyphSurchargePrice(def),
                    quantity: 1,
                    attributes: null,
                    add_ons: null,
                    includes: null,
                });
            });
            return items;
        }

        var selections = collectSelectionsFor(product, document);
        if (!isGlyphSurchargeSelected(selections)) return items;
        var def = getGlyphSurchargeDef(product);
        if (!def) return items;
        items.push({
            product_id: resolveGlyphSurchargeProductId(def),
            name: resolveGlyphSurchargeName(def),
            price: resolveGlyphSurchargePrice(def),
            quantity: 1,
            attributes: null,
            add_ons: null,
            includes: null,
        });
        return items;
    }

    function updatePriceDisplay(product) {
        var priceEl = document.querySelector(".price");
        if (!priceEl) return;
        var selections = collectSelectionsFor(product, document);
        var base = resolveBasePrice(product, selections);
        var total = base + calcKeycapTotal(product) + calcGlyphSurchargeTotal(product);
        priceEl.textContent = formatMoney(total);
    }

    function clamp(value, min, max) {
        var num = Number(value || 0);
        if (!Number.isFinite(num)) num = 0;
        return Math.min(max, Math.max(min, num));
    }

    function syncStepperRow(row, value) {
        if (!row) return;
        row.classList.toggle("is-zero", Number(value || 0) <= 0);
    }

    function initKeycapSteppers(product) {
        var steppers = Array.prototype.slice.call(
            document.querySelectorAll(".stepper[data-keycap]")
        );
        if (!steppers.length) return;

        steppers.forEach(function (stepper) {
            var input = stepper.querySelector(".stepper__input");
            if (!input) return;
            var row = stepper.closest(".keycaps__row");
            var min = Number(input.min || 0);
            var max = Number(input.max || 99);

            function setValue(next) {
                var value = clamp(next, min, max);
                input.value = String(value);
                syncStepperRow(row, value);
            }

            stepper.addEventListener("click", function (event) {
                var target = event.target;
                if (!target || !target.matches(".stepper__btn")) return;
                var step = Number(target.getAttribute("data-step") || 0);
                setValue(Number(input.value || 0) + step);
                updatePriceDisplay(product);
            });

            input.addEventListener("change", function () {
                setValue(input.value);
                updatePriceDisplay(product);
            });

            setValue(input.value);
        });
    }

    function initPriceUpdates(product) {
        if (!product) return;
        var controls = document.querySelectorAll(
            '.chip[data-attribute="variant"], [data-attribute="custom_glyph"]'
        );
        if (!controls.length) return;
        Array.prototype.forEach.call(controls, function (button) {
            button.addEventListener("click", function () {
                updatePriceDisplay(product);
            });
        });
    }

    function getSelectedChoiceValue(attribute, root) {
        var scope = root || document;
        var selected = scope.querySelector(
            '.chip[data-attribute="' + attribute + '"][aria-pressed="true"]'
        );
        if (selected && selected.dataset && selected.dataset.value !== undefined) {
            return String(selected.dataset.value);
        }
        return "";
    }

    function initConditionalAttributes() {
        var conditionals = Array.prototype.slice.call(
            document.querySelectorAll("[data-show-when-attribute][data-show-when-value]")
        );
        if (!conditionals.length) return;

        var update = function () {
            conditionals.forEach(function (node) {
                var attribute = node.getAttribute("data-show-when-attribute") || "";
                var expected = node.getAttribute("data-show-when-value") || "";
                var actual = getSelectedChoiceValue(attribute, document);
                node.classList.toggle("hidden", actual !== expected);
            });
        };

        var choiceButtons = document.querySelectorAll(".chip[data-attribute]");
        Array.prototype.forEach.call(choiceButtons, function (button) {
            button.addEventListener("click", update);
        });

        update();
    }

    function initCargoSizeInputs() {
        var inputs = Array.prototype.slice.call(
            document.querySelectorAll(".cargo-size__input[data-attribute]")
        );
        if (!inputs.length) {
            return;
        }

        inputs.forEach(function (input) {
            var field = input.dataset ? input.dataset.attribute : "";
            if (!field) return;
            var max = getCargoInputMax(input, null, field);
            var normalize = function (clampNow) {
                var value = Number(input.value);
                var hasNumber = Number.isFinite(value);
                var overMax = hasNumber && value > max;
                setCargoRangeState(input, overMax);
                if (!clampNow) {
                    return;
                }
                if (!hasNumber) {
                    value = 0;
                }
                var clamped = Math.min(max, Math.max(0, value));
                input.value = String(clamped);
                setCargoRangeState(input, false);
            };

            input.addEventListener("input", function () {
                normalize(false);
            });
            input.addEventListener("change", function () {
                normalize(true);
            });
            input.addEventListener("blur", function () {
                normalize(true);
            });
            normalize(true);
        });
    }

    function initAddToCart() {
        var button = document.getElementById("add-to-cart");
        if (!button) return;
        var product = getProductData();
        if (!product) return;

        button.addEventListener("click", function () {
            if (button.disabled) return;
            var keycapItems = buildKeycapItems(product);
            var glyphSurchargeItems = buildGlyphSurchargeItems(product);
            var bundleItems = [];

            if (product.type === "kit" && Array.isArray(product.includes)) {
                var bundleSections = document.querySelectorAll("[data-bundle-item]");
                Array.prototype.forEach.call(bundleSections, function (section) {
                    var bundleId = section.getAttribute("data-bundle-item") || "";
                    var bundleDef = null;
                    for (var i = 0; i < product.includes.length; i += 1) {
                        if (product.includes[i] && product.includes[i].id === bundleId) {
                            bundleDef = product.includes[i];
                            break;
                        }
                    }
                    if (!bundleDef) return;
                    bundleItems.push({
                        product_id: bundleDef.id,
                        name: bundleDef.name,
                        price: bundleDef.price,
                        quantity: 1,
                        add_ons: null,
                        attributes: collectSelectionsFor(bundleDef, section),
                        includes: null,
                    });
                });
            }
            var item = {
                product_id: product.id || product.name,
                name: product.name,
                price: resolveBasePrice(
                    product,
                    collectSelectionsFor(product, document)
                ),
                quantity: 1,
                attributes: collectSelectionsFor(product, document),
                add_ons: keycapItems.length ? null : collectAddOns(product),
                includes: bundleItems.length ? bundleItems : null,
            };

            if (!PorchLogic.cartStore) return;
            var items = PorchLogic.cartStore.get();
            items.push(item);
            keycapItems.forEach(function (addonItem) {
                items.push(addonItem);
            });
            glyphSurchargeItems.forEach(function (surchargeItem) {
                items.push(surchargeItem);
            });
            PorchLogic.cartStore.set(items);
            PorchLogic.cartStore.updateCount();
            if (PorchLogic.cartPopup) {
                PorchLogic.cartPopup.show(product.name + " added to cart.");
            }
        });
    }

    PorchLogic.productPage = {
        init: function () {
            var product = getProductData();
            initKeycapSteppers(product);
            initPriceUpdates(product);
            initConditionalAttributes();
            initCargoSizeInputs();
            if (product) {
                updatePriceDisplay(product);
            }
            initBatteryInquiry();
            initBatteryModelGuard();
            initAddToCart();
        },
    };

    global.PorchLogic = PorchLogic;

    function initBatteryInquiry() {
        var brandInput = document.getElementById("battery-brand");
        var modelInput = document.getElementById("battery-model-name");
        var emailInput = document.getElementById("battery-email");
        var submitBtn = document.getElementById("inquiry-submit");
        var statusEl = document.getElementById("inquiry-status");

        if (!brandInput || !modelInput || !emailInput || !submitBtn || !statusEl) {
            return;
        }

        var setStatus = function (message, isError) {
            statusEl.textContent = message;
            statusEl.style.color = isError ? "#9a2f2f" : "";
        };

        submitBtn.addEventListener("click", function () {
            var payload = {
                brand: brandInput.value.trim(),
                model: modelInput.value.trim(),
                email: emailInput.value.trim(),
            };

            if (!payload.brand || !payload.model || !payload.email) {
                setStatus("Please fill out brand, model, and email.", true);
                return;
            }

            submitBtn.disabled = true;
            setStatus("Sending request...", false);

            fetch(API_BASE + "/battery-model-inquiry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error("Request failed");
                    }
                    setStatus("Thanks! We will email you soon.", false);
                    brandInput.value = "";
                    modelInput.value = "";
                    emailInput.value = "";
                    statusEl.dataset.submitted = "true";
                })
                .catch(function () {
                    setStatus("Could not send. Please try again.", true);
                })
                .finally(function () {
                    submitBtn.disabled = false;
                });
        });
    }

    function isCustomBatterySelection(select) {
        if (!select) return false;
        var value = String(select.value || "").toLowerCase();
        if (value === "model-02" || value === "custom") return true;
        var label =
            select.selectedOptions && select.selectedOptions[0]
                ? String(select.selectedOptions[0].textContent || "").toLowerCase()
                : "";
        return label.includes("custom");
    }

    function initBatteryModelGuard() {
        var select = document.querySelector('select[data-attribute="battery_model"]');
        var button = document.getElementById("add-to-cart");
        var statusEl = document.getElementById("inquiry-status");
        if (!select || !button) return;

        var updateState = function () {
            var isCustom = isCustomBatterySelection(select);
            button.disabled = isCustom;
            if (statusEl && !statusEl.dataset.submitted) {
                statusEl.textContent = isCustom
                    ? "Custom battery requests must be approved before ordering."
                    : "";
            }
        };

        select.addEventListener("change", updateState);
        updateState();
    }
})(window);

/* stripe_return.js */
(function (global) {
    var PorchLogic = global.PorchLogic || {};
    function resolveApiBase() {
        try {
            var host = global.location && global.location.hostname;
            if (host === "localhost" || host === "127.0.0.1") {
                return "http://localhost:4242";
            }
        } catch (err) {
            // fall back to production base
        }
        return "https://api.porchlogic.com";
    }
    var API_BASE = resolveApiBase();

    function getSessionId() {
        try {
            var params = new URLSearchParams(global.location.search);
            return params.get("session_id");
        } catch (err) {
            return null;
        }
    }

    function setStatus(statusEl, detailEl, text, detail, isError) {
        if (statusEl) statusEl.textContent = text || "";
        if (detailEl) detailEl.textContent = detail || "";
        if (statusEl) statusEl.style.color = isError ? "#a53c3c" : "";
    }

    function renderActivationCodes(container, codes) {
        if (!container) return;
        if (!Array.isArray(codes) || !codes.length) {
            container.innerHTML = "";
            container.classList.add("hidden");
            return;
        }
        var items = codes
            .map(function (code) {
                return "<li>" + code + "</li>";
            })
            .join("");
        container.innerHTML =
            "<h3>Activation codes</h3><ul class=\"activation-codes__list\">" +
            items +
            "</ul>";
        container.classList.remove("hidden");
    }

    function initReturnPage() {
        var statusEl = document.getElementById("order-status");
        var detailEl = document.getElementById("order-detail");
        var codesEl = document.getElementById("activation-codes");
        var sessionId = getSessionId();

        if (!sessionId) {
            setStatus(
                statusEl,
                detailEl,
                "We couldn't find your session.",
                "Please return to the shop and try again.",
                true
            );
            return;
        }

        setStatus(statusEl, detailEl, "Checking payment status…", "", false);

        fetch(API_BASE + "/session-status?session_id=" + encodeURIComponent(sessionId))
            .then(function (res) {
                if (!res.ok) {
                    throw new Error("Request failed");
                }
                return res.json();
            })
            .then(function (data) {
                var status = data && data.status ? data.status : "unknown";
                if (status === "complete") {
                    setStatus(
                        statusEl,
                        detailEl,
                        "Payment complete.",
                        "Your order is confirmed. A receipt is on the way.",
                        false
                    );
                } else if (status === "open") {
                    setStatus(
                        statusEl,
                        detailEl,
                        "Payment still open.",
                        "You can complete checkout from your email receipt.",
                        true
                    );
                } else {
                    setStatus(
                        statusEl,
                        detailEl,
                        "Payment status: " + status,
                        "If you need help, contact support.",
                        true
                    );
                }

                renderActivationCodes(codesEl, data ? data.activation_codes : []);
            })
            .catch(function () {
                setStatus(
                    statusEl,
                    detailEl,
                    "We couldn't load your order status.",
                    "Please refresh or contact support.",
                    true
                );
            });
    }

    PorchLogic.stripeReturnPage = {
        init: initReturnPage,
    };

    global.PorchLogic = PorchLogic;
})(window);
