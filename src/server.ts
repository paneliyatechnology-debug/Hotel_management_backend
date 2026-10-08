import 'dotenv/config'; // 🚀 Load Environment Variables Immediately
import http from 'http';
import path from 'path';
import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import connectDB from './config/db';
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
import uploadRoutes from './routes/uploadRoutes';

import { ensureDefaultPlansExist } from './controllers/subscriptionPlanController';
import { autoCompleteExpiredCleaningRooms } from './utils/housekeepingService';
import { initializeEmailQueue, getEmailQueueStatus } from './queues/emailQueue';
import { startEmailWorker, stopEmailWorker } from './workers/emailWorker';

// Load environment variables
dotenv.config();

// Connect to MongoDB & Initialize Background Workers
connectDB().then(async () => {
  ensureDefaultPlansExist().catch((err) => console.error('Error seeding default plans:', err));

  // 🧹 Automatic Housekeeping 100% Turnaround -> AVAILABLE Background Job (Runs every 10 seconds)
  setInterval(() => {
    autoCompleteExpiredCleaningRooms().catch((err) => console.error('Housekeeping interval error:', err));
  }, 10000);

  // 📧 Initialize Resilient Email Queue & Worker
  try {
    const queueMode = await initializeEmailQueue();
    if (queueMode === 'REDIS' && process.env.RUN_EMAIL_WORKER_INLINE !== 'false') {
      startEmailWorker();
    }
  } catch (err) {
    console.error('Failed to initialize email queue:', err);
  }
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

// Static Folders (Uploads, Folios & Public Assets)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/public', express.static(path.join(process.cwd(), 'public')));

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
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/upload', uploadRoutes);

// Health Check & Documentation Overview
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'success',
    name: 'Multi-Tenant Hotel Management SaaS API',
    version: '1.0.0',
    realTime: 'Socket.io Active',
    emailQueue: getEmailQueueStatus(),
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

const PORT: number = Number(process.env.PORT) || 5000;

httpServer.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use! Please kill the process using port ${PORT} or check running background tasks.`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Multi-Tenant Hotel Management Server & Socket.io running on port ${PORT}`);
});

// Graceful Shutdown
const handleGracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);

  // Safety force-exit timer to prevent keep-alive WebSocket connections from hanging process termination
  const forceExitTimer = setTimeout(() => {
    console.warn('⚠️ Forced server shutdown after timeout.');
    process.exit(0);
  }, 3000);
  forceExitTimer.unref();

  try {
    await stopEmailWorker();
  } catch (err) {
    console.error('Error during email worker shutdown:', err);
  }

  httpServer.close(() => {
    console.log('HTTP Server closed. Exiting process.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
