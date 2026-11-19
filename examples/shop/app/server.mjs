// Demo shop for INDX Watch. Zero dependencies: node examples/shop/app/server.mjs
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const PORT = Number(process.env.PORT ?? 4173);
// Local demo default only. Real environments set SHOP_CUSTOMER_PASSWORD (see README).
const PASSWORD = process.env.SHOP_CUSTOMER_PASSWORD ?? 'demo-password';
const SEED_TOKEN = process.env.SHOP_SEED_TOKEN;
const PUBLIC = join(import.meta.dirname, 'public');
const DEFAULT_SEED = join(import.meta.dirname, '../.indx-watch/fixtures/FX-2-catalog/catalog.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let state;
function seed(data) {
  state = {
    products: data.products ?? [],
    coupons: data.coupons ?? [],
    customers: data.customers ?? [],
    reviews: {},
    nextOrder: 1001,
  };
}
seed(JSON.parse(readFileSync(DEFAULT_SEED, 'utf8')));

const today = () => new Date().toISOString().slice(0, 10);

function checkCoupon(code) {
  const coupon = state.coupons.find(
    (c) =>
      c.code.toLowerCase() ===
      String(code ?? '')
        .trim()
        .toLowerCase(),
  );
  if (!coupon) return { error: 'This coupon is not valid' };
  if (coupon.expires < today()) return { error: 'This coupon has expired' };
  return { coupon };
}

function totals(items, code) {
  const subtotal = items.reduce((sum, { id, qty }) => {
    const product = state.products.find((p) => p.id === id);
    return sum + (product ? product.price * qty : 0);
  }, 0);
  const result = code ? checkCoupon(code) : {};
  const discount = result.coupon ? Math.round(subtotal * result.coupon.discount * 100) / 100 : 0;
  return { subtotal, discount, total: subtotal - discount, error: result.error };
}

const routes = {
  'GET /api/products': () => [200, state.products],
  'POST /api/totals': (body) => [200, totals(body.items ?? [], body.coupon)],
  'POST /api/orders': (body) => {
    if (!body.items?.length) return [400, { error: 'Your cart is empty' }];
    const result = totals(body.items, body.coupon);
    if (result.error) return [400, result];
    return [201, { number: `SHOP-${state.nextOrder++}`, ...result }];
  },
  'POST /api/sign-in': (body) => {
    const customer = state.customers.find((c) => c.email === body.email);
    if (!customer || body.password !== PASSWORD) return [401, { error: 'Email or password is incorrect' }];
    return [200, customer];
  },
  'GET /api/reviews': (_body, url) => [200, state.reviews[url.searchParams.get('product')] ?? []],
  'POST /api/reviews': (body) => {
    if (!state.products.some((p) => p.id === body.product)) return [404, { error: 'Unknown product' }];
    if (body.photo && !/^data:image\/(png|jpeg);base64,/.test(body.photo)) {
      return [400, { error: 'Photos must be PNG or JPEG' }];
    }
    const review = {
      author: String(body.author ?? 'Guest'),
      text: String(body.text ?? ''),
      photo: body.photo,
    };
    state.reviews[body.product] = [...(state.reviews[body.product] ?? []), review];
    return [201, review];
  },
  'POST /__test/seed': (body, _url, req) => {
    if (SEED_TOKEN && req.headers.authorization !== `Bearer ${SEED_TOKEN}`)
      return [401, { error: 'Unauthorized' }];
    seed(body);
    return [200, { ok: true, products: state.products.length }];
  },
};

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 5_000_000) throw new Error('Body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) return send(res, ...(await route(await readJson(req), url, req)));
    if (req.method !== 'GET') return send(res, 404, { error: 'Not found' });
    const file = TYPES[extname(url.pathname)] ? url.pathname.slice(1).replace(/[^\w.-]/g, '') : 'index.html';
    send(res, 200, readFileSync(join(PUBLIC, file)), TYPES[extname(file)]);
  } catch (error) {
    if (error.code === 'ENOENT') return send(res, 404, { error: 'Not found' });
    send(res, 400, { error: error.message });
  }
}).listen(PORT, () => console.log(`Shop running at http://localhost:${PORT}`));
