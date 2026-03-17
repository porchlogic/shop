class ProductCard extends HTMLElement {
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
        console.warn("product-card: invalid JSON in product attribute", err);
      }
    }

    return {
      name: this.getAttribute("title") || "Product",
      price: Number(this.getAttribute("price") || 0),
      image: this.getAttribute("image") || "",
      href: this.getAttribute("href") || "#",
      subtitle: this.getAttribute("subtitle") || "",
    };
  }

  _render(product) {
    const price =
      Number.isFinite(Number(product.price)) && Number(product.price) > 0
        ? `$${Number(product.price).toFixed(2)}`
        : "";

    const subtitle = product.subtitle
      ? `<span class="product-card__subtitle">${product.subtitle}</span>`
      : "";

    this.innerHTML = `
      <a class="product-card" href="${product.href || "#"}">
        <div class="product-card__image">
          ${
            product.image
              ? `<img src="${product.image}" alt="${product.name}" />`
              : `<div class="product-card__placeholder">No image</div>`
          }
        </div>
        <div class="product-card__body">
          <h2 class="product-card__title">${product.name}</h2>
          ${subtitle}
          ${price ? `<span class="product-card__price">${price}</span>` : ""}
        </div>
      </a>
    `;
  }
}

customElements.define("product-card", ProductCard);
