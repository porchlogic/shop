class ProductPage extends HTMLElement {
  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;
    const product = this._readProduct();
    this._render(product);
  }

  _readProduct() {
    const raw =
      this.getAttribute("product") || this.getAttribute("data-product");
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.warn("product-page: invalid JSON in product attribute", err);
      }
    }

    const imagesAttr = this.getAttribute("images") || "";
    const images = imagesAttr
      .split(",")
      .map((img) => img.trim())
      .filter(Boolean);

    const attributesAttr = this.getAttribute("attributes");
    let attributes = {};
    if (attributesAttr) {
      try {
        attributes = JSON.parse(attributesAttr);
      } catch (err) {
        console.warn("product-page: invalid JSON in attributes attribute", err);
      }
    }

    return {
      name: this.getAttribute("title") || "Product",
      price: Number(this.getAttribute("price") || 0),
      images,
      attributes,
    };
  }

  _render(product) {
    const images = Array.isArray(product.images) ? product.images : [];
    const mainImage = images[0] || "";
    const attributeEntries = Object.entries(product.attributes || {});

    const attributesMarkup =
      attributeEntries.length === 0
        ? `<div class="attribute"><span class="attribute__label">Details</span><span class="attribute__value">None</span></div>`
        : attributeEntries
            .map(([key, value]) => {
              const label = String(key).replace(/_/g, " ");
              const formattedValue = Array.isArray(value)
                ? value.join(", ")
                : typeof value === "object" && value !== null
                  ? JSON.stringify(value)
                  : String(value);
              return `<div class="attribute"><span class="attribute__label">${label}</span><span class="attribute__value">${formattedValue}</span></div>`;
            })
            .join("");

    const thumbnailsMarkup = images
      .slice(0, 4)
      .map((src) => `<img src="${src}" alt="${product.name} image" />`)
      .join("");

    this.innerHTML = `
      <section class="product-page">
        <header class="product-page__header">
          <h1 class="product-page__title">${product.name}</h1>
          <span class="product-page__price">$${Number(product.price || 0).toFixed(
            2
          )}</span>
        </header>
        <div class="product-page__hero">
          ${
            mainImage
              ? `<img src="${mainImage}" alt="${product.name}" />`
              : `<div class="product-page__placeholder">No image</div>`
          }
        </div>
        ${
          thumbnailsMarkup
            ? `<div class="product-page__thumbs">${thumbnailsMarkup}</div>`
            : ""
        }
        <div class="product-page__attributes">${attributesMarkup}</div>
        <div class="product-page__cta">
          <button type="button" class="product-page__button">Add to cart</button>
        </div>
      </section>
    `;
  }
}

customElements.define("product-page", ProductPage);
