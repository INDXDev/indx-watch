// Client for the demo shop: a tiny router plus one render function per page.
const main = document.getElementById('main');
const show = (html) => {
  main.innerHTML = html;
};
const showError = (message) => {
  main.querySelector('[role=alert]').textContent = message;
};
const load = (key, fallback) => JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const money = (n) => Number(n).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const api = async (path, body) => {
  const res = await fetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  return { ok: res.ok, data: await res.json() };
};
let products = [];

function cartItems() {
  return Object.entries(load('cart', {})).map(([id, qty]) => ({ id, qty }));
}

function addToCart(id) {
  const cart = load('cart', {});
  cart[id] = (cart[id] ?? 0) + 1;
  save('cart', cart);
  renderHeader();
}

function renderHeader() {
  const count = cartItems().reduce((n, item) => n + item.qty, 0);
  document.getElementById('cart-link').textContent = count ? `Cart (${count})` : 'Cart';
  const user = load('user', null);
  document.getElementById('account').innerHTML = user
    ? `<span>Welcome back, ${esc(user.name)}</span> <button type="button" id="sign-out">Sign out</button>`
    : '<a href="/sign-in">Sign in</a>';
  document.getElementById('sign-out')?.addEventListener('click', () => {
    localStorage.removeItem('user');
    route();
  });
}

const productItem = (p) => `
  <li><a href="/products/${esc(p.id)}">${esc(p.name)}</a> <span class="price">${money(p.price)}</span>
  <button type="button" data-add="${esc(p.id)}" aria-label="Add ${esc(p.name)} to cart">Add to cart</button></li>`;

function home() {
  show(`<h1>Products</h1>
    <label for="search">Search</label> <input id="search" type="search" placeholder="Search by name" />
    <ul class="products" aria-label="Products"></ul>`);
  const list = main.querySelector('ul');
  const filter = (q) => {
    const hits = products.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
    list.innerHTML = hits.map(productItem).join('') || '<li>No products found</li>';
  };
  main.querySelector('#search').addEventListener('input', (e) => filter(e.target.value));
  filter('');
}

async function product(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return show('<h1>Product not found</h1>');
  const user = load('user', null);
  const { data: reviews } = await api(`/api/reviews?product=${encodeURIComponent(id)}`);
  show(`<h1>${esc(p.name)}</h1><p class="price">${money(p.price)}</p>
    <button type="button" data-add="${esc(p.id)}">Add to cart</button>
    <h2>Reviews</h2><ul class="reviews" aria-label="Reviews">${reviews.map(reviewItem).join('') || '<li>No reviews yet</li>'}</ul>
    ${user ? reviewForm() : '<p><a href="/sign-in">Sign in</a> to write a review.</p>'}`);
  main.querySelector('form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const file = form.get('photo');
    const photo = file?.size ? await readFile(file) : undefined;
    const res = await api('/api/reviews', { product: id, author: user.name, text: form.get('text'), photo });
    if (res.ok) return product(id);
    showError(res.data.error);
  });
}

const reviewItem = (r) =>
  `<li><strong>${esc(r.author)}</strong>: ${esc(r.text)}${r.photo ? `<br /><img class="thumb" src="${esc(r.photo)}" alt="Review photo" />` : ''}</li>`;

const reviewForm = () => `<form aria-labelledby="review-heading"><h2 id="review-heading">Write a review</h2>
  <label for="text">Review</label><textarea id="text" name="text" required></textarea>
  <label for="photo">Photo</label><input id="photo" name="photo" type="file" accept="image/png,image/jpeg" />
  <p role="alert"></p><button type="submit">Post review</button></form>`;

const readFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

async function cart(coupon) {
  const items = cartItems();
  if (!items.length) return show('<h1>Cart</h1><p>Your cart is empty</p>');
  const { data: t } = await api('/api/totals', { items, coupon });
  const name = (id) => products.find((p) => p.id === id)?.name ?? id;
  show(`<h1>Cart</h1>
    <ul class="cart" aria-label="Cart items">${items.map((i) => `<li>${esc(name(i.id))} × ${i.qty}</li>`).join('')}</ul>
    <form id="coupon"><label for="code">Coupon code</label>
      <input id="code" name="code" value="${esc(coupon ?? '')}" autocomplete="off" /> <button type="submit">Apply</button></form>
    <p role="alert">${t.error ? esc(t.error) : ''}</p>
    <dl class="totals"><dt>Subtotal</dt><dd>${money(t.subtotal)}</dd>
      ${t.discount ? `<dt>Discount</dt><dd data-testid="discount">-${money(t.discount)}</dd>` : ''}
      <dt>Total</dt><dd data-testid="total">${money(t.total)}</dd></dl>
    <button type="button" id="place-order">Place order</button>`);
  main.querySelector('#coupon').addEventListener('submit', (e) => {
    e.preventDefault();
    cart(new FormData(e.target).get('code') || undefined);
  });
  main.querySelector('#place-order').addEventListener('click', async () => {
    const res = await api('/api/orders', { items, coupon: t.error ? undefined : coupon });
    if (!res.ok) return showError(res.data.error);
    save('cart', {});
    navigate(`/orders/${res.data.number}`);
  });
}

function order(number) {
  show(`<h1>Thank you for your order</h1>
    <p>Order number: <strong class="order-number">${esc(number)}</strong></p><p><a href="/">Continue shopping</a></p>`);
}

function signIn() {
  show(`<h1>Sign in</h1><form id="sign-in">
    <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required />
    <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required />
    <p role="alert"></p><button type="submit">Sign in</button></form>`);
  main.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api('/api/sign-in', Object.fromEntries(new FormData(e.target)));
    if (!res.ok) return showError(res.data.error);
    save('user', { name: res.data.name, email: res.data.email });
    navigate('/');
  });
}

async function route() {
  products = (await api('/api/products')).data;
  renderHeader();
  const [, page, arg] = location.pathname.split('/');
  const pages = { '': home, cart: () => cart(), orders: order, products: product, 'sign-in': signIn };
  await (pages[page] ?? home)(decodeURIComponent(arg ?? ''));
}

function navigate(path) {
  history.pushState(null, '', path);
  route();
}

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) return addToCart(add.dataset.add);
  const link = e.target.closest('a[href^="/"]');
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute('href'));
});
window.addEventListener('popstate', route);
route();
