import express from 'express';
import { db } from '../db/db.js';
import { orders, products } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allOrders = await db.select().from(orders);
    const allProducts = await db.select().from(products);
    const productPriceById = new Map(allProducts.map((p) => [String(p.product_id), Number(p.price)]));

    const withAmount = allOrders.map((order) => ({
      ...order,
      amount: Number(order.quantity) * (productPriceById.get(String(order.product_id)) || 0)
    }));

    res.json(withAmount);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { product_id, customer_id, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    if (!product_id || !customer_id || Number.isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Please enter a valid quantity greater than 0.' });
    }
    
    // Decrement product quantity
    const targetProductQuery = await db.select().from(products).where(eq(products.product_id, parseInt(product_id)));
    if (!targetProductQuery.length) return res.status(404).json({ error: 'Product not found' });
    
    const product = targetProductQuery[0];
    if (String(product.status).toLowerCase() !== 'active') {
      return res.status(400).json({ error: 'Cannot order inactive product.' });
    }

    if (product.quantity < qty) {
      return res.status(400).json({ error: 'Insufficient product quantity' });
    }

    await db.update(products)
      .set({ quantity: product.quantity - qty })
      .where(eq(products.product_id, parseInt(product_id)));

    // Insert order
    const [newOrder] = await db.insert(orders).values({
      product_id: product_id.toString(),
      customer_id: parseInt(customer_id),
      quantity: qty
    }).returning();
    
    res.status(201).json(newOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.delete(orders).where(eq(orders.order_id, parseInt(req.params.id)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
