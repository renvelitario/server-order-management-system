import express from 'express';
import { db } from '../db/db.js';
import { purchases, products } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allPurchases = await db.select().from(purchases);
    res.json(allPurchases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { product_id, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    if (!product_id || Number.isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Please enter a valid quantity greater than 0.' });
    }
    
    // Increment product quantity
    const targetProductQuery = await db.select().from(products).where(eq(products.product_id, parseInt(product_id)));
    if (!targetProductQuery.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = targetProductQuery[0];
    await db.update(products)
      .set({ quantity: product.quantity + qty })
      .where(eq(products.product_id, parseInt(product_id)));

    // Insert purchase
    const [newPurchase] = await db.insert(purchases).values({
      product_id: product_id.toString(),
      quantity: qty.toString()
    }).returning();
    
    res.status(201).json(newPurchase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.delete(purchases).where(eq(purchases.purchase_id, parseInt(req.params.id)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
