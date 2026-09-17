import express, { Router } from 'express';
import { getPublicSubscriptionPlans } from '../controllers/subscriptionPlanController';

const router: Router = express.Router();

// Public / Hotel Admin endpoint to view available pricing tiers
router.get('/', getPublicSubscriptionPlans);

export default router;
