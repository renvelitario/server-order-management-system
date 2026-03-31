import express from 'express';
import { db } from '../db/db.js';
import { orders, orderItems, products } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// Get all orders with their items
router.get('/', async (req, res) => {
  try {
    const [allOrders, allOrderItems] = await Promise.all([
      db.select().from(orders),
      db.select().from(orderItems),
    ]);

    const itemsByOrderId = allOrderItems.reduce((acc, item) => {
      const key = item.order_id;
      if (!acc.has(key)) {
        acc.set(key, []);
      }
      acc.get(key).push(item);
      return acc;
    }, new Map());

    const ordersWithItems = allOrders.map((order) => {
      const items = itemsByOrderId.get(order.order_id) || [];
      const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.price)), 0);

      return {
        ...order,
        items,
        total_amount: totalAmount,
      };
    });

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

    const productById = new Map();

    // Validate all products exist and have sufficient quantity
    for (const item of items_data) {
      const { product_id, quantity } = item;
      const parsedProductId = parseInt(product_id, 10);
      const qty = parseInt(quantity, 10);

      if (!parsedProductId || Number.isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Each item must have valid product_id and quantity > 0' });
      }

      const productQuery = await db.select().from(products).where(eq(products.product_id, parsedProductId));
      if (!productQuery.length) {
        return res.status(404).json({ error: `Product ${parsedProductId} not found` });
      }

      const product = productQuery[0];
      if (String(product.status).toLowerCase() !== 'active') {
        return res.status(400).json({ error: `Product ${parsedProductId} is not active` });
      }

      if (product.quantity < qty) {
        return res.status(400).json({ error: `Insufficient quantity for product ${parsedProductId}` });
      }

      productById.set(parsedProductId, product);
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
      const parsedProductId = parseInt(product_id, 10);
      const qty = parseInt(quantity, 10);

      const product = productById.get(parsedProductId);

      // Create order item
      const [orderItem] = await db.insert(orderItems).values({
        order_id: newOrder.order_id,
        product_id: parsedProductId,
        quantity: qty,
        price: product.price
      }).returning();

      createdItems.push(orderItem);

      // Decrement product quantity
      await db.update(products)
        .set({ quantity: product.quantity - qty })
        .where(eq(products.product_id, parsedProductId));

      productById.set(parsedProductId, {
        ...product,
        quantity: product.quantity - qty,
      });
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
