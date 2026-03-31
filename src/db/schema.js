import { pgTable, serial, text, integer, timestamp, doublePrecision, varchar, foreignKey } from 'drizzle-orm/pg-core';

export const users = pgTable('ims_users', {
	user_id: serial('user_id').primaryKey(),
	email: varchar('email', { length: 200 }).notNull(),
	password: varchar('password', { length: 200 }), // can be null if relying purely on supabase provider, but keeping it for legacy support
	username: varchar('username', { length: 200 }).notNull(),
	acc_type: varchar('acc_type', { length: 50 }).notNull().default('User'), // 'Admin' or 'User'
	status: varchar('status', { length: 50 }).notNull().default('Active'), // 'Active' or 'Inactive'
	inactivity_timeout_minutes: integer('inactivity_timeout_minutes').notNull().default(60),
	supabase_id: varchar('supabase_id', { length: 255 }) // To link with auth.users
});

export const products = pgTable('ims_products', {
	product_id: serial('product_id').primaryKey(),
	product_name: varchar('product_name', { length: 300 }).notNull(),
	quantity: integer('quantity').notNull(),
	price: doublePrecision('price').notNull(),
	status: varchar('status', { length: 50 }).notNull().default('active') // 'active' or 'inactive'
});

export const customers = pgTable('ims_customers', {
	customer_id: serial('customer_id').primaryKey(),
	name: varchar('name', { length: 200 }).notNull(),
	address: text('address').notNull(),
	contact_no: varchar('contact_no', { length: 20 }).notNull()
});

export const orders = pgTable('ims_orders', {
	order_id: serial('order_id').primaryKey(),
	customer_id: integer('customer_id').notNull(),
	order_date: timestamp('order_date').defaultNow().notNull()
}, (table) => ({
	customerIdFk: foreignKey({
		columns: [table.customer_id],
		foreignColumns: [customers.customer_id]
	})
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

export const purchases = pgTable('ims_purchases', {
	purchase_id: serial('purchase_id').primaryKey(),
	product_id: integer('product_id').notNull(),
	quantity: integer('quantity').notNull(),
	purchase_date: timestamp('purchase_date').defaultNow().notNull()
}, (table) => ({
	productIdFk: foreignKey({
		columns: [table.product_id],
		foreignColumns: [products.product_id]
	})
}));