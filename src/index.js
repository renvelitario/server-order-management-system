import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import authRoutes from './routes/auth.js';
import productsRoutes from './routes/products.js';
import customersRoutes from './routes/customers.js';
import ordersRoutes from './routes/orders.js';
import purchasesRoutes from './routes/purchases.js';
import usersRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import { errorHandler } from './utils/errors.js';

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesAllowedOrigin = (origin) => {
  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === origin) {
      return true;
    }

    if (!allowedOrigin.includes('*')) {
      return false;
    }

    const wildcardPattern = `^${escapeRegex(allowedOrigin).replace(/\\\*/g, '.*')}$`;
    return new RegExp(wildcardPattern).test(origin);
  });
};

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || matchesAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS origin denied'));
  },
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/', (req, res) => {
  res.send('Inventory Management System API is running.');
});

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
