import { pgTable, serial, text, integer, timestamp, doublePrecision, varchar, foreignKey, check, uniqueIndex, boolean, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
};

export const users = pgTable('ims_users', {
	user_id: serial('user_id').primaryKey(),
	email: varchar('email', { length: 200 }).notNull(),
	password: varchar('password', { length: 200 }), // can be null if relying purely on supabase provider, but keeping it for legacy support
	username: varchar('username', { length: 200 }).notNull(),
	name: varchar('name', { length: 200 }).notNull().default('User'),
	phone_number: varchar('phone_number', { length: 20 }),
	acc_type: varchar('acc_type', { length: 50 }).notNull().default('User'), // 'Admin' or 'User'
	status: varchar('status', { length: 50 }).notNull().default('Active'), // 'Active' | 'Disabled' | 'Suspended'
	inactivity_timeout_minutes: integer('inactivity_timeout_minutes').notNull().default(60),
	session_timeout_enabled: boolean('session_timeout_enabled').notNull().default(true),
	supabase_id: varchar('supabase_id', { length: 255 }).notNull(), // To link with auth.users
	...timestamps,
}, (table) => ({
	usersEmailUnique: uniqueIndex('ims_users_email_unique').on(table.email),
	usersUsernameUnique: uniqueIndex('ims_users_username_unique').on(table.username),
	usersSupabaseIdUnique: uniqueIndex('ims_users_supabase_id_unique').on(table.supabase_id),
	usersAccTypeCheck: check('ims_users_acc_type_check', sql`${table.acc_type} IN ('Admin', 'User')`),
	usersStatusCheck: check('ims_users_status_check', sql`${table.status} IN ('Active', 'Disabled', 'Suspended')`),
	usersInactivityCheck: check('ims_users_inactivity_timeout_check', sql`${table.inactivity_timeout_minutes} BETWEEN 10 AND 480`)
}));

export const userDevices = pgTable('ims_user_devices', {
	device_id: varchar('device_id', { length: 80 }).primaryKey(),
	user_id: integer('user_id').notNull(),
	device_label: varchar('device_label', { length: 200 }),
	user_agent: text('user_agent').notNull().default('Unknown device'),
	timezone: varchar('timezone', { length: 80 }),
	last_ip: varchar('last_ip', { length: 80 }),
	first_seen_at: timestamp('first_seen_at').notNull().defaultNow(),
	last_seen_at: timestamp('last_seen_at').notNull().defaultNow(),
	...timestamps,
}, (table) => ({
	userDevicesUserFk: foreignKey({
		columns: [table.user_id],
		foreignColumns: [users.user_id],
	}),
	userDevicesUserSeenIdx: uniqueIndex('ims_user_devices_user_device_unique').on(table.user_id, table.device_id),
}));

export const revokedDeviceSessions = pgTable('ims_revoked_device_sessions', {
	revoked_session_id: serial('revoked_session_id').primaryKey(),
	user_id: integer('user_id').notNull(),
	device_id: varchar('device_id', { length: 80 }).notNull(),
	revoked_at: timestamp('revoked_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
	revokedDeviceUserFk: foreignKey({
		columns: [table.user_id],
		foreignColumns: [users.user_id],
	}),
	revokedDeviceUnique: uniqueIndex('ims_revoked_device_sessions_user_device_unique').on(table.user_id, table.device_id),
	revokedDeviceLookupIdx: index('ims_revoked_device_sessions_lookup_idx').on(table.user_id, table.device_id),
}));

export const products = pgTable('ims_products', {
	product_id: serial('product_id').primaryKey(),
	sku: varchar('sku', { length: 32 }),
	product_name: varchar('product_name', { length: 300 }).notNull(),
	price: doublePrecision('price').notNull(),
	status: varchar('status', { length: 50 }).notNull().default('active'), // 'active' or 'inactive'
	...timestamps,
}, (table) => ({
	productsSkuUnique: uniqueIndex('ims_products_sku_unique').on(table.sku),
	productsPriceCheck: check('ims_products_price_check', sql`${table.price} >= 0`),
	productsStatusCheck: check('ims_products_status_check', sql`${table.status} IN ('active', 'inactive')`)
}));

export const customers = pgTable('ims_customers', {
	customer_id: serial('customer_id').primaryKey(),
	student_number: varchar('student_number', { length: 20 }).notNull(),
	name: varchar('name', { length: 200 }).notNull(),
	address: text('address').notNull(),
	contact_no: varchar('contact_no', { length: 20 }).notNull(),
	...timestamps,
}, (table) => ({
	customersStudentNumberUnique: uniqueIndex('ims_customers_student_number_unique').on(table.student_number),
}));


export const orders = pgTable('ims_orders', {
	order_id: serial('order_id').primaryKey(),
	customer_id: integer('customer_id').notNull(),
	order_date: timestamp('order_date').defaultNow().notNull(),
	delivery_date: timestamp('delivery_date'),
	delivery_status: varchar('delivery_status', { length: 50 }).notNull().default('unassigned'),
	delivery_user_id: integer('delivery_user_id'),
	delivered_at: timestamp('delivered_at'),
	delivered_by: integer('delivered_by'),
	discount: doublePrecision('discount').notNull().default(0),
	delivery_fee: doublePrecision('delivery_fee').notNull().default(0),
	...timestamps,
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
	price: doublePrecision('price').notNull(),
	...timestamps,
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

export const notifications = pgTable('ims_notifications', {
	notification_id: serial('notification_id').primaryKey(),
	recipient_user_id: integer('recipient_user_id').notNull(),
	event_type: varchar('event_type', { length: 80 }).notNull(),
	title: varchar('title', { length: 200 }).notNull(),
	message: text('message').notNull(),
	order_id: integer('order_id'),
	is_read: boolean('is_read').notNull().default(false),
	read_at: timestamp('read_at', { withTimezone: true }),
	created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
	notificationsRecipientFk: foreignKey({
		columns: [table.recipient_user_id],
		foreignColumns: [users.user_id],
	}),
	notificationsOrderFk: foreignKey({
		columns: [table.order_id],
		foreignColumns: [orders.order_id],
	}),
	notificationsRecipientCreatedIdx: index('ims_notifications_recipient_created_idx').on(table.recipient_user_id, table.notification_id),
}));
