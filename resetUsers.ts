import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, supabaseAdmin } from './src/db/db.js';
import { orders, users, userDevices } from './src/db/schema.js';

const DEMO_ADMIN_EMAIL = 'admin@admin.com';
const DEMO_ADMIN_PASSWORD = 'Admin1234';
const DEMO_ADMIN_USERNAME = 'Admin';
const DEMO_ADMIN_NAME = 'Admin';
const DEMO_USER_EMAIL = 'user@user.com';
const DEMO_USER_PASSWORD = 'User1234';
const DEMO_USER_USERNAME = 'User';
const DEMO_USER_NAME = 'Demo User';
const SUPABASE_PAGE_SIZE = 200;

async function listAllAuthUsers() {
  const authUsers: Array<{ id: string; email?: string | null }> = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: SUPABASE_PAGE_SIZE,
    });

    if (error) {
      throw error;
    }

    authUsers.push(...data.users.map((user) => ({ id: user.id, email: user.email })));

    if (data.users.length < SUPABASE_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return authUsers;
}

async function deleteAllAuthUsers() {
  let deletedUsersCount = 0;

  while (true) {
    const authUsers = await listAllAuthUsers();
    if (authUsers.length === 0) {
      break;
    }

    console.log(`Deleting ${authUsers.length} Supabase auth user(s)...`);

    for (const authUser of authUsers) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
      if (error) {
        throw new Error(`Failed to delete auth user ${authUser.email ?? authUser.id}: ${error.message}`);
      }

      deletedUsersCount += 1;
    }
  }

  console.log(`Deleted ${deletedUsersCount} Supabase auth user(s) in total.`);
}

async function resetLocalUsers() {
  console.log('Clearing user references from orders...');
  await db
    .update(orders)
    .set({
      delivery_user_id: null,
      delivered_by: null,
    });

  console.log('Deleting user devices...');
  await db.delete(userDevices);

  console.log('Deleting local users...');
  await db.delete(users);

  console.log('Resetting ims_users identity sequence...');
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('ims_users', 'user_id'),
      1,
      false
    )
  `);
}

async function seedDemoAdmin() {
  console.log('Creating demo admin in Supabase Auth...');
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_ADMIN_EMAIL,
    password: DEMO_ADMIN_PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw error ?? new Error('Supabase did not return the created admin user.');
  }

  console.log('Creating demo admin profile in ims_users...');
  await db.insert(users).values({
    email: DEMO_ADMIN_EMAIL,
    username: DEMO_ADMIN_USERNAME,
    name: DEMO_ADMIN_NAME,
    acc_type: 'Admin',
    status: 'Active',
    supabase_id: data.user.id,
  });
}

async function seedDemoUser() {
  console.log('Creating demo user in Supabase Auth...');
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_USER_EMAIL,
    password: DEMO_USER_PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw error ?? new Error('Supabase did not return the created user.');
  }

  console.log('Creating demo user profile in ims_users...');
  await db.insert(users).values({
    email: DEMO_USER_EMAIL,
    username: DEMO_USER_USERNAME,
    name: DEMO_USER_NAME,
    acc_type: 'User',
    status: 'Active',
    supabase_id: data.user.id,
  });
}

async function resetUsers() {
  try {
    await resetLocalUsers();
    await deleteAllAuthUsers();
    await seedDemoAdmin();
    await seedDemoUser();
    console.log('Users reset complete. Demo admin and user restored.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to reset users:', error);
    process.exit(1);
  }
}

void resetUsers();
