// Publishable Stripe API keys
const STRIPE_KEYS = {
    live: "pk_live_51J3mlbABTHjSuIhXgQq9s0XUfm1Fgnao9DnO29jF1hf4LpKh129cDDOpwiQRptEx7QlkcrnpHTfa3OQX30wHI4mB00NgdoLrSr",
    test: "pk_test_51SadSnPADwDYgfnv3uZarRIVlDlx9waCCBQqaU0RLeRm9sN8ux3MdShacex3tPVHR7Qh3heZJwXI55rz9egsnX7y00M18XjPVQ",
};

const THIS_API_BASE = "https://api.porchlogic.com";
// const isLocal =
//     location.hostname === "localhost" ||
//     location.hostname === "127.0.0.1";
// const THIS_API_BASE = isLocal
//     ? "http://localhost:4242"
//     : "https://api.porchlogic.com";

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



// Kick off once this file is loaded (on checkout page)
initialize().catch(err => {
    console.error("❌ Failed to initialize checkout:", err);
});


async function initialize() {
    console.log("🛒 Initializing embedded checkout…");
    const cartItems = getCartItems();
    // Normalize glyph flags so backend receives an explicit true/false per item
    const preparedCartItems = (cartItems || []).map((item) => ({
        ...item,
        customGlyphEnabled: !!item.customGlyphEnabled,
        showOnLive: !!item.showOnLive,
    }));

    if (!preparedCartItems || preparedCartItems.length === 0) {
        console.warn("🛒 No cart items, skipping checkout init.");
        return;
    }

    const fetchClientSecret = async () => {
        const res = await fetch(`${THIS_API_BASE}/create-checkout-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                cartItems: preparedCartItems
            }),
        });

        let data;
        try {
            data = await res.json();
        } catch (e) {
            console.error("❌ Non-JSON response from /create-checkout-session:", e);
            showMessage("Server error. Please try again.");
            throw new Error("Server returned non-JSON response.");
        }

        if (!res.ok) {
            console.error("❌ /create-checkout-session HTTP error:", res.status, data);

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

        if (!data || typeof data.clientSecret !== "string") {
            console.error("❌ No clientSecret in successful response:", data);
            showMessage(
                "Checkout session error. Please try again or contact support."
            );
            throw new Error("Missing clientSecret");
        }
        
        // store session id so that newsletter signup can inform the backend
        window.activeCheckoutSessionId = data.sessionId;

        return data.clientSecret;
    };

    const onShippingDetailsChange = async ({ checkoutSessionId, shippingDetails }) => {
        try {
            console.log('trying');
            const res = await fetch(`${THIS_API_BASE}/calculate-shipping-options`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    checkout_session_id: checkoutSessionId,
                    shipping_details: shippingDetails,
                }),
            });

            const data = await res.json();

            console.log(data);

            if (data.type === "error") {
                return { type: "reject", errorMessage: data.message };
            }

            return { type: "accept" };
        } catch (err) {
            console.error("❌ /calculate-shipping-options error:", err);
            return {
                type: "reject",
                errorMessage: "We couldn't validate your address. Please try again.",
            };
        }
    };

    // 🔑 No elementsOptions / appearance here
    checkout = await stripe.initEmbeddedCheckout({
        fetchClientSecret,
        onShippingDetailsChange,
        onComplete: async (event) => {
            console.log("🔔 Stripe checkout complete event:", event);

            if (event?.status === "complete") {
                

                
                if (typeof clearCart === "function") {
                    clearCart();
                } else {
                    try {
                        sessionStorage.removeItem("porchlogic_cart");
                    } catch (err) {
                        console.warn("Could not clear cart after checkout complete:", err);
                    }
                }
            }
        },
    });

    checkout.mount("#checkout");

}

async function syncNewsletterPreference() {
    const subscribeCheckbox = document.getElementById("subscribe-checkbox");
    if (!subscribeCheckbox || !window.activeCheckoutSessionId) return;

    const subscribe = !!subscribeCheckbox.checked;

    try {
        await fetch(`${THIS_API_BASE}/newsletter-checkout-opt-in`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                session_id: window.activeCheckoutSessionId,
                subscribe
            }),
        });
    } catch (err) {
        console.error("Failed to sync newsletter preference:", err);
    }
}


const subscribeCheckbox = document.getElementById("subscribe-checkbox");
subscribeCheckbox.addEventListener("change", () => {
    if (window.activeCheckoutSessionId) {
        syncNewsletterPreference();
    }
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
