import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/rbac.js';
import { asyncHandler } from '../utils/errors.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.js';
import { deliveryAssignmentSchema, orderPayloadSchema, updateDeliveryStatusSchema } from '../validators/entity.js';
import {
  getOrderByIdHandler,
  listAdminDeliveryOrdersHandler,
  listOrdersHandler,
  listTodayDeliveryOrdersHandler,
} from './orders.read.handlers.js';
import {
  createOrderHandler,
  deleteOrderHandler,
  updateOrderDeliveryAssignmentHandler,
  updateOrderDeliveryStatusHandler,
  updateOrderHandler,
} from './orders.write.handlers.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('Admin', 'User'), asyncHandler(listOrdersHandler));

router.get('/delivery/admin', requireAdmin, asyncHandler(listAdminDeliveryOrdersHandler));

router.get('/delivery/today', requireRole('Admin', 'User'), asyncHandler(listTodayDeliveryOrdersHandler));

router.get('/:id', requireRole('Admin', 'User'), validate(idParamSchema, 'params'), asyncHandler(getOrderByIdHandler));

router.post('/', requireAdmin, validate(orderPayloadSchema), asyncHandler(createOrderHandler));

router.put('/:id', requireAdmin, validate(idParamSchema, 'params'), validate(orderPayloadSchema), asyncHandler(updateOrderHandler));

router.patch('/:id/delivery-status', requireRole('Admin', 'User'), validate(idParamSchema, 'params'), validate(updateDeliveryStatusSchema), asyncHandler(updateOrderDeliveryStatusHandler));

router.patch('/:id/delivery-assignment', requireAdmin, validate(idParamSchema, 'params'), validate(deliveryAssignmentSchema), asyncHandler(updateOrderDeliveryAssignmentHandler));

router.delete('/:id', requireAdmin, validate(idParamSchema, 'params'), asyncHandler(deleteOrderHandler));

export default router;
