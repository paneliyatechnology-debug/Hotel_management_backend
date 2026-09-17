import { Request, Response } from 'express';
import SubscriptionPlan from '../models/SubscriptionPlan';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import logAuditAction from '../utils/auditLogger';

export const DEFAULT_PLANS = [
  // 3 MONTHLY PLANS
  {
    name: 'Starter Boutique',
    code: 'MONTHLY_STARTER',
    billingCycle: 'MONTHLY',
    price: 4999,
    discountPercent: 0,
    maxRooms: 15,
    description: 'Perfect for boutique hotels, B&Bs, and guesthouses up to 15 rooms.',
    features: [
      'Up to 15 Rooms Inventory',
      'Front Desk & Instant Walk-in Wizard',
      'Govt ID Compliance & Police Ledger',
      'GST Tax Invoice & Receipt Generator',
      'Standard Email Support',
    ],
    badge: '',
    isPopular: false,
    displayOrder: 1,
    isActive: true,
    isDeleted: false,
  },
  {
    name: 'Professional Resort',
    code: 'MONTHLY_PRO',
    billingCycle: 'MONTHLY',
    price: 9999,
    discountPercent: 0,
    maxRooms: 50,
    description: 'For mid-size luxury hotels and resorts requiring multi-staff operations.',
    features: [
      'Up to 50 Rooms Inventory',
      'Full PMS Operations & Room Matrix',
      'Multi-Staff Shifts & Receptionist Roster',
      'In-Room POS Ancillary Charges',
      'Advanced Revenue & Occupancy Reports',
      'Priority Support',
    ],
    badge: 'MOST POPULAR',
    isPopular: true,
    displayOrder: 2,
    isActive: true,
    isDeleted: false,
  },
  {
    name: 'Enterprise Multi-Property',
    code: 'MONTHLY_ENTERPRISE',
    billingCycle: 'MONTHLY',
    price: 24999,
    discountPercent: 0,
    maxRooms: 9999,
    description: 'For hotel chains, heritage palaces, and large resort complexes with unlimited rooms.',
    features: [
      'Unlimited Room Inventory',
      'Multi-Property Central Governance',
      'Automated Guest SMS & WhatsApp Alerts',
      'Custom API & Channel Manager Ready',
      'Dedicated Account Manager & 24/7 SLA',
    ],
    badge: 'ENTERPRISE',
    isPopular: false,
    displayOrder: 3,
    isActive: true,
    isDeleted: false,
  },

  // 3 ANNUAL PLANS
  {
    name: 'Starter Boutique (Annual)',
    code: 'ANNUAL_STARTER',
    billingCycle: 'ANNUAL',
    price: 49999,
    discountPercent: 17,
    maxRooms: 15,
    description: 'Annual license with 17% savings. Ideal for boutique properties up to 15 rooms.',
    features: [
      'Up to 15 Rooms Inventory',
      'Front Desk & Instant Walk-in Wizard',
      'Govt ID Compliance & Police Ledger',
      'GST Tax Invoice & Receipt Generator',
      '2 Months Free with Annual Billing',
      'Standard Email Support',
    ],
    badge: '',
    isPopular: false,
    displayOrder: 4,
    isActive: true,
    isDeleted: false,
  },
  {
    name: 'Professional Resort (Annual)',
    code: 'ANNUAL_PRO',
    billingCycle: 'ANNUAL',
    price: 99999,
    discountPercent: 17,
    maxRooms: 50,
    description: 'Our most popular tier with annual savings. For luxury hotels up to 50 rooms.',
    features: [
      'Up to 50 Rooms Inventory',
      'Full PMS Operations & Room Matrix',
      'Multi-Staff Shifts & Receptionist Roster',
      'In-Room POS Ancillary Charges',
      'Advanced Revenue & Occupancy Reports',
      'Priority 24/7 Support',
      '2 Months Free Included',
    ],
    badge: 'BEST VALUE',
    isPopular: true,
    displayOrder: 5,
    isActive: true,
    isDeleted: false,
  },
  {
    name: 'Enterprise Multi-Property (Annual)',
    code: 'ANNUAL_ENTERPRISE',
    billingCycle: 'ANNUAL',
    price: 249999,
    discountPercent: 17,
    maxRooms: 9999,
    description: 'Complete hotel chain infrastructure with maximum annual cost optimization.',
    features: [
      'Unlimited Room Inventory',
      'Multi-Property Central Governance',
      'Automated Guest SMS & WhatsApp Alerts',
      'Custom API & Channel Manager Ready',
      'Dedicated Account Manager & 24/7 SLA',
      'Free Onsite Staff Training Support',
    ],
    badge: 'ENTERPRISE',
    isPopular: false,
    displayOrder: 6,
    isActive: true,
    isDeleted: false,
  },
];

// Helper to ensure database has the initial 6 plans
export const ensureDefaultPlansExist = async (): Promise<void> => {
  const count = await SubscriptionPlan.countDocuments({ isDeleted: { $ne: true } });
  if (count === 0) {
    await SubscriptionPlan.insertMany(DEFAULT_PLANS);
    console.log('✅ Seeded default 6 Subscription Plans (3 Monthly + 3 Annual)');
  }
};

// @desc    Get All Active Subscription Plans (Public / Hotel Admin)
// @route   GET /api/v1/subscription-plans
export const getPublicSubscriptionPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const plans = await SubscriptionPlan.find({ isActive: true, isDeleted: { $ne: true } }).sort({ displayOrder: 1, price: 1 });

    const monthlyPlans = plans.filter((p) => p.billingCycle === 'MONTHLY');
    const annualPlans = plans.filter((p) => p.billingCycle === 'ANNUAL');

    res.status(200).json({
      success: true,
      data: {
        all: plans,
        monthly: monthlyPlans,
        annual: annualPlans,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Subscription Plans for Super Admin (with limit metrics)
// @route   GET /api/v1/super-admin/subscription-plans
export const getSuperAdminSubscriptionPlans = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const plans = await SubscriptionPlan.find({ isDeleted: { $ne: true } }).sort({ billingCycle: 1, displayOrder: 1, price: 1 });

    const monthlyCount = plans.filter((p) => p.billingCycle === 'MONTHLY').length;
    const annualCount = plans.filter((p) => p.billingCycle === 'ANNUAL').length;
    const totalCount = plans.length;

    res.status(200).json({
      success: true,
      meta: {
        monthlyCount,
        maxMonthly: 3,
        canAddMonthly: monthlyCount < 3,
        annualCount,
        maxAnnual: 3,
        canAddAnnual: annualCount < 3,
        totalCount,
        maxTotal: 6,
        canAddTotal: totalCount < 6,
      },
      data: plans,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a New Subscription Plan (Strict 3 Monthly & 3 Annual Guard)
// @route   POST /api/v1/super-admin/subscription-plans
export const createSubscriptionPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      name,
      code,
      billingCycle,
      price,
      discountPercent = 0,
      maxRooms = 50,
      description = '',
      features = [],
      badge = '',
      isPopular = false,
      isActive = true,
      displayOrder,
    } = req.body;

    if (!name || !price || !billingCycle) {
      res.status(400).json({
        success: false,
        message: 'Plan Name, Price, and Billing Cycle (MONTHLY or ANNUAL) are required.',
      });
      return;
    }

    const normalizedCycle = String(billingCycle).toUpperCase();
    if (normalizedCycle !== 'MONTHLY' && normalizedCycle !== 'ANNUAL') {
      res.status(400).json({
        success: false,
        message: 'Invalid Billing Cycle. Must be either MONTHLY or ANNUAL.',
      });
      return;
    }

    // STRICT LIMIT VALIDATION: Exactly max 3 Monthly, max 3 Annual, total max 6
    const currentCycleCount = await SubscriptionPlan.countDocuments({
      billingCycle: normalizedCycle,
      isDeleted: { $ne: true },
    });

    if (currentCycleCount >= 3) {
      res.status(400).json({
        success: false,
        message: `Plan limit reached: You can have a maximum of 3 ${normalizedCycle} subscription plans. Please edit or archive an existing ${normalizedCycle} plan.`,
      });
      return;
    }

    const totalCount = await SubscriptionPlan.countDocuments({ isDeleted: { $ne: true } });
    if (totalCount >= 6) {
      res.status(400).json({
        success: false,
        message: 'Total plan limit reached: System allows a maximum of 6 active subscription plans (3 Monthly + 3 Annual).',
      });
      return;
    }

    const planCode = code || `${normalizedCycle}_${name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${Date.now().toString().slice(-4)}`;

    const plan = await SubscriptionPlan.create({
      name,
      code: planCode,
      billingCycle: normalizedCycle,
      price: Number(price),
      discountPercent: Number(discountPercent) || 0,
      maxRooms: Number(maxRooms) || 50,
      description,
      features: Array.isArray(features) ? features : typeof features === 'string' ? features.split('\n').filter(Boolean) : [],
      badge,
      isPopular: Boolean(isPopular),
      isActive: isActive !== false,
      displayOrder: Number(displayOrder) || (totalCount + 1),
      isDeleted: false,
    });

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'SUBSCRIPTION_PLAN_CREATED',
        module: 'SUBSCRIPTIONS',
        entityId: plan.name,
        newValue: { name: plan.name, price: plan.price, billingCycle: plan.billingCycle },
      });
    }

    res.status(201).json({
      success: true,
      message: `Subscription plan '${plan.name}' (${normalizedCycle}) created successfully.`,
      data: plan,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a Subscription Plan
// @route   PUT /api/v1/super-admin/subscription-plans/:id
export const updateSubscriptionPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const plan = await SubscriptionPlan.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!plan) {
      res.status(404).json({ success: false, message: 'Subscription plan not found.' });
      return;
    }

    const {
      name,
      code,
      billingCycle,
      price,
      discountPercent,
      maxRooms,
      description,
      features,
      badge,
      isPopular,
      isActive,
      displayOrder,
    } = req.body;

    if (billingCycle && billingCycle !== plan.billingCycle) {
      const normalizedCycle = String(billingCycle).toUpperCase();
      const targetCycleCount = await SubscriptionPlan.countDocuments({
        billingCycle: normalizedCycle,
        _id: { $ne: plan._id },
        isDeleted: { $ne: true },
      });

      if (targetCycleCount >= 3) {
        res.status(400).json({
          success: false,
          message: `Cannot switch billing cycle: Target ${normalizedCycle} already has the maximum of 3 plans.`,
        });
        return;
      }
      plan.billingCycle = normalizedCycle as any;
    }

    if (name !== undefined) plan.name = name;
    if (code !== undefined) plan.code = code.toUpperCase();
    if (price !== undefined) plan.price = Number(price);
    if (discountPercent !== undefined) plan.discountPercent = Number(discountPercent);
    if (maxRooms !== undefined) plan.maxRooms = Number(maxRooms);
    if (description !== undefined) plan.description = description;
    if (features !== undefined) {
      plan.features = Array.isArray(features) ? features : typeof features === 'string' ? features.split('\n').filter(Boolean) : [];
    }
    if (badge !== undefined) plan.badge = badge;
    if (isPopular !== undefined) plan.isPopular = Boolean(isPopular);
    if (isActive !== undefined) plan.isActive = Boolean(isActive);
    if (displayOrder !== undefined) plan.displayOrder = Number(displayOrder);

    await plan.save();

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'SUBSCRIPTION_PLAN_UPDATED',
        module: 'SUBSCRIPTIONS',
        entityId: plan.name,
      });
    }

    res.status(200).json({
      success: true,
      message: `Subscription plan '${plan.name}' updated successfully.`,
      data: plan,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Soft Delete a Subscription Plan
// @route   DELETE /api/v1/super-admin/subscription-plans/:id
export const deleteSubscriptionPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const plan = await SubscriptionPlan.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!plan) {
      res.status(404).json({ success: false, message: 'Subscription plan not found.' });
      return;
    }

    plan.isActive = false;
    plan.isDeleted = true;
    await plan.save();

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'SUBSCRIPTION_PLAN_DELETED',
        module: 'SUBSCRIPTIONS',
        entityId: plan.name,
      });
    }

    res.status(200).json({
      success: true,
      message: `Subscription plan '${plan.name}' archived successfully.`,
      data: plan,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Reset / Restore Default 6 Plans
// @route   POST /api/v1/super-admin/subscription-plans/reset-defaults
export const resetDefaultSubscriptionPlans = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Soft delete any current active plans
    await SubscriptionPlan.updateMany({ isDeleted: { $ne: true } }, { isDeleted: true, isActive: false });

    // Insert standard 6 default plans
    const created = await SubscriptionPlan.insertMany(DEFAULT_PLANS);

    if (req.user) {
      await logAuditAction({
        user: req.user,
        action: 'SUBSCRIPTION_PLANS_RESET_DEFAULTS',
        module: 'SUBSCRIPTIONS',
        entityId: 'SYSTEM',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Standard 6 Subscription Plans (3 Monthly + 3 Annual) restored successfully.',
      data: created,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
