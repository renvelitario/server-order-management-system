import { pgTable, serial, text, integer, timestamp, doublePrecision, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('ims_users', {
  user_id: serial('user_id').primaryKey(),
  email: varchar('email', { length: 200 }).notNull(),
  password: varchar('password', { length: 200 }), // can be null if relying purely on supabase provider, but keeping it for legacy support
  username: varchar('username', { length: 200 }).notNull(),
  acc_type: varchar('acc_type', { length: 50 }).notNull().default('User'), // 'Admin' or 'User'
  status: varchar('status', { length: 50 }).notNull().default('Active'), // 'Active' or 'Inactive'
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
  cust_id: serial('cust_id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  address: text('address').notNull(),
  contact_no: varchar('contact_no', { length: 20 }).notNull()
});

export const orders = pgTable('ims_orders', {
  order_id: serial('order_id').primaryKey(),
  product_id: varchar('product_id', { length: 255 }).notNull(), // using varchar since original was varchar
  customer_id: integer('customer_id').notNull(),
  quantity: integer('quantity').notNull(),
  order_date: timestamp('order_date').defaultNow().notNull()
});

export const purchases = pgTable('ims_purchases', {
  purchase_id: serial('purchase_id').primaryKey(),
  product_id: varchar('product_id', { length: 255 }).notNull(), // using varchar since original was varchar
  quantity: varchar('quantity', { length: 255 }).notNull(), // original was varchar
  purchase_date: timestamp('purchase_date').defaultNow().notNull()
});
