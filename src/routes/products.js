import express from 'express';
import { db } from '../db/db.js';
import { products, orderItems, purchases } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allProducts = await db.select().from(products);
    res.json(allProducts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const product = await db.select().from(products).where(eq(products.product_id, parseInt(req.params.id)));
    if (!product.length) return res.status(404).json({ error: 'Product not found' });
    res.json(product[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { product_name, quantity, price, status } = req.body;
    const parsedQty = parseInt(quantity || 0, 10);
    const parsedPrice = parseFloat(price || 0);

    if (!product_name || !product_name.trim()) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    if (Number.isNaN(parsedQty) || Number.isNaN(parsedPrice) || parsedQty < 0 || parsedPrice < 0) {
      return res.status(400).json({ error: 'Quantity and price cannot be negative.' });
    }

    const [newProduct] = await db.insert(products).values({
      product_name: product_name.trim(),
      quantity: parsedQty,
      price: parsedPrice,
      status: status || 'active'
    }).returning();
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { product_name, quantity, price, status } = req.body;
    const parsedQty = parseInt(quantity, 10);
    const parsedPrice = parseFloat(price);

    if (!product_name || !product_name.trim()) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    if (Number.isNaN(parsedQty) || Number.isNaN(parsedPrice) || parsedQty < 0 || parsedPrice < 0) {
      return res.status(400).json({ error: 'Quantity and price cannot be negative.' });
    }

    const [updatedProduct] = await db.update(products).set({
      product_name: product_name.trim(),
      quantity: parsedQty,
      price: parsedPrice,
      status
    }).where(eq(products.product_id, parseInt(req.params.id))).returning();

    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    const inOrderItems = await db.select().from(orderItems).where(eq(orderItems.product_id, productId));
    if (inOrderItems.length > 0) {
      return res.status(409).json({ error: 'This record cannot be deleted because it is used in other records.' });
    }

    const inPurchases = await db.select().from(purchases).where(eq(purchases.product_id, productId));
    if (inPurchases.length > 0) {
      return res.status(409).json({ error: 'This record cannot be deleted because it is used in other records.' });
    }

    await db.delete(products).where(eq(products.product_id, productId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
