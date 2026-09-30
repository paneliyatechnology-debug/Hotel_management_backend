import 'dotenv/config'; // 🚀 Load Environment Variables Immediately
import http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import connectDB from './config/db';
import User from './models/User';
import { initSocket } from './utils/socketService';

// Route Imports
import authRoutes from './routes/authRoutes';
import hotelRoutes from './routes/hotelRoutes';
import superAdminRoutes from './routes/superAdminRoutes';
import hotelAdminRoutes from './routes/hotelAdminRoutes';
import receptionistRoutes from './routes/receptionistRoutes';
import subscriptionPlanRoutes from './routes/subscriptionPlanRoutes';
import signatureSyncRoutes from './routes/signatureSyncRoutes';
import settingsRoutes from './routes/settingsRoutes';

// Load environment variables
dotenv.config();

// Auto-seed Master Super Admin Accounts
const ensureDefaultSuperAdmin = async () => {
  try {
    const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@hotelmgmt.com').toLowerCase();
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@2026';

    let superAdmin = await User.findOne({ email: superAdminEmail });
    if (!superAdmin) {
      await User.create({
        name: 'Master Super Administrator',
        email: superAdminEmail,
        password: superAdminPassword,
        phone: '+91 99999 88888',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        isDeleted: false,
        failedLoginAttempts: 0,
      });
      console.log(`👑 Auto-seeded Master Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
    } else {
      superAdmin.name = 'Master Super Administrator';
      superAdmin.role = 'SUPER_ADMIN';
      superAdmin.status = 'ACTIVE';
      superAdmin.password = superAdminPassword;
      superAdmin.failedLoginAttempts = 0;
      superAdmin.accountLockedUntil = undefined;
      superAdmin.isDeleted = false;
      await superAdmin.save();
      console.log(`👑 Updated Master Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
    }

    // Also seed a backup secondary Super Admin for instant convenience
    const secondaryEmail = 'admin@hotelmgmt.com';
    let secondaryAdmin = await User.findOne({ email: secondaryEmail });
    if (!secondaryAdmin) {
      await User.create({
        name: 'System Super Admin',
        email: secondaryEmail,
        password: 'Admin@2026',
        phone: '+91 98765 43210',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        isDeleted: false,
        failedLoginAttempts: 0,
      });
      console.log(`👑 Auto-seeded Secondary Super Admin: ${secondaryEmail} / Admin@2026`);
    } else {
      secondaryAdmin.role = 'SUPER_ADMIN';
      secondaryAdmin.status = 'ACTIVE';
      secondaryAdmin.password = 'Admin@2026';
      secondaryAdmin.failedLoginAttempts = 0;
      secondaryAdmin.accountLockedUntil = undefined;
      secondaryAdmin.isDeleted = false;
      await secondaryAdmin.save();
    }
  } catch (err: any) {
    console.warn('Super Admin auto-seed warning:', err.message);
  }
};

// Connect to MongoDB and Seed Admin
connectDB().then(() => {
  ensureDefaultSuperAdmin();
});

const app = express();
const httpServer = http.createServer(app);

// Initialize Real-Time WebSockets
initSocket(httpServer);

// Universal CORS Configuration (Allows Vercel, Localhost, Render, Network IPs & Custom Domains)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman, server-to-server) or any client origin
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Set-Cookie'],
  })
);

// Explicit preflight handler for all routes
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Mount API Endpoints
app.use('/api/v1/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/v1/signature-sync', signatureSyncRoutes);
app.use('/api/signature-sync', signatureSyncRoutes);
app.use('/api/v1/hotels', hotelRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/v1/subscription-plans', subscriptionPlanRoutes);
app.use('/api/subscription-plans', subscriptionPlanRoutes);
app.use('/api/v1/super-admin', superAdminRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/v1/admin', hotelAdminRoutes);
app.use('/api/admin', hotelAdminRoutes);
app.use('/api/v1/receptionist', receptionistRoutes);
app.use('/api/receptionist', receptionistRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/settings', settingsRoutes);

// Health Check & Documentation Overview
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'success',
    name: 'Multi-Tenant Hotel Management SaaS API',
    version: '1.0.0',
    realTime: 'Socket.io Active',
    modules: {
      auth: '/api/v1/auth',
      publicHotels: '/api/v1/hotels',
      superAdmin: '/api/v1/super-admin',
      hotelAdmin: '/api/v1/admin',
      receptionist: '/api/v1/receptionist',
    },
    timestamp: new Date().toISOString(),
  });
});

const PORT: string | number = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Multi-Tenant Hotel Management Server & Socket.io running on port ${PORT}`);
});
