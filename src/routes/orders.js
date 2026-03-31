import express from 'express';
import { db } from '../db/db.js';
import { orders, orderItems, products, customers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// Get all orders with their items
router.get('/', async (req, res) => {
  try {
    const allOrders = await db.select().from(orders);
    
    const ordersWithItems = await Promise.all(
      allOrders.map(async (order) => {
        const items = await db.select().from(orderItems).where(eq(orderItems.order_id, order.order_id));
        const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);
        return {
          ...order,
          items: items,
          total_amount: totalAmount
        };
      })
    );

    res.json(ordersWithItems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single order with items
router.get('/:id', async (req, res) => {
  try {
    const order = await db.select().from(orders).where(eq(orders.order_id, parseInt(req.params.id)));
    if (!order.length) return res.status(404).json({ error: 'Order not found' });
    
    const items = await db.select().from(orderItems).where(eq(orderItems.order_id, order[0].order_id));
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);
    
    res.json({
      ...order[0],
      items: items,
      total_amount: totalAmount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create order with items
router.post('/', async (req, res) => {
  try {
    const { customer_id, items_data } = req.body;

    if (!customer_id || !items_data || !Array.isArray(items_data) || items_data.length === 0) {
      return res.status(400).json({ error: 'customer_id and items_data array (with product_id and quantity) are required' });
    }

    // Validate all products exist and have sufficient quantity
    for (const item of items_data) {
      const { product_id, quantity } = item;
      const qty = parseInt(quantity, 10);

      if (!product_id || Number.isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Each item must have valid product_id and quantity > 0' });
      }

      const productQuery = await db.select().from(products).where(eq(products.product_id, parseInt(product_id)));
      if (!productQuery.length) {
        return res.status(404).json({ error: `Product ${product_id} not found` });
      }

      const product = productQuery[0];
      if (String(product.status).toLowerCase() !== 'active') {
        return res.status(400).json({ error: `Product ${product_id} is not active` });
      }

      if (product.quantity < qty) {
        return res.status(400).json({ error: `Insufficient quantity for product ${product_id}` });
      }
    }

    // Create order
    const [newOrder] = await db.insert(orders).values({
      customer_id: parseInt(customer_id),
      order_date: new Date()
    }).returning();

    // Create order items and decrement product quantities
    const createdItems = [];
    for (const item of items_data) {
      const { product_id, quantity } = item;
      const qty = parseInt(quantity, 10);

      // Get product details for price
      const [product] = await db.select().from(products).where(eq(products.product_id, parseInt(product_id)));

      // Create order item
      const [orderItem] = await db.insert(orderItems).values({
        order_id: newOrder.order_id,
        product_id: parseInt(product_id),
        quantity: qty,
        price: product.price
      }).returning();

      createdItems.push(orderItem);

      // Decrement product quantity
      await db.update(products)
        .set({ quantity: product.quantity - qty })
        .where(eq(products.product_id, parseInt(product_id)));
    }

    const totalAmount = createdItems.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);

    res.status(201).json({
      ...newOrder,
      items: createdItems,
      total_amount: totalAmount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete order (and its items)
router.delete('/:id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    
    // Get order items to reverse product quantities
    const items = await db.select().from(orderItems).where(eq(orderItems.order_id, orderId));
    
    // Restore product quantities
    for (const item of items) {
      const [product] = await db.select().from(products).where(eq(products.product_id, item.product_id));
      if (product) {
        await db.update(products)
          .set({ quantity: product.quantity + item.quantity })
          .where(eq(products.product_id, item.product_id));
      }
    }

    // Delete order items first (due to FK constraint)
    await db.delete(orderItems).where(eq(orderItems.order_id, orderId));
    
    // Delete order
    await db.delete(orders).where(eq(orders.order_id, orderId));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
