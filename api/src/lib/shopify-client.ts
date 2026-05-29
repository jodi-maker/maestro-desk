// Tiny Shopify Admin REST client. Two reads — customer search by
// email, then orders for that customer. Admin API uses the
// X-Shopify-Access-Token header (NOT Bearer).
//
// Shop domain comes in as the subdomain ("acme-store") — we tack on
// `.myshopify.com` server-side so the stored value stays compact.

const API_VERSION = '2024-10';

interface ShopifyAddress {
  city?:     string | null;
  province?: string | null;
  country?:  string | null;
}

interface ShopifyCustomer {
  id:                  number;
  email:               string;
  first_name?:         string | null;
  last_name?:          string | null;
  orders_count:        number;
  total_spent:         string;
  currency:            string;
  default_address?:    ShopifyAddress | null;
  created_at:          string;
}

interface ShopifyLineItem {
  title:    string;
  quantity: number;
}

interface ShopifyOrder {
  id:                 number;
  name:               string;
  created_at:         string;
  financial_status:   string | null;
  fulfillment_status: string | null;
  total_price:        string;
  currency:           string;
  line_items:         ShopifyLineItem[];
}

export interface ShopifyContext {
  customer: ShopifyCustomer | null;
  orders:   ShopifyOrder[];
}

async function shopifyGet<T>(shop: string, token: string, path: string): Promise<T> {
  const url = `https://${shop}.myshopify.com/admin/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Look up a Shopify customer by email and their most recent orders.
 * Returns { customer: null, orders: [] } when no match (the common
 * case). The orders call uses status=any so cancelled / refunded
 * orders still surface in the sidebar.
 */
export async function fetchShopifyContext(args: {
  shop:  string;
  token: string;
  email: string;
}): Promise<ShopifyContext> {
  const { shop, token, email } = args;

  const search = await shopifyGet<{ customers: ShopifyCustomer[] }>(
    shop,
    token,
    `/customers/search.json?query=${encodeURIComponent(`email:${email}`)}&limit=1`,
  );
  const customer = search.customers[0] || null;
  if (!customer) return { customer: null, orders: [] };

  const ordersRes = await shopifyGet<{ orders: ShopifyOrder[] }>(
    shop,
    token,
    `/customers/${customer.id}/orders.json?status=any&limit=10`,
  );

  return { customer, orders: ordersRes.orders };
}
