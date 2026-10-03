const cartStorageKey = "techgear-cart";
let products = {};
const money = (value) => new Intl.NumberFormat("vi-VN").format(value) + "₫";

function readCart() {
    try {
        const cart = JSON.parse(localStorage.getItem(cartStorageKey) || "[]");
        return cart.map((item) => typeof item === "string"
            ? { id: Object.values(products).find((product) => product.name === item)?.id, name: item }
            : item).filter((item) => item && item.id);
    } catch {
        return [];
    }
}

function renderCart() {
    const cart = readCart();
    const count = cart.length;
    document.querySelectorAll("[data-cart-count]").forEach((badge) => {
        badge.textContent = count;
        badge.closest("button")?.setAttribute("aria-label", `Mở giỏ hàng, ${count} sản phẩm`);
    });

    const itemsContainer = document.querySelector("[data-cart-items]");
    if (!itemsContainer) return;

    itemsContainer.replaceChildren();
    if (cart.length === 0) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "cart-empty";
        emptyMessage.textContent = "Giỏ hàng đang trống. Thêm món bạn thích từ cửa hàng nhé.";
        itemsContainer.append(emptyMessage);
    }

    cart.forEach((item, index) => {
        const product = products[item.id] || item;
        const row = document.createElement("div");
        row.className = "cart-item";
        const details = document.createElement("div");
        const name = document.createElement("h3");
        name.textContent = product.name || "Sản phẩm";
        const price = document.createElement("p");
        price.textContent = money(product.price || 0);
        details.append(name, price);
        const removeButton = document.createElement("button");
        removeButton.className = "remove-cart-item";
        removeButton.type = "button";
        removeButton.dataset.removeIndex = index;
        removeButton.textContent = "Xóa";
        row.append(details, removeButton);
        itemsContainer.append(row);
    });

    const total = cart.reduce((sum, item) => sum + (Number(products[item.id]?.price) || 0), 0);
    const totalElement = document.querySelector("[data-cart-total]");
    if (totalElement) totalElement.textContent = money(total);
    const checkoutButton = document.querySelector("[data-show-checkout]");
    if (checkoutButton) checkoutButton.disabled = count === 0;
}

async function loadProducts() {
    try {
        const response = await fetch("/api/products");
        if (!response.ok) throw new Error("Không thể tải danh sách sản phẩm.");
        const result = await response.json();
        products = Object.fromEntries(result.products.map((product) => [product.id, product]));
        const catalog = document.querySelector("[data-products-grid]");
        if (catalog) catalog.replaceChildren(...result.products.map((product) => makeProductCard(product, true)));
        const featured = document.querySelector(".featured-section .product-grid");
        if (featured) featured.replaceChildren(...result.products.slice(0, 3).map((product) => makeProductCard(product, false)));
        document.querySelector("#product-search")?.dispatchEvent(new Event("input"));
        renderCart();
    } catch {
        document.querySelectorAll(".add-to-cart").forEach((button) => { button.disabled = true; });
    }
}

function makeProductCard(product, detailed) {
    const categoryNames = { keyboard: "BÀN PHÍM CƠ", mouse: "CHUỘT", audio: "TAI NGHE", accessory: "PHỤ KIỆN" };
    const article = document.createElement("article");
    article.className = "product-card";
    article.dataset.category = product.category;
    article.id = `product-${product.id}`;

    const imageLink = document.createElement("a");
    imageLink.className = "product-image";
    imageLink.href = `#product-${product.id}`;
    const image = document.createElement("img");
    image.src = product.image_url || "https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=900&q=80";
    image.alt = product.name;
    image.loading = "lazy";
    imageLink.append(image);

    const info = document.createElement("div");
    info.className = "product-info";
    const category = document.createElement("p");
    category.className = "product-category";
    category.textContent = categoryNames[product.category] || "PHỤ KIỆN";
    const name = document.createElement(detailed ? "h2" : "h3");
    name.textContent = product.name;
    info.append(category, name);
    if (detailed) {
        const description = document.createElement("p");
        description.className = "product-description";
        description.textContent = product.description || "Sản phẩm được tuyển chọn tại TechGear.";
        info.append(description);
    }

    const bottom = document.createElement("div");
    bottom.className = "product-bottom";
    const price = document.createElement("strong");
    price.textContent = money(product.price);
    const addButton = document.createElement("button");
    addButton.className = "add-to-cart";
    addButton.type = "button";
    addButton.dataset.productId = product.id;
    addButton.setAttribute("aria-label", `Thêm ${product.name} vào giỏ`);
    addButton.textContent = "+";
    bottom.append(price, addButton);
    info.append(bottom);
    article.append(imageLink, info);
    return article;
}

document.querySelectorAll("[data-open-cart]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector("[data-cart-dialog]").showModal());
});

document.querySelector("[data-close-cart]")?.addEventListener("click", () => {
    document.querySelector("[data-cart-dialog]").close();
});

document.querySelector("[data-cart-dialog]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});

document.querySelector("[data-cart-items]")?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-index]");
    if (!removeButton) return;
    const cart = readCart();
    cart.splice(Number(removeButton.dataset.removeIndex), 1);
    localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    renderCart();
});

document.querySelector("[data-show-checkout]")?.addEventListener("click", () => {
    const form = document.querySelector("[data-checkout-form]");
    form.hidden = false;
    form.querySelector("input")?.focus();
});

document.addEventListener("click", (event) => {
    const button = event.target.closest(".add-to-cart");
    if (!button) return;
    const cart = readCart();
    const id = button.dataset.productId;
    if (!products[id]) return;
    cart.push({ id });
    localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    renderCart();
    button.textContent = "✓";
    window.setTimeout(() => { button.textContent = "+"; }, 900);
});

renderCart();
loadProducts();

document.querySelectorAll("[data-api]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = form.querySelector(".form-status");
        const submitButton = form.querySelector('[type="submit"]');
        submitButton.disabled = true;
        status.textContent = "Đang lưu thông tin...";
        try {
            const payload = Object.fromEntries(new FormData(form));
            if ("rating" in payload) payload.rating = Number(payload.rating);
            const response = await fetch(form.dataset.api, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Không thể lưu thông tin.");
            const recordId = result.message_id || result.feedback_id;
            status.textContent = `Đã lưu lời nhắn #${recordId}. Cảm ơn bạn!`;
            form.reset();
        } catch (error) {
            status.textContent = error.message || "Không kết nối được máy chủ. Hãy thử lại.";
        } finally {
            submitButton.disabled = false;
        }
    });
});

document.querySelector("[data-checkout-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const status = document.querySelector("[data-checkout-status]");
    const quantities = new Map();
    readCart().forEach(({ id }) => quantities.set(id, (quantities.get(id) || 0) + 1));
    submitButton.disabled = true;
    status.textContent = "Đang lưu đơn hàng...";

    try {
        const response = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                customer: Object.fromEntries(new FormData(form)),
                items: [...quantities].map(([product_id, quantity]) => ({ product_id, quantity }))
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Không thể tạo đơn hàng.");
        localStorage.removeItem(cartStorageKey);
        renderCart();
        form.reset();
        status.textContent = `Đặt hàng thành công! Mã đơn #${result.order_id}, tổng ${new Intl.NumberFormat("vi-VN").format(result.total)}₫.`;
    } catch (error) {
        status.textContent = error.message || "Không kết nối được máy chủ. Hãy thử lại.";
    } finally {
        submitButton.disabled = false;
    }
});

const searchInput = document.querySelector("#product-search");
const filterButtons = document.querySelectorAll("[data-filter]");

if (searchInput && filterButtons.length) {
    let activeFilter = "all";
    const resultCount = document.querySelector("#result-count");
    const emptyState = document.querySelector("#empty-state");

    function filterProducts() {
        const query = searchInput.value.trim().toLocaleLowerCase("vi");
        let visibleCount = 0;

        const cards = [...document.querySelectorAll(".catalog-grid .product-card")];
        cards.forEach((card) => {
            const matchesCategory = activeFilter === "all" || card.dataset.category === activeFilter;
            const matchesQuery = card.textContent.toLocaleLowerCase("vi").includes(query);
            const isVisible = matchesCategory && matchesQuery;
            card.hidden = !isVisible;
            if (isVisible) visibleCount += 1;
        });

        resultCount.textContent = `${visibleCount} sản phẩm`;
        emptyState.hidden = visibleCount > 0;
    }

    filterButtons.forEach((button) => {
        button.addEventListener("click", () => {
            activeFilter = button.dataset.filter;
            filterButtons.forEach((item) => item.classList.toggle("is-selected", item === button));
            filterProducts();
        });
    });

    searchInput.addEventListener("input", filterProducts);
}

const adminPage = document.querySelector("[data-admin-page]");
if (adminPage) {
    const loginPanel = adminPage.querySelector("[data-admin-login-panel]");
    const loginForm = adminPage.querySelector("[data-admin-login-form]");
    const dashboard = adminPage.querySelector("[data-admin-dashboard]");
    const statusElements = adminPage.querySelectorAll("[data-admin-status]");
    const orderRows = adminPage.querySelector("[data-admin-orders]");
    const productRows = adminPage.querySelector("[data-admin-products]");
    const productForm = adminPage.querySelector("[data-admin-product-form]");
    const productCache = new Map();
    const statusNames = {
        pending: "Chờ xác nhận",
        confirmed: "Đã xác nhận",
        shipping: "Đang giao",
        completed: "Hoàn tất",
        cancelled: "Đã hủy"
    };
    const showStatus = (message) => statusElements.forEach((element) => { element.textContent = message; });
    const categoryNames = { keyboard: "Bàn phím", mouse: "Chuột", audio: "Tai nghe", accessory: "Phụ kiện" };

    async function adminRequest(url, options = {}) {
        const response = await fetch(url, { ...options, credentials: "same-origin" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Không thể xử lý yêu cầu.");
        return result;
    }

    function showLogin() {
        dashboard.hidden = true;
        loginPanel.hidden = false;
    }

    function makeStatusSelect(order) {
        const select = document.createElement("select");
        select.className = "admin-status-select";
        select.setAttribute("aria-label", `Trạng thái đơn #${order.id}`);
        Object.entries(statusNames).forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            option.selected = order.status === value;
            select.append(option);
        });
        select.addEventListener("change", async () => {
            select.disabled = true;
            try {
                await adminRequest("/api/admin/orders/status", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ order_id: order.id, status: select.value })
                });
                showStatus(`Đã cập nhật đơn #${order.id}: ${statusNames[select.value]}.`);
                await loadOrders();
            } catch (error) {
                showStatus(error.message);
                select.value = order.status;
            } finally {
                select.disabled = false;
            }
        });
        return select;
    }

    function renderOrders(orders) {
        orderRows.replaceChildren();
        const empty = adminPage.querySelector("[data-admin-empty]");
        empty.hidden = orders.length > 0;
        adminPage.querySelector("[data-admin-orders-count]").textContent = orders.length;
        adminPage.querySelector("[data-admin-pending-count]").textContent = orders.filter((order) => order.status === "pending").length;
        const revenue = orders.reduce((sum, order) => sum + (order.status === "cancelled" ? 0 : order.total), 0);
        adminPage.querySelector("[data-admin-revenue]").textContent = money(revenue);

        orders.forEach((order) => {
            const row = document.createElement("tr");
            const id = document.createElement("td");
            id.className = "admin-order-id";
            id.textContent = `#${order.id}`;
            const customer = document.createElement("td");
            customer.className = "admin-customer";
            const customerName = document.createElement("strong");
            customerName.textContent = order.customer_name;
            const customerDetails = document.createElement("small");
            customerDetails.textContent = `${order.phone} · ${order.email}`;
            const address = document.createElement("small");
            address.textContent = order.address;
            customer.append(customerName, customerDetails, address);
            const items = document.createElement("td");
            items.className = "admin-items";
            items.textContent = order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ");
            const total = document.createElement("td");
            total.className = "admin-total";
            total.textContent = money(order.total);
            const date = document.createElement("td");
            date.className = "admin-date";
            date.textContent = order.created_at;
            const status = document.createElement("td");
            status.append(makeStatusSelect(order));
            row.append(id, customer, items, total, date, status);
            orderRows.append(row);
        });
    }

    function renderProducts(items) {
        productRows.replaceChildren();
        productCache.clear();
        adminPage.querySelector("[data-admin-products-count]").textContent = items.length;
        items.forEach((product) => {
            productCache.set(product.id, product);
            const row = document.createElement("tr");
            const name = document.createElement("td");
            const title = document.createElement("strong");
            title.textContent = product.name;
            const description = document.createElement("small");
            description.textContent = product.description || "Chưa có mô tả";
            name.append(title, description);
            const category = document.createElement("td");
            category.textContent = categoryNames[product.category] || product.category;
            const price = document.createElement("td");
            price.className = "admin-total";
            price.textContent = money(product.price);
            const state = document.createElement("td");
            state.textContent = product.active ? "Đang bán" : "Đã ẩn";
            const actions = document.createElement("td");
            actions.className = "admin-actions";
            const edit = document.createElement("button");
            edit.className = "button button-outline";
            edit.type = "button";
            edit.textContent = "Sửa";
            edit.addEventListener("click", () => beginProductEdit(product));
            const toggle = document.createElement("button");
            toggle.className = "button button-outline";
            toggle.type = "button";
            toggle.textContent = product.active ? "Ẩn" : "Hiện";
            toggle.addEventListener("click", async () => {
                toggle.disabled = true;
                try {
                    await adminRequest("/api/admin/products/active", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ product_id: product.id, active: !product.active })
                    });
                    showStatus(`Đã cập nhật sản phẩm “${product.name}”.`);
                    await loadProductsAdmin();
                } catch (error) {
                    showStatus(error.message);
                } finally {
                    toggle.disabled = false;
                }
            });
            actions.append(edit, toggle);
            row.append(name, category, price, state, actions);
            productRows.append(row);
        });
        adminPage.querySelector("[data-admin-products-empty]").hidden = items.length > 0;
    }

    function beginProductEdit(product) {
        productForm.elements.id.value = product.id;
        productForm.elements.name.value = product.name;
        productForm.elements.category.value = product.category;
        productForm.elements.price.value = product.price;
        productForm.elements.description.value = product.description || "";
        productForm.elements.image_url.value = product.image_url || "";
        productForm.querySelector("[type=submit]").textContent = "Lưu thay đổi";
        productForm.querySelector("[data-cancel-product-edit]").hidden = false;
        productForm.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function resetProductForm() {
        productForm.reset();
        productForm.elements.id.value = "";
        productForm.querySelector("[type=submit]").textContent = "Thêm sản phẩm";
        productForm.querySelector("[data-cancel-product-edit]").hidden = true;
    }

    function renderMessages(messages) {
        const list = adminPage.querySelector("[data-admin-messages]");
        list.replaceChildren();
        messages.forEach((message) => {
            const item = document.createElement("article");
            item.className = "admin-message";
            const heading = document.createElement("div");
            heading.className = "admin-message-heading";
            const title = document.createElement("strong");
            title.textContent = message.topic;
            const date = document.createElement("time");
            date.textContent = message.created_at;
            heading.append(title, date);
            const sender = document.createElement("p");
            sender.className = "admin-message-sender";
            sender.textContent = `${message.name} · ${message.email}`;
            const body = document.createElement("p");
            body.textContent = message.message;
            item.append(heading, sender, body);
            list.append(item);
        });
        adminPage.querySelector("[data-admin-messages-empty]").hidden = messages.length > 0;
        adminPage.querySelector("[data-admin-messages-count]").textContent = messages.length;
    }

    function renderFeedback(feedback) {
        const list = adminPage.querySelector("[data-admin-feedback]");
        list.replaceChildren();
        feedback.forEach((entry) => {
            const item = document.createElement("article");
            item.className = "admin-message admin-feedback-entry";
            const heading = document.createElement("div");
            heading.className = "admin-message-heading";
            const title = document.createElement("strong");
            title.textContent = entry.name;
            const rating = document.createElement("span");
            rating.className = "admin-rating";
            rating.textContent = `${"★".repeat(entry.rating)}${"☆".repeat(5 - entry.rating)}`;
            const date = document.createElement("time");
            date.textContent = entry.created_at;
            heading.append(title, rating, date);
            const body = document.createElement("p");
            body.textContent = entry.message;
            item.append(heading, body);
            list.append(item);
        });
        adminPage.querySelector("[data-admin-feedback-empty]").hidden = feedback.length > 0;
        adminPage.querySelector("[data-admin-feedback-count]").textContent = feedback.length;
    }

    async function loadProductsAdmin() {
        const result = await adminRequest("/api/admin/products");
        renderProducts(result.products);
    }

    async function loadMessages() {
        const result = await adminRequest("/api/admin/messages");
        renderMessages(result.messages);
    }

    async function loadFeedback() {
        const result = await adminRequest("/api/admin/feedback");
        renderFeedback(result.feedback);
    }

    async function loadDashboard() {
        try {
            await Promise.all([loadOrders(), loadProductsAdmin(), loadMessages(), loadFeedback()]);
            loginPanel.hidden = true;
            dashboard.hidden = false;
        } catch (error) {
            showLogin();
            showStatus(error.message);
        }
    }

    async function loadOrders() {
        const result = await adminRequest("/api/admin/orders");
        renderOrders(result.orders);
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = loginForm.querySelector('[type="submit"]');
        submit.disabled = true;
        showStatus("Đang xác thực...");
        try {
            await adminRequest("/api/admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.fromEntries(new FormData(loginForm)))
            });
            loginForm.reset();
            showStatus("");
            await loadDashboard();
        } catch (error) {
            showStatus(error.message);
        } finally {
            submit.disabled = false;
        }
    });

    adminPage.querySelectorAll("[data-admin-tab]").forEach((button) => {
        button.addEventListener("click", () => {
            adminPage.querySelectorAll("[data-admin-tab]").forEach((tab) => {
                const selected = tab === button;
                tab.classList.toggle("is-selected", selected);
                tab.setAttribute("aria-pressed", String(selected));
            });
            adminPage.querySelectorAll("[data-admin-view]").forEach((view) => {
                view.hidden = view.dataset.adminView !== button.dataset.adminTab;
            });
        });
    });
    productForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = productForm.querySelector("[type=submit]");
        submit.disabled = true;
        try {
            const payload = Object.fromEntries(new FormData(productForm));
            payload.price = Number(payload.price);
            await adminRequest("/api/admin/products/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            showStatus(payload.id ? "Đã cập nhật sản phẩm." : "Đã thêm sản phẩm mới.");
            resetProductForm();
            await Promise.all([loadProductsAdmin(), loadProducts()]);
        } catch (error) {
            showStatus(error.message);
        } finally {
            submit.disabled = false;
        }
    });
    productForm.querySelector("[data-cancel-product-edit]").addEventListener("click", resetProductForm);
    adminPage.querySelector("[data-admin-refresh]").addEventListener("click", loadDashboard);
    adminPage.querySelector("[data-admin-logout]").addEventListener("click", async () => {
        try {
            await adminRequest("/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        } finally {
            showLogin();
            showStatus("Đã đăng xuất.");
        }
    });
    loadDashboard();
}