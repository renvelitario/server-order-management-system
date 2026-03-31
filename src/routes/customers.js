import express from 'express';
import { db } from '../db/db.js';
import { customers, orders } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allCustomers = await db.select().from(customers);
    res.json(allCustomers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const customer = await db.select().from(customers).where(eq(customers.customer_id, parseInt(req.params.id)));
    if (!customer.length) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, address, contact_no } = req.body;

    if (!name || !address || !contact_no) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const [newCustomer] = await db.insert(customers).values({
      name: name.trim(),
      address: address.trim(),
      contact_no: contact_no.trim()
    }).returning();
    res.status(201).json(newCustomer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, address, contact_no } = req.body;

    if (!name || !address || !contact_no) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const [updatedCustomer] = await db.update(customers).set({
      name: name.trim(),
      address: address.trim(),
      contact_no: contact_no.trim()
    }).where(eq(customers.customer_id, parseInt(req.params.id))).returning();

    if (!updatedCustomer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(updatedCustomer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);

    const customerOrders = await db.select().from(orders).where(eq(orders.customer_id, customerId));
    if (customerOrders.length > 0) {
      return res.status(409).json({ error: 'This record cannot be deleted because it is used in other records.' });
    }

    await db.delete(customers).where(eq(customers.customer_id, customerId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
