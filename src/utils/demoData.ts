import { inArray, sql } from 'drizzle-orm';
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
import { revokeAllTrackedDeviceSessions } from './deviceTracking.js';

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

const DEMO_DEVICE_IDS = ['demo-admin-browser', 'demo-rider-phone'];

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

const resetSequence = async (tableName: string, columnName: string) => {
  await db.execute(sql.raw(`ALTER SEQUENCE ${tableName}_${columnName}_seq RESTART WITH 1`));
};

const clearBusinessData = async () => {
  await db.delete(notifications);
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(customers);
  await db.delete(products);
  await db.delete(userDevices).where(inArray(userDevices.device_id, DEMO_DEVICE_IDS));

  await resetSequence('ims_products', 'product_id');
  await resetSequence('ims_customers', 'customer_id');
  await resetSequence('ims_orders', 'order_id');
  await resetSequence('ims_order_items', 'order_item_id');
  await resetSequence('ims_notifications', 'notification_id');
};

const seedCatalog = async () => {
  const productRows = await db
    .insert(products)
    .values([
      { sku: 'FULNB001', product_name: 'Fulfilltify Spiral Notebook 80 Leaves', price: 75, status: 'active' },
      { sku: 'FULPENBLK', product_name: 'Black Ballpoint Pen 3-Pack', price: 45, status: 'active' },
      { sku: 'FULPENCIL', product_name: 'HB Pencil Set with Eraser', price: 55, status: 'active' },
      { sku: 'FULYELLOW', product_name: 'Yellow Pad Paper 80 Sheets', price: 68, status: 'active' },
      { sku: 'FULCALSCI', product_name: 'Scientific Calculator', price: 785, status: 'active' },
      { sku: 'FULDRAFT', product_name: 'Engineering Drafting Kit', price: 520, status: 'active' },
      { sku: 'FULIDLACE', product_name: 'Fulfilltify ID Lace', price: 120, status: 'active' },
      { sku: 'FULTSHIRT', product_name: 'Fulfilltify Team Shirt', price: 450, status: 'active' },
      { sku: 'FULHOODIE', product_name: 'Fulfilltify Varsity Hoodie', price: 1250, status: 'active' },
      { sku: 'FULTOTE01', product_name: 'Fulfilltify Canvas Tote Bag', price: 280, status: 'active' },
      { sku: 'FULBOTTLE', product_name: 'Fulfilltify Stainless Tumbler', price: 390, status: 'active' },
      { sku: 'FULPEUNIF', product_name: 'PE Uniform Set', price: 850, status: 'active' },
      { sku: 'FULNSTP01', product_name: 'NSTP Workbook', price: 195, status: 'active' },
      { sku: 'FULENGDRAW', product_name: 'Engineering Drawing Manual', price: 340, status: 'inactive' },
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
        student_number: '202400031',
        name: 'Alyssa Mendoza',
        address: 'Pacita Complex, San Pedro, Laguna',
        contact_no: '09171110001',
      },
      {
        student_number: '202301482',
        name: 'Miguel Santos',
        address: 'Ayala Alabang Village, Muntinlupa City',
        contact_no: '09171110002',
      },
      {
        student_number: '202200817',
        name: 'Bianca Reyes',
        address: 'Barangay Poblacion, Muntinlupa City',
        contact_no: '09171110003',
      },
      {
        student_number: '202500109',
        name: 'Nathaniel Cruz',
        address: 'San Antonio, Makati City',
        contact_no: '09171110004',
      },
      {
        student_number: '202301944',
        name: 'Sofia Dela Cruz',
        address: 'Poblacion, Makati City',
        contact_no: '09171110005',
      },
      {
        student_number: '202100672',
        name: 'Joaquin Navarro',
        address: 'Barangay Putatan, Muntinlupa City',
        contact_no: '09171110006',
      },
      {
        student_number: '202401260',
        name: 'Isabella Garcia',
        address: 'Barangay San Vicente, San Pedro, Laguna',
        contact_no: '09171110007',
      },
      {
        student_number: '202202215',
        name: 'Carlo Villanueva',
        address: 'Barangay Tunasan, Muntinlupa City',
        contact_no: '09171110008',
      },
    ])
    .returning({
      customer_id: customers.customer_id,
      student_number: customers.student_number,
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
  customerRows: Array<{ customer_id: number; student_number: string; name: string }>;
  riderUserId: number;
}) => {
  const productBySku = new Map(productRows.map((product) => [product.sku, product]));
  const getProduct = (sku: string) => {
    const product = productBySku.get(sku);
    if (!product) {
      throw new Error(`Demo product ${sku} was not created correctly.`);
    }

    return product;
  };

  const orderSpecs = [
    {
      customer: customerRows[0],
      order_date: addDays(-2),
      delivery_date: null,
      delivery_status: 'unassigned',
      items: [
        { product: getProduct('FULNB001'), quantity: 35 },
        { product: getProduct('FULPENBLK'), quantity: 20 },
        { product: getProduct('FULYELLOW'), quantity: 15 },
      ],
      discount: 150,
      delivery_fee: 0,
    },
    {
      customer: customerRows[1],
      order_date: addDays(-1),
      delivery_date: addDays(1),
      delivery_status: 'pending',
      items: [
        { product: getProduct('FULCALSCI'), quantity: 8 },
        { product: getProduct('FULNB001'), quantity: 12 },
        { product: getProduct('FULPENCIL'), quantity: 10 },
      ],
      discount: 250,
      delivery_fee: 120,
    },
    {
      customer: customerRows[2],
      order_date: addDays(0),
      delivery_date: addDays(0),
      delivery_status: 'out_for_delivery',
      items: [
        { product: getProduct('FULDRAFT'), quantity: 10 },
        { product: getProduct('FULCALSCI'), quantity: 5 },
        { product: getProduct('FULIDLACE'), quantity: 20 },
      ],
      discount: 300,
      delivery_fee: 150,
    },
    {
      customer: customerRows[3],
      order_date: addDays(-5),
      delivery_date: addDays(0),
      delivery_status: 'delivered',
      items: [
        { product: getProduct('FULTSHIRT'), quantity: 18 },
        { product: getProduct('FULHOODIE'), quantity: 6 },
        { product: getProduct('FULTOTE01'), quantity: 12 },
      ],
      discount: 500,
      delivery_fee: 100,
      delivered_at: new Date(),
    },
    {
      customer: customerRows[4],
      order_date: addDays(-3),
      delivery_date: addDays(0),
      delivery_status: 'failed',
      items: [
        { product: getProduct('FULNSTP01'), quantity: 25 },
        { product: getProduct('FULYELLOW'), quantity: 10 },
      ],
      discount: 0,
      delivery_fee: 100,
    },
    {
      customer: customerRows[5],
      order_date: addDays(-4),
      delivery_date: addDays(2),
      delivery_status: 'cancelled',
      items: [
        { product: getProduct('FULPEUNIF'), quantity: 14 },
        { product: getProduct('FULBOTTLE'), quantity: 14 },
      ],
      discount: 0,
      delivery_fee: 0,
    },
    {
      customer: customerRows[6],
      order_date: addDays(-7),
      delivery_date: addDays(-1),
      delivery_status: 'delivered',
      items: [
        { product: getProduct('FULIDLACE'), quantity: 60 },
        { product: getProduct('FULTOTE01'), quantity: 40 },
        { product: getProduct('FULNB001'), quantity: 40 },
        { product: getProduct('FULPENBLK'), quantity: 40 },
      ],
      discount: 750,
      delivery_fee: 180,
      delivered_at: addDays(-1),
    },
    {
      customer: customerRows[7],
      order_date: addDays(-1),
      delivery_date: addDays(1),
      delivery_status: 'pending',
      items: [
        { product: getProduct('FULNSTP01'), quantity: 45 },
        { product: getProduct('FULPENBLK'), quantity: 15 },
      ],
      discount: 200,
      delivery_fee: 120,
    },
    {
      customer: customerRows[1],
      order_date: addDays(0),
      delivery_date: addDays(0),
      delivery_status: 'out_for_delivery',
      items: [
        { product: getProduct('FULBOTTLE'), quantity: 9 },
        { product: getProduct('FULTSHIRT'), quantity: 9 },
      ],
      discount: 100,
      delivery_fee: 90,
    },
    {
      customer: customerRows[2],
      order_date: addDays(-12),
      delivery_date: addDays(-10),
      delivery_status: 'delivered',
      items: [
        { product: getProduct('FULDRAFT'), quantity: 6 },
        { product: getProduct('FULPENCIL'), quantity: 18 },
      ],
      discount: 120,
      delivery_fee: 100,
      delivered_at: addDays(-10),
    },
    {
      customer: customerRows[3],
      order_date: addDays(-6),
      delivery_date: null,
      delivery_status: 'unassigned',
      items: [
        { product: getProduct('FULHOODIE'), quantity: 4 },
        { product: getProduct('FULBOTTLE'), quantity: 8 },
      ],
      discount: 0,
      delivery_fee: 0,
    },
    {
      customer: customerRows[0],
      order_date: addDays(-8),
      delivery_date: addDays(-6),
      delivery_status: 'cancelled',
      items: [
        { product: getProduct('FULCALSCI'), quantity: 3 },
        { product: getProduct('FULYELLOW'), quantity: 6 },
      ],
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
      recipient_user_id: adminUserId,
      event_type: 'demo_admin_read',
      title: 'Demo bookstore order completed',
      message: `Order #${ordersByStatus.get('delivered')} was already reviewed and marked as read.`,
      order_id: ordersByStatus.get('delivered') ?? null,
      is_read: true,
      read_at: new Date(),
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
  const revokedSessionCount = await revokeAllTrackedDeviceSessions();
  const [adminUser, riderUser] = await Promise.all([
    ensureDemoUser(DEMO_ADMIN),
    ensureDemoUser(DEMO_USER),
  ]);

  await clearBusinessData();
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

  return { revokedSessionCount };
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
      const { revokedSessionCount } = await refreshDemoData();
      console.log(`Demo data refreshed. Revoked ${revokedSessionCount} tracked session(s).`);
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
