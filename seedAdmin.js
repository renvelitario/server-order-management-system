import { supabaseAdmin, db } from './src/db/db.js';
import { users } from './src/db/schema.js';

async function seedAdmin() {
  const email = 'admin@admin.com';
  const password = 'admin';
  const username = 'Admin';

  console.log('Creating Admin user in Supabase Auth...');
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error) {
    if (error.message.includes('already registered')) {
      console.log('User already exists in Supabase. Attempting to insert into local DB if missing.');
      // Find the user ID manually if we need to, but skip for now
    } else {
      console.error('Error creating user:', error.message);
      process.exit(1);
    }
  }

  if (data?.user) {
    console.log('Creating Admin profile in ims_users...');
    try {
      await db.insert(users).values({
        email,
        username,
        acc_type: 'Admin',
        status: 'Active',
        supabase_id: data.user.id
      });
      console.log('Admin user seeded successfully!');
    } catch (dbError) {
      if (dbError.code === '23505') { // unique violation
        console.log('User already in ims_users.');
      } else {
        console.error('Database insertion error:', dbError);
      }
    }
  }
  
  process.exit(0);
}

seedAdmin();
