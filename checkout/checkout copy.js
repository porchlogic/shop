// Publishable Stripe API keys
const STRIPE_KEYS = {
    live: "pk_live_51J3mlbABTHjSuIhXgQq9s0XUfm1Fgnao9DnO29jF1hf4LpKh129cDDOpwiQRptEx7QlkcrnpHTfa3OQX30wHI4mB00NgdoLrSr",
    test: "pk_test_51SadSnPADwDYgfnv3uZarRIVlDlx9waCCBQqaU0RLeRm9sN8ux3MdShacex3tPVHR7Qh3heZJwXI55rz9egsnX7y00M18XjPVQ",
};

const THIS_API_BASE = "https://api.porchlogic.com";
const TEST_MODE_KEY = "porchlogic_checkout_test_mode";
let stripe = null;
let checkout = null;
let selectedShipping = null;
let testModeEnabled = true;
const testModeBanner = document.getElementById("test-mode-banner");

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
    } catch (e) {
        console.warn("Could not persist test mode state:", e);
    }

    if (checkout) {
        window.location.reload();
        return;
    }

    stripe = Stripe(getStripeKey());
}

function initTestMode() {
    try {
        testModeEnabled = sessionStorage.getItem(TEST_MODE_KEY) === "1";
    } catch (e) {
        console.warn("Could not read stored test mode state:", e);
        testModeEnabled = false;
    }
    applyTestModeBanner();
    stripe = Stripe(getStripeKey());
    if (testModeEnabled) {
        console.log("🧪 Test mode enabled. Using Stripe test key.");
    }
}

document.addEventListener("keydown", (event) => {
    const isToggle =
        (event.key === "t" || event.key === "T") &&
        // event.ctrlKey &&
        event.shiftKey;
    if (!isToggle) return;
    event.preventDefault();
    setTestMode(!testModeEnabled);
});

initTestMode();

// ---- helpers that depend on checkout (guarded) ----

const validateEmail = async (email) => {
    if (!checkout) {
        return { isValid: false, message: "Checkout not initialized yet." };
    }
    const updateResult = await checkout.updateEmail(email);
    const isValid = updateResult.type !== "error";
    return { isValid, message: !isValid ? updateResult.error.message : null };
};

const paymentFormEl = document.querySelector("#payment-form");
if (paymentFormEl) {
    paymentFormEl.addEventListener("submit", handleSubmit);
}

// Kick off once this file is loaded (on checkout page)
initialize().catch(err => {
    console.error("❌ Failed to initialize checkout:", err);
});
// ---- shipping ----
function formatCurrencyFromMinor(amountMinor, divisor) {
    if (typeof amountMinor !== "number") return "$0.00";
    const value = amountMinor / (divisor || 100);
    return `$${value.toFixed(2)}`;
}

// Simple label mapping based on the cents amount we configured server-side.
function getFriendlyShippingName(amountMinor) {
    switch (amountMinor) {
        case 600:
            return "US Economy (3–7 days)";
        case 1000:
            return "US Priority (2–3 days)";
        case 2000:
            return "International Economy (2–4 weeks)";
        default:
            return "Shipping";
    }
}

// Update the order summary + button label from Stripe's session totals
function updateSummaryFromSession(session) {
    const divisor = session.minorUnitsAmountDivisor || 100;

    const subtotalMinor = session.total?.subtotal?.amount ?? 0;
    const totalMinor = session.total?.total?.amount ?? subtotalMinor;
    const shippingOption = session.shipping?.shippingOption || null;

    const subtotalEl = document.querySelector("[data-cart-subtotal]");
    const shippingAmountEl = document.querySelector("[data-cart-shipping]");
    const shippingLabelEl = document.querySelector("[data-shipping-label]");
    const totalEl = document.querySelector("[data-cart-total]");
    const btnTextNode = document.querySelector("#button-text");
    const submitBtn = document.querySelector("#submit");

    if (subtotalEl) {
        subtotalEl.textContent = formatCurrencyFromMinor(subtotalMinor, divisor);
    }

    if (shippingAmountEl) {
        if (shippingOption?.minorUnitsAmount != null) {
            shippingAmountEl.textContent = formatCurrencyFromMinor(
                shippingOption.minorUnitsAmount,
                divisor
            );
        } else {
            shippingAmountEl.textContent = "$0.00";
        }
    }

    if (shippingLabelEl) {
        if (shippingOption) {
            const label = getFriendlyShippingName(
                shippingOption.minorUnitsAmount ?? 0
            );
            shippingLabelEl.textContent = label;
        } else {
            shippingLabelEl.textContent = "Choose option";
        }
    }

    if (totalEl) {
        totalEl.textContent = formatCurrencyFromMinor(totalMinor, divisor);
    }

    if (btnTextNode) {
        btnTextNode.textContent = `Pay ${formatCurrencyFromMinor(
            totalMinor,
            divisor
        )}`;
    }

    // Enable/disable the button based on Stripe's canConfirm flag
    if (submitBtn) {
        submitBtn.disabled = !session.canConfirm;
    }
}

// Render radio buttons for shipping options and wire them to Stripe
function renderShippingOptions(checkout, session) {
    const container = document.getElementById("shipping-options-container");
    if (!container) return;

    const options = session.shippingOptions || [];
    const divisor = session.minorUnitsAmountDivisor || 100;
    const selectedId = session.shipping?.shippingOption?.id || null;

    container.innerHTML = "";

    if (!options.length) {
        const hint = document.createElement("p");
        hint.className = "shipping-hint";
        hint.textContent = "Enter your shipping address to see options.";
        container.appendChild(hint);
        return;
    }

    const hint = document.createElement("p");
    hint.className = "shipping-hint";
    hint.textContent = "Choose a shipping option:";
    container.appendChild(hint);

    options.forEach((opt, index) => {
        const id = opt.id;
        const amountMinor = opt.minorUnitsAmount;
        const amountLabel = opt.amount || formatCurrencyFromMinor(amountMinor, divisor);
        const friendlyName = getFriendlyShippingName(amountMinor);

        const row = document.createElement("label");
        row.className = "shipping-option";

        const input = document.createElement("input");
        input.type = "radio";
        input.name = "shipping-option";
        input.value = id;
        input.checked = selectedId
            ? selectedId === id
            : index === 0;

        input.addEventListener("change", async () => {
            try {
                await checkout.updateShippingOption(id);  // ✅ pass string, not object
            } catch (err) {
                console.error("Failed to update shipping option", err);
                showMessage("Could not update shipping. Please try again.");
            }
        });


        const info = document.createElement("div");
        info.className = "shipping-option__info";

        const nameSpan = document.createElement("span");
        nameSpan.className = "shipping-option__name";
        nameSpan.textContent = friendlyName;

        const metaSpan = document.createElement("span");
        metaSpan.className = "shipping-option__meta";
        metaSpan.textContent = "Rate applied at checkout";

        info.appendChild(nameSpan);
        info.appendChild(metaSpan);

        const priceSpan = document.createElement("span");
        priceSpan.className = "shipping-option__price";
        priceSpan.textContent = amountLabel;

        row.appendChild(input);
        row.appendChild(info);
        row.appendChild(priceSpan);

        container.appendChild(row);
    });
}



// ---- main init ----

async function initialize() {
    console.log("🛒 Initializing checkout…");
    console.log("🛒 Cart items (from sessionStorage):", getCartItems());

    const cartItems = getCartItems(); // from cart.js

    // If cart is empty, don't try to talk to Stripe at all
    if (!cartItems || cartItems.length === 0) {
        console.warn("🛒 No cart items, skipping checkout init.");
        return;
    }

    console.log(
        "➡️ Sending POST to /create-checkout-session:",
        JSON.stringify({ cartItems }, null, 2)
    );

    const promise = fetch(`${THIS_API_BASE}/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartItems }),
    }).then(async (res) => {
        let data = null;
        try {
            data = await res.json();
        } catch (e) {
            console.error(
                "❌ Non-JSON response from /create-checkout-session:",
                e
            );
            throw new Error("Server returned non-JSON response.");
        }

        // If HTTP status is not OK, surface and throw
        if (!res.ok) {
            console.error(
                "❌ /create-checkout-session HTTP error:",
                res.status,
                data
            );

            // Inventory special handling (matches your server.js)
            if (data && data.error === "InventoryError") {
                const msg = data.message || "Not enough inventory.";
                showInventoryError(data.itemId, msg);
                showMessage(msg);
                throw new Error(msg);
            }

            const msg =
                (data && (data.message || data.error)) ||
                "Checkout session failed. Please try again.";

            showMessage(msg);
            throw new Error(msg);
        }

        // Happy path: ensure clientSecret exists
        if (!data || typeof data.clientSecret !== "string") {
            console.error(
                "❌ No clientSecret in successful response:",
                data
            );
            showMessage(
                "Checkout session error. Please try again or contact support."
            );
            throw new Error("Missing clientSecret");
        }

        return data.clientSecret;
    });

    const appearance = {
        theme: "stripe",
        variables: {
            colorPrimary: "#111111",
            colorText: "#111111",
            colorBackground: "#f8f8f8",
            colorDanger: "#c0392b",
            borderRadius: "10px",
        },
    };

    // Hand the promise to Stripe's Custom Checkout
    checkout = await stripe.initCheckout({
        fetchClientSecret: () => promise,
        elementsOptions: { appearance },
    });

    const session = checkout.session();
    console.log("🔍 checkout.session():", session);

    // Initial render of shipping UI + summary based on current session
    renderShippingOptions(checkout, session);
    updateSummaryFromSession(session);

    // Keep UI in sync with Stripe when anything material changes (address, shipping, tax, etc.)
    checkout.on("change", (updatedSession) => {
        console.log("🔁 checkout change:", updatedSession);
        renderShippingOptions(checkout, updatedSession);
        updateSummaryFromSession(updatedSession);
    });

    // Email validation wiring
    const emailInput = document.getElementById("email");
    const emailErrors = document.getElementById("email-errors");

    if (emailInput && emailErrors) {
        emailInput.addEventListener("input", () => {
            emailErrors.textContent = "";
        });

        emailInput.addEventListener("blur", async () => {
            const newEmail = emailInput.value;
            if (!newEmail) return;

            const { isValid, message } = await validateEmail(newEmail);
            if (!isValid && message) {
                emailErrors.textContent = message;
            }
        });
    }

    // Stripe UI elements
    const paymentElement = checkout.createPaymentElement();
    paymentElement.mount("#payment-element");

    const shippingAddressElement = checkout.createShippingAddressElement();
    shippingAddressElement.mount("#shipping-address-element");
    // No custom logic needed here; address changes will trigger the checkout.on("change") handler.
}


// ---- submit handler ----

async function handleSubmit(e) {
    e.preventDefault();

    if (!checkout) {
        showMessage("Checkout is not ready yet. Please reload the page.");
        return;
    }

    setLoading(true);

    const emailInput = document.getElementById("email");
    const email = emailInput ? emailInput.value : "";

    const { isValid, message } = await validateEmail(email);
    if (!isValid) {
        if (message) showMessage(message);
        setLoading(false);
        return;
    }

    // Newsletter opt-in
    const subscribeCheckbox = document.getElementById("subscribe-checkbox");
    const subscribe = subscribeCheckbox ? subscribeCheckbox.checked : false;

    if (subscribe && email) {
        try {
            await fetch(`${THIS_API_BASE}/newsletter-signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email })
            });
        } catch (err) {
            console.warn("Newsletter signup failed:", err);
        }
    }

    // const shippingMethod = getSelectedShippingMethod();
    // if (!shippingMethod) {
    //     showMessage("Select a shipping option after entering your address.");
    //     setLoading(false);
    //     return;
    // }

    // Confirm with Stripe
    const { error } = await checkout.confirm();

    if (error) {
        showMessage(error.message);
        setLoading(false);
        return;
    }

    // On success, Stripe will redirect to YOUR_DOMAIN/stripe/return.html
}

// ---- shipping ----


// ---- inventory + UI helpers ----

function showInventoryError(itemId, message) {
    const itemRow = document.querySelector(`[data-cart-item-id="${itemId}"]`);
    if (itemRow) {
        const msg = document.createElement("div");
        msg.className = "item-error-message";
        msg.textContent = message;
        itemRow.appendChild(msg);
    }

    const submitBtn = document.querySelector("#submit");
    if (submitBtn) submitBtn.disabled = true;

    const spinner = document.querySelector("#spinner");
    if (spinner) spinner.classList.add("hidden");

    const btnText = document.querySelector("#button-text");
    if (btnText) {
        btnText.classList.remove("hidden");
        btnText.textContent = "Fix issues above";
    }
}

function showMessage(messageText) {
    const messageContainer = document.querySelector("#payment-message");
    if (!messageContainer) return;
    messageContainer.classList.remove("hidden");
    messageContainer.textContent = messageText;
    setTimeout(function () {
        messageContainer.classList.add("hidden");
        messageContainer.textContent = "";
    }, 4000);
}

function setLoading(isLoading) {
    const submitBtn = document.querySelector("#submit");
    const spinner = document.querySelector("#spinner");
    const btnText = document.querySelector("#button-text");

    if (!submitBtn || !spinner || !btnText) return;

    if (isLoading) {
        submitBtn.disabled = true;
        submitBtn.dataset.locked = "true";
        spinner.classList.remove("hidden");
        btnText.classList.add("hidden");
    } else {
        submitBtn.disabled = false;
        submitBtn.dataset.locked = "";
        spinner.classList.add("hidden");
        btnText.classList.remove("hidden");
    }
}
