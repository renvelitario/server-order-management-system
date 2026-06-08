import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, supabaseAdmin } from '../db/db.js';
import {
  customers,
  notifications,
  orderItems,
  orders,
  products,
  userDevices,
  users,
} from '../db/schema.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const SUPABASE_PAGE_SIZE = 200;

const DEMO_ADMIN = {
  email: 'admin@admin.com',
  password: 'Admin1234',
  username: 'Admin',
  name: 'Demo Admin',
  phone_number: '09170000001',
  acc_type: 'Admin',
  status: 'Active',
};

const DEMO_USER = {
  email: 'user@user.com',
  password: 'User1234',
  username: 'User',
  name: 'Demo Rider',
  phone_number: '09170000002',
  acc_type: 'User',
  status: 'Active',
};

const DEMO_PRODUCT_SKUS = ['OMS-RICE-25KG', 'OMS-COFFEE-1KG', 'OMS-CUP-12OZ', 'OMS-BOX-MED'];
const DEMO_CUSTOMER_CONTACTS = ['09171110001', '09171110002', '09171110003', '09171110004'];
const DEMO_DEVICE_IDS = ['demo-admin-browser', 'demo-rider-phone'];
const DEMO_NOTIFICATION_EVENT_TYPES = [
  'demo_admin_attention',
  'demo_delivery_assignment',
  'demo_delivery_update',
];

type DemoUser = typeof DEMO_ADMIN;
type SupabaseAuthUserSummary = {
  id: string;
  email?: string | null;
};

const toNoon = (date: Date): Date => {
  const value = new Date(date);
  value.setHours(12, 0, 0, 0);
  return value;
};

const addDays = (days: number): Date => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return toNoon(value);
};

const findAuthUserByEmail = async (email: string): Promise<string | null> => {
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: SUPABASE_PAGE_SIZE,
    });

    if (error) {
      throw error;
    }

    const authUsers = data.users as SupabaseAuthUserSummary[];
    const match = authUsers.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match?.id) {
      return match.id;
    }

    if (authUsers.length < SUPABASE_PAGE_SIZE) {
      return null;
    }

    page += 1;
  }
};

const ensureDemoUser = async (demoUser: DemoUser) => {
  const existingAuthUserId = await findAuthUserByEmail(demoUser.email);
  let authUserId = existingAuthUserId;

  if (!authUserId) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: demoUser.email,
      password: demoUser.password,
      email_confirm: true,
    });

    if (error || !data.user?.id) {
      throw error ?? new Error(`Unable to create demo auth user ${demoUser.email}.`);
    }

    authUserId = data.user.id;
  } else {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      password: demoUser.password,
    });

    if (error) {
      throw error;
    }
  }

  const [localUser] = await db
    .insert(users)
    .values({
      email: demoUser.email,
      username: demoUser.username,
      name: demoUser.name,
      phone_number: demoUser.phone_number,
      acc_type: demoUser.acc_type,
      status: demoUser.status,
      inactivity_timeout_minutes: 60,
      session_timeout_enabled: true,
      supabase_id: authUserId,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        username: demoUser.username,
        name: demoUser.name,
        phone_number: demoUser.phone_number,
        acc_type: demoUser.acc_type,
        status: demoUser.status,
        inactivity_timeout_minutes: 60,
        session_timeout_enabled: true,
        supabase_id: authUserId,
      },
    })
    .returning({
      user_id: users.user_id,
      email: users.email,
      acc_type: users.acc_type,
    });

  return localUser;
};

const clearDemoRows = async () => {
  const demoProductRows = await db
    .select({ product_id: products.product_id })
    .from(products)
    .where(inArray(products.sku, DEMO_PRODUCT_SKUS));
  const demoCustomerRows = await db
    .select({ customer_id: customers.customer_id })
    .from(customers)
    .where(inArray(customers.contact_no, DEMO_CUSTOMER_CONTACTS));

  const demoProductIds = demoProductRows.map((product) => product.product_id);
  const demoCustomerIds = demoCustomerRows.map((customer) => customer.customer_id);

  const orderIdsByCustomer = demoCustomerIds.length
    ? await db
      .select({ order_id: orders.order_id })
      .from(orders)
      .where(inArray(orders.customer_id, demoCustomerIds))
    : [];

  const orderIdsByProduct = demoProductIds.length
    ? await db
      .selectDistinct({ order_id: orderItems.order_id })
      .from(orderItems)
      .where(inArray(orderItems.product_id, demoProductIds))
    : [];

  const demoOrderIds = [...new Set([
    ...orderIdsByCustomer.map((order) => order.order_id),
    ...orderIdsByProduct.map((item) => item.order_id),
  ])];

  if (demoOrderIds.length) {
    await db.delete(notifications).where(inArray(notifications.order_id, demoOrderIds));
    await db.delete(orderItems).where(inArray(orderItems.order_id, demoOrderIds));
    await db.delete(orders).where(inArray(orders.order_id, demoOrderIds));
  }

  await db.delete(notifications).where(inArray(notifications.event_type, DEMO_NOTIFICATION_EVENT_TYPES));
  await db.delete(userDevices).where(inArray(userDevices.device_id, DEMO_DEVICE_IDS));

  if (demoCustomerIds.length) {
    await db.delete(customers).where(inArray(customers.customer_id, demoCustomerIds));
  }

  if (demoProductIds.length) {
    await db.delete(products).where(inArray(products.product_id, demoProductIds));
  }
};

const seedCatalog = async () => {
  const productRows = await db
    .insert(products)
    .values([
      { sku: 'OMS-RICE-25KG', product_name: 'Premium Dinorado Rice 25kg', price: 1450, status: 'active' },
      { sku: 'OMS-COFFEE-1KG', product_name: 'Barako Coffee Beans 1kg', price: 680, status: 'active' },
      { sku: 'OMS-CUP-12OZ', product_name: 'Compostable Paper Cups 12oz', price: 220, status: 'active' },
      { sku: 'OMS-BOX-MED', product_name: 'Medium Delivery Box', price: 35, status: 'inactive' },
    ])
    .returning({
      product_id: products.product_id,
      sku: products.sku,
      price: products.price,
    });

  const customerRows = await db
    .insert(customers)
    .values([
      {
        name: 'Luna Cafe Makati',
        address: '128 Dela Rosa Street, Legazpi Village, Makati City',
        contact_no: '09171110001',
      },
      {
        name: 'Northpoint Mini Mart',
        address: '44 Mindanao Avenue, Quezon City',
        contact_no: '09171110002',
      },
      {
        name: 'Harbor Bistro',
        address: 'Seaside Boulevard, Pasay City',
        contact_no: '09171110003',
      },
      {
        name: 'Greenfield Office Pantry',
        address: 'Greenfield District, Mandaluyong City',
        contact_no: '09171110004',
      },
    ])
    .returning({
      customer_id: customers.customer_id,
      name: customers.name,
    });

  return { productRows, customerRows };
};

const seedOrders = async ({
  productRows,
  customerRows,
  riderUserId,
}: {
  productRows: Array<{ product_id: number; sku: string | null; price: number }>;
  customerRows: Array<{ customer_id: number; name: string }>;
  riderUserId: number;
}) => {
  const productBySku = new Map(productRows.map((product) => [product.sku, product]));
  const [rice, coffee, cups] = [
    productBySku.get('OMS-RICE-25KG'),
    productBySku.get('OMS-COFFEE-1KG'),
    productBySku.get('OMS-CUP-12OZ'),
  ];

  if (!rice || !coffee || !cups) {
    throw new Error('Demo products were not created correctly.');
  }

  const orderSpecs = [
    {
      customer: customerRows[0],
      order_date: addDays(-2),
      delivery_date: null,
      delivery_status: 'unassigned',
      items: [{ product: rice, quantity: 2 }],
      discount: 100,
      delivery_fee: 0,
    },
    {
      customer: customerRows[1],
      order_date: addDays(-1),
      delivery_date: addDays(1),
      delivery_status: 'pending',
      items: [{ product: coffee, quantity: 3 }, { product: cups, quantity: 4 }],
      discount: 0,
      delivery_fee: 120,
    },
    {
      customer: customerRows[2],
      order_date: addDays(0),
      delivery_date: addDays(0),
      delivery_status: 'out_for_delivery',
      items: [{ product: rice, quantity: 1 }, { product: cups, quantity: 8 }],
      discount: 75,
      delivery_fee: 150,
    },
    {
      customer: customerRows[3],
      order_date: addDays(-5),
      delivery_date: addDays(0),
      delivery_status: 'delivered',
      items: [{ product: coffee, quantity: 6 }, { product: cups, quantity: 10 }],
      discount: 180,
      delivery_fee: 100,
      delivered_at: new Date(),
    },
    {
      customer: customerRows[0],
      order_date: addDays(-3),
      delivery_date: addDays(0),
      delivery_status: 'failed',
      items: [{ product: rice, quantity: 1 }],
      discount: 0,
      delivery_fee: 100,
    },
    {
      customer: customerRows[1],
      order_date: addDays(-4),
      delivery_date: addDays(2),
      delivery_status: 'cancelled',
      items: [{ product: coffee, quantity: 1 }],
      discount: 0,
      delivery_fee: 0,
    },
  ];

  const createdOrders = [];

  for (const spec of orderSpecs) {
    const [order] = await db
      .insert(orders)
      .values({
        customer_id: spec.customer.customer_id,
        order_date: spec.order_date,
        delivery_date: spec.delivery_date,
        delivery_status: spec.delivery_status,
        delivery_user_id: ['out_for_delivery', 'delivered', 'failed'].includes(spec.delivery_status) ? riderUserId : null,
        delivered_at: spec.delivered_at ?? null,
        delivered_by: spec.delivery_status === 'delivered' ? riderUserId : null,
        discount: spec.discount,
        delivery_fee: spec.delivery_fee,
      })
      .returning({ order_id: orders.order_id, delivery_status: orders.delivery_status });

    await db.insert(orderItems).values(spec.items.map((item) => ({
      order_id: order.order_id,
      product_id: item.product.product_id,
      quantity: item.quantity,
      price: item.product.price,
    })));

    createdOrders.push(order);
  }

  return createdOrders;
};

const seedNotificationsAndDevices = async ({
  adminUserId,
  riderUserId,
  ordersByStatus,
}: {
  adminUserId: number;
  riderUserId: number;
  ordersByStatus: Map<string, number>;
}) => {
  await db.insert(notifications).values([
    {
      recipient_user_id: adminUserId,
      event_type: 'demo_admin_attention',
      title: 'Demo delivery needs review',
      message: `Order #${ordersByStatus.get('failed')} is ready to inspect in the delivery workflow.`,
      order_id: ordersByStatus.get('failed') ?? null,
      is_read: false,
    },
    {
      recipient_user_id: riderUserId,
      event_type: 'demo_delivery_assignment',
      title: 'Demo order is out for delivery',
      message: `Order #${ordersByStatus.get('out_for_delivery')} is available in Today's Orders.`,
      order_id: ordersByStatus.get('out_for_delivery') ?? null,
      is_read: false,
    },
    {
      recipient_user_id: riderUserId,
      event_type: 'demo_delivery_update',
      title: 'Demo delivered order',
      message: `Order #${ordersByStatus.get('delivered')} shows a completed delivery example.`,
      order_id: ordersByStatus.get('delivered') ?? null,
      is_read: true,
      read_at: new Date(),
    },
  ]);

  await db.insert(userDevices).values([
    {
      device_id: 'demo-admin-browser',
      user_id: adminUserId,
      device_label: 'Demo Admin Browser',
      user_agent: 'Chrome on Windows',
      timezone: 'Asia/Manila',
      last_ip: '127.0.0.1',
      first_seen_at: addDays(-1),
      last_seen_at: new Date(),
    },
    {
      device_id: 'demo-rider-phone',
      user_id: riderUserId,
      device_label: 'Demo Rider Phone',
      user_agent: 'Mobile Safari on iOS',
      timezone: 'Asia/Manila',
      last_ip: '127.0.0.1',
      first_seen_at: addDays(-1),
      last_seen_at: new Date(),
    },
  ]);
};

export const refreshDemoData = async () => {
  const [adminUser, riderUser] = await Promise.all([
    ensureDemoUser(DEMO_ADMIN),
    ensureDemoUser(DEMO_USER),
  ]);

  await clearDemoRows();
  const catalog = await seedCatalog();
  const createdOrders = await seedOrders({
    ...catalog,
    riderUserId: riderUser.user_id,
  });
  const ordersByStatus = new Map(createdOrders.map((order) => [order.delivery_status, order.order_id]));

  await seedNotificationsAndDevices({
    adminUserId: adminUser.user_id,
    riderUserId: riderUser.user_id,
    ordersByStatus,
  });

  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('ims_products', 'product_id'),
      COALESCE((SELECT MAX(product_id) FROM ims_products), 1),
      true
    )
  `);
};

export const startDemoDataRefresh = () => {
  if (process.env.NODE_ENV === 'test' || process.env.DEMO_DATA_REFRESH_ENABLED === 'false') {
    return;
  }

  let refreshInProgress = false;
  const runRefresh = async () => {
    if (refreshInProgress) {
      return;
    }

    refreshInProgress = true;
    try {
      await refreshDemoData();
      console.log('Demo data refreshed.');
    } catch (error) {
      console.error('Failed to refresh demo data:', error);
    } finally {
      refreshInProgress = false;
    }
  };

  void runRefresh();
  const timer = setInterval(runRefresh, ONE_HOUR_MS);
  timer.unref?.();
};
