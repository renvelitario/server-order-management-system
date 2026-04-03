import { pgTable, serial, text, integer, timestamp, doublePrecision, varchar, foreignKey, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('ims_users', {
	user_id: serial('user_id').primaryKey(),
	email: varchar('email', { length: 200 }).notNull(),
	password: varchar('password', { length: 200 }), // can be null if relying purely on supabase provider, but keeping it for legacy support
	username: varchar('username', { length: 200 }).notNull(),
	acc_type: varchar('acc_type', { length: 50 }).notNull().default('User'), // 'Admin' or 'User'
	status: varchar('status', { length: 50 }).notNull().default('Active'), // 'Active' | 'Disabled' | 'Suspended'
	inactivity_timeout_minutes: integer('inactivity_timeout_minutes').notNull().default(60),
	supabase_id: varchar('supabase_id', { length: 255 }).notNull() // To link with auth.users
}, (table) => ({
	usersEmailUnique: uniqueIndex('ims_users_email_unique').on(table.email),
	usersSupabaseIdUnique: uniqueIndex('ims_users_supabase_id_unique').on(table.supabase_id),
	usersAccTypeCheck: check('ims_users_acc_type_check', sql`${table.acc_type} IN ('Admin', 'User')`),
	usersStatusCheck: check('ims_users_status_check', sql`${table.status} IN ('Active', 'Disabled', 'Suspended')`),
	usersInactivityCheck: check('ims_users_inactivity_timeout_check', sql`${table.inactivity_timeout_minutes} BETWEEN 10 AND 480`)
}));

export const products = pgTable('ims_products', {
	product_id: serial('product_id').primaryKey(),
	sku: varchar('sku', { length: 32 }),
	product_name: varchar('product_name', { length: 300 }).notNull(),
	price: doublePrecision('price').notNull(),
	status: varchar('status', { length: 50 }).notNull().default('active') // 'active' or 'inactive'
}, (table) => ({
	productsSkuUnique: uniqueIndex('ims_products_sku_unique').on(table.sku),
	productsPriceCheck: check('ims_products_price_check', sql`${table.price} >= 0`),
	productsStatusCheck: check('ims_products_status_check', sql`${table.status} IN ('active', 'inactive')`)
}));

export const customers = pgTable('ims_customers', {
	customer_id: serial('customer_id').primaryKey(),
	name: varchar('name', { length: 200 }).notNull(),
	address: text('address').notNull(),
	contact_no: varchar('contact_no', { length: 20 }).notNull()
});

export const orders = pgTable('ims_orders', {
	order_id: serial('order_id').primaryKey(),
	customer_id: integer('customer_id').notNull(),
	order_date: timestamp('order_date').defaultNow().notNull(),
	delivery_date: timestamp('delivery_date'),
	delivery_status: varchar('delivery_status', { length: 50 }).notNull().default('unassigned'),
	delivery_user_id: integer('delivery_user_id'),
	delivered_at: timestamp('delivered_at'),
	delivered_by: integer('delivered_by')
}, (table) => ({
	customerIdFk: foreignKey({
		columns: [table.customer_id],
		foreignColumns: [customers.customer_id]
	}),
	deliveryUserFk: foreignKey({
		columns: [table.delivery_user_id],
		foreignColumns: [users.user_id]
	}),
	deliveredByFk: foreignKey({
		columns: [table.delivered_by],
		foreignColumns: [users.user_id]
	}),
	ordersDeliveryStatusCheck: check('ims_orders_delivery_status_check', sql`${table.delivery_status} IN ('unassigned', 'pending', 'out_for_delivery', 'delivered', 'failed', 'cancelled')`)
}));

export const orderItems = pgTable('ims_order_items', {
	order_item_id: serial('order_item_id').primaryKey(),
	order_id: integer('order_id').notNull(),
	product_id: integer('product_id').notNull(),
	quantity: integer('quantity').notNull(),
	price: doublePrecision('price').notNull()
}, (table) => ({
	orderIdFk: foreignKey({
		columns: [table.order_id],
		foreignColumns: [orders.order_id]
	}),
	productIdFk: foreignKey({
		columns: [table.product_id],
		foreignColumns: [products.product_id]
	})
}));