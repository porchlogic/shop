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
let testModeEnabled = false;
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

    // Hit your existing backend exactly like before
    console.log("➡️ Sending POST to /create-checkout-session:", JSON.stringify({ cartItems }, null, 2));

    const shippingMethod = getSelectedShippingMethod();

    const promise = fetch(`${THIS_API_BASE}/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartItems, shippingMethod })
    }).then(async (res) => {
        let data = null;
        try {
            data = await res.json();
        } catch (e) {
            console.error("❌ Non-JSON response from /create-checkout-session:", e);
            throw new Error("Server returned non-JSON response.");
        }

        // If HTTP status is not OK, surface and throw
        if (!res.ok) {
            console.error("❌ /create-checkout-session HTTP error:", res.status, data);

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
            console.error("❌ No clientSecret in successful response:", data);
            showMessage("Checkout session error. Please try again or contact support.");
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
        elementsOptions: { appearance }
    });

    // Update button label with Stripe’s computed total, if available
    const btnTextNode = document.querySelector("#button-text");
    if (btnTextNode) {
        try {
            const session = checkout.session();
            const amountCents = session?.total?.total?.amount;
            if (typeof amountCents === "number") {
                const amountDollars = (amountCents / 100).toFixed(2);
                btnTextNode.textContent = `Pay $${amountDollars}`;
            } else {
                btnTextNode.textContent = "Pay";
            }
        } catch (e) {
            console.warn("⚠️ Could not read checkout.session().total:", e);
            btnTextNode.textContent = "Pay";
        }
    }

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
    shippingAddressElement.on("change", (event) => {
        const country = event?.value?.address?.country || null;
        handleShippingAddressChange(country);
    });

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

    const shippingMethod = getSelectedShippingMethod();
    if (!shippingMethod) {
        showMessage("Select a shipping option after entering your address.");
        setLoading(false);
        return;
    }

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

function setSubmitLockedByShipping(locked) {
    const submitBtn = document.getElementById("submit");
    if (!submitBtn) return;
    if (locked) {
        submitBtn.dataset.locked = "shipping";
        submitBtn.disabled = true;
        submitBtn.classList.add("is-disabled");
    } else {
        if (submitBtn.dataset.locked === "shipping") {
            delete submitBtn.dataset.locked;
        }
        updateCheckoutButtonState();
    }
}

function getSelectedShippingMethod() {
    const checked = document.querySelector('input[name="shipping_method"]:checked');
    if (!checked) return null;

    const amount = Number(checked.dataset.shippingAmount || 0);
    const label = checked.dataset.shippingLabel || checked.value;

    const method = { id: checked.value, label, amount };
    selectedShipping = method;
    return method;
}

function updateShippingTotals() {
    const method = getSelectedShippingMethod();
    window.CHECKOUT_SHIPPING_AMOUNT = method ? method.amount : 0;

    const labelEl = document.querySelector("[data-shipping-label]");
    const hintEl = document.querySelector("[data-shipping-hint]");
    const shippingSummary = document.querySelector("[data-cart-shipping]");

    if (labelEl) {
        labelEl.textContent = method ? method.label : "Enter address for options";
    }
    if (shippingSummary) {
        shippingSummary.textContent = formatMoney(method ? method.amount : 0);
    }
    if (hintEl) {
        hintEl.textContent = method
            ? "Shipping will be applied at checkout."
            : "Enter a shipping address to see available options.";
    }

    setSubmitLockedByShipping(!method);
    updateTotalsUI(undefined, method?.amount || 0);
}

function updateShippingVisibility(countryCode) {
    const region = countryCode === "US" ? "US" : countryCode ? "INTL" : null;
    const options = document.querySelectorAll("[data-shipping-option]");
    let firstVisibleInput = null;

    options.forEach((opt) => {
        const optionRegion = opt.dataset.region;
        const visible = region ? optionRegion === region : false;
        opt.classList.toggle("hidden", !visible);

        const input = opt.querySelector('input[name="shipping_method"]');
        if (input) {
            input.disabled = !visible;
            if (!visible && input.checked) {
                input.checked = false;
            }
            if (visible && !firstVisibleInput) {
                firstVisibleInput = input;
            }
        }
    });

    if (firstVisibleInput) {
        firstVisibleInput.checked = true;
    }

    updateShippingTotals();
}

function initShippingSelector() {
    const inputs = document.querySelectorAll('input[name="shipping_method"]');
    inputs.forEach((input) => {
        input.addEventListener("change", () => {
            updateShippingTotals();
        });
    });
    setSubmitLockedByShipping(true);
    updateShippingVisibility(null);
}

function handleShippingAddressChange(countryCode) {
    updateShippingVisibility(countryCode || null);
}

document.addEventListener("DOMContentLoaded", () => {
    initShippingSelector();
});

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
